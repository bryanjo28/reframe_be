const assert = require('node:assert/strict');
const { createPaymentsService } = require('../src/services/pakasirPaymentsService');
const { createPakasirClient } = require('../src/services/pakasirService');
const { DEFAULTS } = require('../src/services/subscriptionPricingService');

async function main() {
  const id = '00000000-0000-4000-8000-000000000001';
  let inserted, charged, cancelled = 0, outcome = 'pending';
  const expiry = '2026-01-01T00:30:00.000Z';
  const writes = [];
  const db = { from(table) { const filters={}; return {
    select() { return this; }, eq(key,value) { filters[key]=value; return this; }, lte() { return this; }, limit() { return this; }, order() { return this; },
    insert(row) { inserted = row; return this; },
    update(row) { writes.push(row); return this; },
    single: async () => ({ data: inserted }),
    maybeSingle: async () => ({ data: table === 'subscription_pricing_config' ? { singleton: true, version: 1, published: DEFAULTS }
      : table === 'payment_orders' && filters.status === 'pending' ? null
        : table === 'user_subscriptions' ? null
          : inserted || { id, price: 29000, monthly_ai_credits: 200, code: 'starter', is_active: true } }),
    then(resolve) { resolve({ data: inserted, error: null }); },
  }; }, async rpc(name) {
    if (name === 'settle_pakasir_payment') return { data: { creditsAdded: 200, duplicate: false } };
    assert.equal(name, 'mark_expired_pakasir_order_cancelled');
    return { data: { status: 'cancelled' } };
  } };
  const gateway = { configured() {},
    create: async (orderId, amount) => { charged = amount; return { txn_id: 'txn', order_id: orderId, project: 'shop', amount, payment_method: 'qris', qr_string: 'qr', expired_at: expiry }; },
    status: async () => ({ txn_id: 'txn', order_id: inserted.id, amount: charged, status: outcome, is_sandbox: false }),
    cancel: async () => { cancelled++; assert.fail('backend must not auto-cancel a provider-pending payment'); },
  };
  let clockNow=Date.parse(expiry);
  const service = createPaymentsService({ db, gateway, env: { PAKASIR_SLUG: 'shop' }, now: () => clockNow });
  for (const [months, total] of [[1, 29000], [3, 74000], [12, 249000]]) {
    inserted = null;
    const order = await service.createOrder('owner', { planId: id, durationMonths: months, amount: 1, credits: 999 });
    assert.equal(charged, total);
    assert.equal(inserted.monthly_credits, 200);
    assert.equal(inserted.duration_months, months);
    assert.equal(order.providerExpiresAt, expiry);
    assert.equal(writes.at(-1).provider_expires_at, expiry);
  }
  for (const durationMonths of ['3', null, 2, 0, 1.5, 13]) {
    await assert.rejects(service.createOrder('owner', { planId: id, durationMonths }), { code: 'INVALID_SUBSCRIPTION_DURATION' });
  }
  inserted = { ...inserted, provider_reference: 'txn', provider_expires_at: expiry, status: 'pending' };
  clockNow-=1;
  assert.equal((await service.checkOrder('owner',inserted.id)).status,'pending');
  assert.equal(cancelled,0);
  clockNow+=1;
  outcome = 'completed';
  assert.equal((await service.checkOrder('owner', inserted.id)).status, 'paid');
  assert.equal(cancelled, 0);
  outcome = 'pending';
  assert.equal((await service.checkOrder('owner', inserted.id)).status, 'pending');
  assert.equal(inserted.status, 'pending');
  assert.equal(cancelled, 0);
  outcome = 'canceled';
  assert.equal((await service.checkOrder('owner', inserted.id)).status, 'cancelled');
  assert.equal(cancelled, 0);

  let clock = 0;
  const times = [];
  const client = createPakasirClient({ env: { PAKASIR_API_KEY: 'test', PAKASIR_SLUG: 'shop' }, now: () => clock,
    sleep: async ms => { clock += ms; }, fetch: async url => {
      assert.match(url, /cancel-transaction\/shop\//); times.push(clock);
      return { ok: true, json: async () => ({ message: 'ok' }) };
    } });
  await Promise.all([client.cancel('a'), client.cancel('b'), client.cancel('c')]);
  assert.ok(times[1] - times[0] >= 500 && times[2] - times[1] >= 500);
  console.log('ok - prepaid duration snapshots, provider expiry, provider-confirmed payment states and gateway cancel throttling');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
