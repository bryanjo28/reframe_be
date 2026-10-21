const assert = require('node:assert/strict');
require('dotenv').config();
const service = require('../src/services/threadsAuthService');
const store = require('../src/store/oauthStateStore');

(async () => {
  for (const failedStage of ['short_token_exchange', 'long_token_exchange', 'profile_fetch', 'account_persist', null]) {
    const logs = [];
    const state = `private-state-${failedStage}`;
    store.save(state, { provider: 'threads', userId: 'test-user' });
    const step = (stage, result) => async () => {
      if (stage === failedStage) {
        const error = new Error('private-token private-code');
        error.status = 400;
        error.details = { error: { code: 190, error_subcode: 12, message: 'private-token' } };
        throw error;
      }
      return result;
    };
    const task = service.handleCallback({ code: 'private-code', state, requestId: 'test-request' }, {
      logger: { info: line => logs.push(line) },
      exchangeCode: step('short_token_exchange', { accessToken: 'private-token' }),
      exchangeLongToken: step('long_token_exchange', { accessToken: 'private-token' }),
      fetchUser: step('profile_fetch', { id: 'threads-user', username: 'tester' }),
      persistAccount: step('account_persist', { storage: 'database' }),
    });
    if (failedStage) await assert.rejects(task, error => error.oauthStage === failedStage);
    else assert.equal((await task).accessTokenStored, true);
    const output = logs.join('\n');
    for (const secret of [state, 'private-token', 'private-code']) assert.ok(!output.includes(secret));
    const events = logs.map(line => JSON.parse(line.replace('[threads-oauth] ', '')));
    assert.ok(events.some(event => event.stage === (failedStage || 'account_persist') && event.event === (failedStage ? 'stage_failed' : 'stage_completed')));
    if (failedStage) assert.equal(events.at(-1).providerCode, 190);
  }
  console.log('ok - Threads OAuth stages report failures without leaking secrets');
})().catch(error => { console.error(error); process.exitCode = 1; });
