const assert = require('node:assert/strict');
const { withRequestTimeout } = require('../src/utils/requestTimeout');

function loadWithMocks(target, mocks) {
  const saved = [];
  const targetId = require.resolve(target);
  delete require.cache[targetId];
  try {
    for (const [name, exports] of Object.entries(mocks)) {
      const id = require.resolve(name);
      saved.push([id, require.cache[id]]);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    return require(targetId);
  } finally {
    for (const [id, previous] of saved) {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    }
  }
}

async function main() {
  let logReject;
  const errorHandler = loadWithMocks('../src/middlewares/errorHandler', {
    '../src/services/admin/adminErrorLogService': {
      redactMessage: (value) => value,
      recordServerError: () => new Promise((_resolve, reject) => { logReject = reject; }),
    },
  });
  let sent = false;
  const originalError = console.error;
  console.error = () => {};
  try {
    await errorHandler(new Error('internal detail'), {}, {
      status(value) { assert.equal(value, 500); return this; },
      json(body) { sent = true; assert.doesNotMatch(body.message, /internal detail/); },
    });
    assert.equal(sent, true);
    logReject(new Error('database unavailable'));
    await Promise.resolve();
  } finally { console.error = originalError; }
  console.log('ok - response is sent while error log is pending and log rejection is handled');

  const originalFetch = global.fetch;
  const oldKey = process.env.MIDTRANS_SERVER_KEY;
  let aborted = 0;
  const shortTimeout = { withRequestTimeout: (operation) => withRequestTimeout(operation, 5) };
  try {
    global.fetch = async (_url, { signal }) => {
      assert.ok(signal instanceof AbortSignal);
      // Headers arrived, but body is stalled: timeout must cover body too.
      const stalledBody = () => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted += 1; reject(new Error('aborted')); }, { once: true });
      });
      return { ok: true, text: stalledBody, json: stalledBody };
    };
    const threads = loadWithMocks('../src/services/threadsAuthService', {
      '../src/utils/requestTimeout': shortTimeout,
    });
    await assert.rejects(threads.getThreadsUser('test-token'), { status: 504, code: 'EXTERNAL_REQUEST_TIMEOUT' });
    process.env.MIDTRANS_SERVER_KEY = 'test-server-key';
    const payments = loadWithMocks('../src/services/paymentsService', {
      '../src/utils/requestTimeout': shortTimeout,
      '../src/config/supabase': { isSupabaseAdminConfigured: true, supabaseAdmin: {} },
    });
    await assert.rejects(payments.handleMidtransWebhook({ order_id: 'order-1' }), { status: 504, code: 'EXTERNAL_REQUEST_TIMEOUT' });
    assert.equal(aborted, 2);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.MIDTRANS_SERVER_KEY;
    else process.env.MIDTRANS_SERVER_KEY = oldKey;
  }
  console.log('ok - Threads and Midtrans abort stalled response bodies with stable timeout errors');

  let settleCalls = 0;
  let releaseCalls = 0;
  let failSettlement = true;
  const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
  const service = loadWithMocks('../src/services/contentOutputsService', {
    '../src/config/supabase': { isSupabaseConfigured: true, supabaseAdmin: null },
    '../src/services/dailyGenerationUsageService': { consumeDailyGenerationHit: async () => ({}) },
    '../src/services/generationLogsService': { createGenerationLog: async () => ({ id: 'log' }) },
    '../src/services/notificationsService': { notifyActivity: async () => true },
    '../src/services/sumopodService': { generateChatCompletion: async () => ({ model: 'provider-model', content: 'Generated text', raw: { usage } }) },
    '../src/services/aiCreditsService': {
      reserveCredits: async () => ({ requestId: 'request-1' }),
      settleCredits: async (input) => {
        settleCalls += 1;
        assert.equal(input.usage, usage);
        assert.equal(input.model, 'provider-model');
        if (failSettlement && settleCalls === 1) throw new Error('settlement transient failure');
        return {};
      },
      releaseReservation: async () => { releaseCalls += 1; },
    },
  });
  const db = { from(table) {
    return {
      select() { return this; }, eq() { return this; }, insert() { return this; },
      single: async () => ({ error: { message: 'content save failed' } }),
      maybeSingle: async () => ({ data: table === 'content_topics'
        ? { id: 'topic-1', persona_config_id: 'persona-1', topic: 'Test topic' }
        : { id: 'persona-1', persona: 'Writer' }, error: null }),
    };
  } };
  const generate = () => service.generateContentOutput({ supabase: db, userId: 'user-1', payload: { topicId: 'topic-1', threadType: 'short' } });
  await assert.rejects(generate(), /settlement transient failure/);
  assert.equal(settleCalls, 2);
  assert.equal(releaseCalls, 0);
  failSettlement = false;
  settleCalls = 0;
  await assert.rejects(generate(), /content save failed/);
  assert.equal(settleCalls, 1);
  assert.equal(releaseCalls, 0);
  console.log('ok - content settlement retries retain provider usage and saved charges are never released');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
