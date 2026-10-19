const assert = require('node:assert/strict');
const { createPakasirClient } = require('../src/services/pakasirService');
const { createPaymentsService } = require('../src/services/paymentsService');

async function main() {
  const calls = [];
  let clock = 0;
  const client = createPakasirClient({
    env: { PAKASIR_API_KEY: 'secret', PAKASIR_SLUG: 'my-shop' },
    now: () => clock, sleep: async ms => { clock += ms; },
    fetch: async (url, options) => { calls.push({ url, options, at: clock }); return { ok: true, json: async () => ({ txn_id: 'txn', status: 'pending' }) }; },
  });
  await Promise.all([client.create('order', 29000), client.create('order2', 29000)]);
  assert.equal(calls[0].url, 'https://app.pakasir.com/api/v2/create-transaction/my-shop/order');
  assert.equal(calls[0].options.headers['X-Api-Key'], 'secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), { method: 'qris', amount: 29000 });
  assert.ok(calls[1].at - calls[0].at >= 500);
  await Promise.all([client.status('txn'), client.status('txn')]);
  assert.equal(calls.length, 3, 'concurrent status checks coalesce');
  await client.status('txn');
  assert.equal(calls.length, 3, 'status cached for four seconds');
  const lastStatusAt = calls[2].at;
  await client.status('txn', { refresh: true });
  assert.equal(calls.length, 4);
  assert.ok(calls[3].at - lastStatusAt >= 4000, 'webhook refresh honors status cooldown');
  await assert.rejects(async () => createPakasirClient({ env: {} }).create('o', 1000), { status: 503 });
  await client.create('va-order', 29000, 'bni_va');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { method: 'bni_va', amount: 29000 });
  await assert.rejects(async () => client.create('bad-method', 29000, 'payment_link'), { status: 400 });

  let order = { id: '00000000-0000-4000-8000-000000000001', user_id: 'owner', provider: 'pakasir', provider_reference: 'txn', amount_idr: 29000, status: 'pending' };
  const writes = [];
  let rpcCount = 0;
  const db = { from(table) {
    const filters = {};
    return {
      select() { return this; }, eq(k, v) { filters[k] = v; return this; },
      update(value) { writes.push(value); return this; },
      async maybeSingle() { return { data: filters.user_id && filters.user_id !== order.user_id ? null : order }; },
      then(resolve) { resolve({ error: null }); },
    };
  }, async rpc(name, args) {
    if (name === 'mark_expired_pakasir_order_cancelled') return { data: { status: 'cancelled' } };
    assert.equal(name, 'settle_pakasir_payment'); assert.equal(args.p_order_id, order.id); rpcCount++; return { data: { creditsAdded: 200 } };
  } };
  let verified = { txn_id: 'txn', order_id: order.id, amount: 29000, status: 'pending', is_sandbox: false };
  const gateway = { configured() {}, create: async () => ({ txn_id: 'txn' }), status: async () => verified };
  const service = createPaymentsService({ db, gateway, env: {} });
  assert.equal((await service.checkOrder('owner', order.id)).credited, false);
  assert.equal(rpcCount, 0);
  await assert.rejects(service.checkOrder('stranger', order.id), { status: 404 });
  verified = { ...verified, status: 'completed', amount: 1 };
  await assert.rejects(service.checkOrder('owner', order.id), { code: 'PAYMENT_VERIFICATION_FAILED' });
  assert.equal(rpcCount, 0);
  verified = { ...verified, amount: 29000, is_sandbox: true };
  await assert.rejects(service.checkOrder('owner', order.id), { code: 'PAYMENT_VERIFICATION_FAILED' });
  verified.is_sandbox = false;
  verified.txn_id = 'forged';
  await assert.rejects(service.checkOrder('owner', order.id), { code: 'PAYMENT_VERIFICATION_FAILED' });
  verified.txn_id = 'txn';
  assert.equal((await service.checkOrder('owner', order.id)).creditsAdded, 200);
  assert.equal(rpcCount, 1);
  order.status = 'pending';
  verified.status = 'canceled';
  assert.equal((await service.checkOrder('owner', order.id)).status, 'cancelled');
  verified.status = 'completed';
  await service.handlePakasirWebhook({ order_id: order.id, txn_id: 'txn', amount: 29000 });
  assert.equal(rpcCount, 2, 'webhook works without optional secret and still verifies server status');
  order.status = 'paid';
  assert.equal((await service.checkOrder('owner', order.id)).duplicate, true);
  assert.equal(rpcCount, 2);
  const secured = createPaymentsService({ db, gateway, env: { PAKASIR_WEBHOOK_SECRET: 'abc' } });
  await assert.rejects(secured.handlePakasirWebhook({ order_id: order.id }, 'wrong'), { status: 401 });
  const productId = '00000000-0000-4000-8000-000000000002';
  let product = { id: productId, price: 29000, monthly_ai_credits: 200, code: 'starter', is_active: true };
  let inserted;
  let providerCalls = 0;
  let timeout = false;
  let eligible = false;
  let wrongMethod = false;
  const catalogDb = { from(table) {
    return {
      select() { return this; }, eq() { return this; },
      async maybeSingle() {
        if (table === 'subscription_plans') return { data: product };
        if (table === 'token_packages') return { data: { id: productId, price_idr: 15000, token_amount: 100, is_active: true } };
        if (table === 'payment_orders') return { data: inserted };
        if (table === 'user_subscriptions') return { data: eligible ? { id: productId, plan_id: productId, status: 'active', started_at: new Date().toISOString() } : null };
      },
      insert(value) { inserted = value; return this; },
      async single() { return { data: inserted }; },
      update() { return this; }, then(resolve) { resolve({}); },
      order() { return this; },
    };
  } };
  const catalogService = createPaymentsService({ db: catalogDb, env: { PAKASIR_SLUG: 'shop' }, gateway: {
    configured() {}, async create(id, amount, method = 'qris') {
      providerCalls++;
      if (timeout) throw new Error('timeout');
      assert.ok([15000, 29000].includes(amount));
      return { txn_id: 'txn', order_id: id, project: 'shop', amount, payment_method: wrongMethod ? 'bri_va' : method,
        expired_at: '2099-01-01T00:00:00.000Z',
        qr_string: method === 'qris' ? 'qr' : '', va_number: method === 'qris' ? '' : '8800123456789' };
    },
  } });
  const created = await catalogService.createOrder('owner', { planId: productId, amount: 1, credits: 999999 });
  assert.equal(inserted.amount_idr, 29000, 'price comes from database');
  assert.equal(inserted.credits, 200, 'credits come from database');
  assert.equal(inserted.order_type, 'subscription');
  assert.equal(created.payment.qr_string, 'qr');
  assert.match(created.checkoutUrl, /pay-v2\/txn\?qris_only=1$/);
  assert.equal(created.payment_method, 'qris');
  const vaOrder = await catalogService.createOrder('owner', { planId: productId, method: 'bni_va' });
  assert.equal(vaOrder.payment_method, 'bni_va');
  assert.equal(vaOrder.payment.va_number, '8800123456789');
  assert.equal(vaOrder.checkoutUrl, null, 'VA instructions are rendered by FE; no QRIS-only link for VA');
  assert.equal(vaOrder.checkoutAvailable, true);
  const retriedVa = await catalogService.retryCheckout('owner', vaOrder.id);
  assert.equal(retriedVa.payment.payment_method, 'bni_va', 'retry retains original payment method');
  await assert.rejects(catalogService.createOrder('owner', { planId: productId, method: 'unknown_va' }), { status: 400 });
  await assert.rejects(catalogService.createOrder('owner', { planId: productId, method: 'payment_link' }), { status: 400 });
  product = { ...product, price: 5000 };
  await assert.rejects(catalogService.createOrder('owner', { planId: productId, method: 'bni_va' }), { status: 400 });
  product = { ...product, price: 29000 };
  wrongMethod = true;
  const invalidProviderMethod = await catalogService.createOrder('owner', { planId: productId, method: 'bni_va' });
  assert.equal(invalidProviderMethod.checkoutAvailable, false, 'wrong bank response is not exposed as a valid checkout');
  wrongMethod = false;
  timeout = true;
  const pending = await catalogService.createOrder('owner', { planId: productId });
  assert.equal(pending.checkoutAvailable, false);
  assert.equal(pending.id, inserted.id);
  timeout = false;
  assert.equal((await catalogService.retryCheckout('owner', pending.id)).id, pending.id);
  await assert.rejects(catalogService.createOrder('owner', { packageId: productId }), { status: 403 });
  eligible = true;
  const topup = await catalogService.createOrder('owner', productId);
  assert.equal(topup.order_type, 'topup');
  assert.equal(topup.amount_idr, 15000);
  assert.equal(topup.credits, 100);
  await assert.rejects(catalogService.createOrder('owner', {}), { status: 400 });
  await assert.rejects(catalogService.createOrder('owner', { planId: productId, packageId: productId }), { status: 400 });
  product = { ...product, is_active: false };
  await assert.rejects(catalogService.createOrder('owner', { planId: productId }), { status: 404 });
  assert.equal(providerCalls, 7);
  console.log('ok - Pakasir v2 configuration, throttling, polling ownership, verification and duplicate payments');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
