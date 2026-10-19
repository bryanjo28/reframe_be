const assert = require('node:assert/strict');
const { createPaymentsService } = require('../src/services/pakasirPaymentsService');
const { createPakasirClient } = require('../src/services/pakasirService');

async function main() {
  const id = '00000000-0000-4000-8000-000000000001';
  let inserted, charged, cancelled = 0, outcome = 'pending', cancelFailure = false;
  const expiry = '2026-01-01T00:30:00.000Z';
  const writes = [];
  const db = { from() { return {
    select() { return this; }, eq() { return this; },
    insert(row) { inserted = row; return this; },
    update(row) { writes.push(row); return this; },
    single: async () => ({ data: inserted }),
    maybeSingle: async () => ({ data: inserted || { id, price: 29000, monthly_ai_credits: 200, code: 'starter', is_active: true } }),
    then(resolve) { resolve({ data: inserted, error: null }); },
  }; }, async rpc(name) {
    if (name === 'settle_pakasir_payment') return { data: { creditsAdded: 200, duplicate: false } };
    assert.equal(name, 'mark_expired_pakasir_order_cancelled');
    return { data: { status: 'cancelled' } };
  } };
  const gateway = { configured() {},
    create: async (orderId, amount) => { charged = amount; return { txn_id: 'txn', order_id: orderId, project: 'shop', amount, payment_method: 'qris', qr_string: 'qr', expired_at: expiry }; },
    status: async () => ({ txn_id: 'txn', order_id: inserted.id, amount: charged, status: outcome, is_sandbox: false }),
    cancel: async () => { cancelled++; if (cancelFailure) throw new Error('offline'); return { message: 'ok' }; },
  };
  let clockNow=Date.parse(expiry);
  const service = createPaymentsService({ db, gateway, env: { PAKASIR_SLUG: 'shop' }, now: () => clockNow });
  for (const months of [1, 3, 6, 12]) {
    inserted = null;
    const order = await service.createOrder('owner', { planId: id, durationMonths: months, amount: 1, credits: 999 });
    assert.equal(charged, 29000 * months);
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
  cancelFailure = true;
  await assert.rejects(service.checkOrder('owner', inserted.id), /offline/);
  assert.equal(inserted.status, 'pending');
  cancelFailure = false;
  assert.equal((await service.checkOrder('owner', inserted.id)).status, 'cancelled');
  assert.equal(cancelled, 2);

  let clock = 0;
  const times = [];
  const client = createPakasirClient({ env: { PAKASIR_API_KEY: 'test', PAKASIR_SLUG: 'shop' }, now: () => clock,
    sleep: async ms => { clock += ms; }, fetch: async url => {
      assert.match(url, /cancel-transaction\/shop\//); times.push(clock);
      return { ok: true, json: async () => ({ message: 'ok' }) };
    } });
  await Promise.all([client.cancel('a'), client.cancel('b'), client.cancel('c')]);
  assert.ok(times[1] - times[0] >= 500 && times[2] - times[1] >= 500);
  console.log('ok - prepaid duration snapshots, provider expiry, completion before cancellation, retry and cancel throttling');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
