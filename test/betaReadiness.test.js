const assert = require('node:assert/strict');

async function main() {
  const moduleMocks = {
    '../src/config/supabase': { isSupabaseConfigured: true, supabaseAdmin: null },
    '../src/services/generationTopicLogsService': { createGenerationTopicLog: async () => ({ id: 'log' }) },
    '../src/services/dailyGenerationUsageService': { consumeDailyGenerationHit: async () => ({}) },
    '../src/services/notificationsService': { notifyActivity: async () => true },
  };
  let settled = [];
  let released = 0;
  let failAfterSettlement = false;
  const providerUsage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
  moduleMocks['../src/services/sumopodService'] = {
    generateChatCompletion: async () => ({ model: 'test-model', content: failAfterSettlement ? '{"topics":[]}' : 'invalid JSON', raw: { usage: providerUsage } }),
  };
  moduleMocks['../src/services/aiCreditsService'] = {
    reserveCredits: async () => ({ requestId: 'req-1' }),
    settleCredits: async (input) => { settled.push(input); return {}; },
    releaseReservation: async () => { released += 1; },
  };
  const saved = [];
  for (const [name, exports] of Object.entries(moduleMocks)) {
    const id = require.resolve(name);
    saved.push([id, require.cache[id]]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  }
  const topicService = require('../src/services/contentTopicsGenerationService');
  const errorHandler = require('../src/middlewares/errorHandler');
  for (const [id, old] of saved) {
    if (old) require.cache[id] = old;
    else delete require.cache[id];
  }
  const db = { from(table) {
    return {
      select() { return this; }, eq() { return this; }, order() { return this; },
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: table === 'content_pillars'
        ? { id: 'pillar', persona_config_id: 'persona' } : { id: 'persona' }, error: null }),
    };
  } };
  await assert.rejects(topicService.generateContentTopics({ supabase: db, userId: 'user', payload: { contentPillarId: 'pillar', jumlahTopics: 1 } }), /Unable to parse/);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].usage, providerUsage);
  assert.equal(settled[0].status, 'failed');
  assert.equal(settled[0].model, 'test-model');
  assert.equal(released, 0);
  console.log('ok - invalid topic JSON still settles provider usage exactly once');

  failAfterSettlement = true;
  settled = [];
  await topicService.generateContentTopics({ supabase: db, userId: 'user', payload: { contentPillarId: 'pillar', jumlahTopics: 1 } });
  assert.equal(settled.length, 1);
  assert.equal(released, 0);
  console.log('ok - successful topic generation settles once without releasing credits');

  let responseBody;
  const originalError = console.error;
  console.error = () => {};
  try {
    await errorHandler(Object.assign(new Error('database password=secret table=private'), { status: 500, code: 'DATABASE_FAILURE' }),
      { requestId: 'request-123', method: 'POST', path: '/api/test' },
      { status(value) { assert.equal(value, 500); return this; }, json(body) { responseBody = body; } });
  } finally { console.error = originalError; }
  assert.equal(responseBody.request_id, 'request-123');
  assert.equal(responseBody.error_code, 'DATABASE_FAILURE');
  assert.doesNotMatch(responseBody.message, /password|database|private/);
  console.log('ok - 500 response hides internal details and retains request correlation');

  const { reserveCredits, recoverStaleReservations } = require('../src/services/aiCreditsService');
  const calls = [];
  const creditDb = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: name === 'recover_stale_ai_reservations' ? 0 : {}, error: null };
  } };
  await reserveCredits({ userId: 'user', feature: 'topic_generation', messages: [], maxTokens: 1200, db: creditDb });
  assert.deepEqual(calls.map((call) => call.name), ['recover_stale_ai_reservations', 'reserve_ai_credits']);
  assert.equal(calls[0].args.p_user_id, 'user');
  await assert.rejects(recoverStaleReservations({ db: { rpc: async () => ({ error: { message: 'missing migration' } }) } }), { code: 'AI_CREDIT_TRANSACTION_FAILED' });
  console.log('ok - reservation recovers abandoned credits first and recovery errors are surfaced');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
