const assert = require('node:assert/strict');
const { synchronizeSubscriptions, quoteSubscriptionPurchase, listSubscriptionHistory } = require('../src/services/subscriptionLifecycleService');
const { mapUserSubscriptionRow } = require('../src/services/subscriptionUsageService');

async function main() {
  const row = { id: 'sub', started_at: '2026-10-01T00:00:00Z', ends_at: '2026-11-01T00:00:00Z',
    current_period_start: '2026-10-01T00:00:00Z', current_period_end: '2026-11-01T00:00:00Z',
    payment_order_id: 'order', activated_at: '2026-10-01T00:00:00Z' };
  const mapped = mapUserSubscriptionRow(row);
  assert.equal(mapped.currentPeriodEnd, row.current_period_end);
  assert.equal(mapped.currentPeriodStart, row.current_period_start);
  assert.equal(mapped.paymentOrderId, 'order');
  const calls = [];
  const db = { async rpc(name, args) {
    calls.push([name, args]);
    if (name === 'quote_subscription_purchase') return { data: { changeType: 'downgrade', effectiveAt: row.ends_at } };
    return { data: { activatedCount: 1 } };
  }, from(table) {
    assert.equal(table, 'user_subscriptions');
    return { select() { return this; }, eq(key, value) { assert.equal(key, 'user_id'); assert.equal(value, 'owner'); return this; },
      order() { return this; }, async limit(n) { assert.equal(n, 50); return { data: [row] }; } };
  } };
  assert.equal((await synchronizeSubscriptions({ db, userId: 'owner' })).activatedCount, 1);
  assert.deepEqual(calls[0], ['activate_due_subscription_periods', { p_user_id: 'owner' }]);
  assert.equal((await quoteSubscriptionPurchase({ db, userId: 'owner', planId: 'starter' })).changeType, 'downgrade');
  assert.deepEqual(calls.at(-1), ['quote_subscription_purchase', { p_user_id: 'owner', p_plan_id: 'starter' }]);
  assert.equal((await listSubscriptionHistory({ db, userId: 'owner' }))[0].currentPeriodEnd, row.ends_at);
  await assert.rejects(synchronizeSubscriptions({ db: { rpc: async () => ({ error: { message: 'db error' } }) }, userId: 'owner' }), /db error/);
  console.log('ok - subscription periods, scheduled purchase quote, activation RPC and owner-filtered history');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
