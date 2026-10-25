const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { reportError, dispatchErrorAlerts } = require('../src/services/errorAlertService');

async function main() {
  const env = { HERMES_ALERT_ENABLED: 'true', HERMES_ALERT_URL: 'https://hermes.example/errors', HERMES_ALERT_SECRET: 'test-secret' };
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: [], error: null }; } };
  await reportError({ source: 'api', error: new Error('oops') }, { db, env: {} });
  assert.equal(calls.length, 0);
  await reportError({ source: 'threads_connection', error: new Error('access_token=private password=hidden test-secret'), context: { content_output_id: 'output-1', access_token: 'private', content: 'do not send' } }, { db, env });
  assert.equal(calls.length, 1);
  const payload = calls[0].args.p_payload;
  assert.equal(payload.context.content_output_id, 'output-1');
  assert.equal(payload.context.access_token, undefined);
  assert.ok(!JSON.stringify(payload).includes('private'));
  assert.ok(!JSON.stringify(payload).includes('test-secret'));
  assert.ok(!JSON.stringify(payload).includes('hidden'));
  assert.ok(!JSON.stringify(payload).includes('do not send'));
  await reportError({ source: 'api', error: new Error('same failure'), context: { request_id: 'request-1' } }, { db, env });
  await reportError({ source: 'api', error: new Error('same failure'), context: { request_id: 'request-2' } }, { db, env });
  assert.equal(calls[1].args.p_fingerprint, calls[2].args.p_fingerprint);
  assert.notEqual(calls[1].args.p_payload.context.request_id, calls[2].args.p_payload.context.request_id);
  await reportError({ source: 'api', error: new Error('oops') }, { db: { rpc: async () => { throw new Error('offline'); } }, env });
  const row = { id: payload.event_id, payload, attempts: 1, lock_token: 'lease' };
  const updates = [];
  const dispatchDb = { rpc: async (name, args) => {
    if (name === 'claim_error_alerts') return { data: [row], error: null };
    updates.push(args); return { error: null };
  } };
  await dispatchErrorAlerts({ db: dispatchDb, env, fetchFn: async (url, options) => {
    assert.equal(url, env.HERMES_ALERT_URL);
    assert.equal(options.redirect, 'error');
    const stamp = options.headers['X-Griv-Timestamp'];
    const signature = createHmac('sha256', env.HERMES_ALERT_SECRET).update(stamp + '.' + options.body).digest('hex');
    assert.equal(options.headers['X-Griv-Signature'], 'sha256=' + signature);
    assert.equal(JSON.parse(options.body).event_id, row.id);
    return { ok: true };
  } });
  assert.equal(updates[0].p_success, true);
  assert.equal(updates[0].p_lock_token, 'lease');
  await dispatchErrorAlerts({ db: dispatchDb, env, fetchFn: async () => { throw new Error('offline'); } });
  assert.equal(updates[1].p_success, false);
  await dispatchErrorAlerts({ db: dispatchDb, env: { ...env, HERMES_ALERT_URL: 'http://insecure.example' }, fetchFn: async () => assert.fail('must not send') });
  console.log('ok - Hermes opt-in, sanitization, failure isolation, signed delivery and retries');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
