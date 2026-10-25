const assert = require('node:assert/strict');
const reporter = require('../src/services/errorAlertService');
const events = [];
let drains = 0;
reporter.reportError = async event => { events.push(event); };
reporter.dispatchErrorAlerts = async () => { drains++; };
const errorHandler = require('../src/middlewares/errorHandler');
const controller = require('../src/controllers/threadsController');
const auth = require('../src/services/threadsAuthService');
const { runDueScheduledJobs } = require('../src/services/cronService');
async function main() {
  const res = { status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; }, redirect(url) { this.url = url; return this; } };
  await errorHandler(Object.assign(new Error('offline'), { status: 503 }), { method: 'GET', path: '/test' }, res);
  assert.equal(res.code, 503); assert.equal(events.at(-1).source, 'api');
  const count = events.length;
  await errorHandler(Object.assign(new Error('invalid'), { status: 400 }), {}, res);
  assert.equal(events.length, count);
  await errorHandler(Object.assign(new Error('reconnect'), { status: 401, code: 'THREADS_RECONNECT_REQUIRED' }), {}, res);
  assert.equal(events.at(-1).source, 'threads_connection');
  const original = auth.handleCallback;
  try {
    auth.handleCallback = async () => { throw Object.assign(new Error('Threads API request failed with status 400'), { status: 400 }); };
    await controller.handleThreadsCallback({ query: { code: 'oauth-secret', state: 'state-secret' } }, res);
    assert.equal(events.at(-1).source, 'threads_connection');
    assert.ok(res.url.includes('connected=false'));
    const before = events.length;
    auth.handleCallback = async () => { throw Object.assign(new Error('Invalid or expired OAuth state'), { status: 400 }); };
    await controller.handleThreadsCallback({ query: { code: 'code', state: 'bad' } }, res);
    assert.equal(events.length, before);
  } finally { auth.handleCallback = original; }
  await runDueScheduledJobs({ isConfigured: true, supabase: { from: () => ({ select() { return this; }, eq() { return this; }, lte: async () => ({ data: [], error: null }) }) }, reconcileSubscriptions: async () => {}, reconcilePayments: async () => {} });
  assert.equal(drains, 1);
  console.log('ok - critical API/Threads alerts, ordinary validation exclusion, and idle cron draining');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
