const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPaymentsService } = require('../src/services/pakasirPaymentsService');
const { DEFAULTS } = require('../src/services/subscriptionPricingService');

const planId = '00000000-0000-4000-8000-000000000002';
const orderId = '00000000-0000-4000-8000-000000000003';
const now = Date.parse('2026-10-21T00:00:00Z');
function fixture({ currentCode = 'free', targetCode = 'starter', endsAt = null, insertError = null, orphan = false } = {}) {
  const orders = orphan ? [{ id: orderId, user_id: 'owner', provider: 'pakasir', order_type: 'subscription',
    amount_idr: 29000, status: 'pending', payment_method: 'qris', provider_expires_at: null,
    provider_reference: null, created_at: new Date(now - 3600000).toISOString() }] : [];
  const created = [];
  const rpcCalls = [];
  let recoveryFilter;
  const db = { from(table) {
    const filters = {};
    let value;
    let update;
    const upperBounds = {};
    let liveTopupFilter = false;
    const sorting = [];
    let rowLimit = Infinity;
    const query = {
      select() { return this; }, eq(key, val) { filters[key] = val; return this; },
      lte(key, val) { upperBounds[key] = val; return this; },
      limit(value) { rowLimit = value; return this; }, order(key) { sorting.push(key); return this; },
      or(value) { if (value.includes('provider_expires_at.gt.')) liveTopupFilter = true; else recoveryFilter = value; return this; },
      insert(row) { value = row; return this; }, update(row) { update = row; return this; },
      async single() { if (insertError) return { error: insertError }; orders.push(value); return { data: value }; },
      async maybeSingle() {
        if (table === 'subscription_pricing_config') return { data: { version: 1, published: DEFAULTS } };
        if (table === 'subscription_plans') return { data: filters.id === 'current-plan'
          ? { id: 'current-plan', code: currentCode, is_active: true, monthly_ai_credits: 200 }
          : { id: planId, code: targetCode, price: 29000, monthly_ai_credits: 200, is_active: true } };
        if (table === 'token_packages') return { data: { id: planId, price_idr: 15000, token_amount: 100, is_active: true } };
        if (table === 'user_subscriptions') return { data: currentCode ? { plan_id: 'current-plan', ends_at: endsAt } : null };
        return { data: orders.find(row => Object.entries(filters).every(([key, val]) => row[key] === val)
          && (!liveTopupFilter || row.provider_expires_at == null || Date.parse(row.provider_expires_at) > now)) || null };
      },
      then(resolve, reject) {
        if (update) for (const row of orders) if (Object.entries(filters).every(([key, val]) => row[key] === val)) Object.assign(row, update);
        let data = recoveryFilter ? orders.filter(row => row.status === 'pending' &&
          (row.provider_expires_at ? Date.parse(row.provider_expires_at) <= now : Date.parse(row.created_at) <= now - 300000))
          : orders.filter(row => Object.entries(upperBounds).every(([key, val]) => row[key] != null && row[key] <= val));
        data = data.filter(row => Object.entries(filters).every(([key, val]) => row[key] === val));
        if (liveTopupFilter) data = data.filter(row => row.provider_expires_at == null || Date.parse(row.provider_expires_at) > now);
        data.sort((a, b) => {
          for (const key of sorting) {
            if (a[key] !== b[key]) return a[key] == null ? -1 : b[key] == null ? 1 : a[key] < b[key] ? -1 : 1;
          }
          return 0;
        });
        return Promise.resolve({ data: data.slice(0, rowLimit) }).then(resolve, reject);
      },
    };
    return query;
  }, async rpc(name, args) {
    if (name === 'ensure_subscription_current') return { data: {} };
    rpcCalls.push({ name, args });
    const target = orders.find(row => row.id === args.p_order_id);
    if (name === 'settle_pakasir_payment') {
      target.status = 'paid';
      return { data: { creditsAdded: 200, duplicate: false } };
    }
    assert.equal(name, 'mark_expired_pakasir_order_cancelled');
    target.status = 'cancelled';
    return { data: { status: 'cancelled' } };
  } };
  const gateway = { configured() {}, async create(id, amount, method) {
    created.push(id);
    return { txn_id: 'txn', order_id: id, project: 'shop', amount, payment_method: method,
      qr_string: 'qr', expired_at: new Date(now + 1800000).toISOString() };
  }, async status() { return { txn_id: 'txn', order_id: orders[0].id, amount: 29000, is_sandbox: false, status: 'pending' }; } };
  return { service: createPaymentsService({ db, gateway, env: { PAKASIR_SLUG: 'shop' }, now: () => now }), orders, created, gateway, rpcCalls };
}

test('Free can buy a paid plan immediately', async () => {
  const { service } = fixture();
  assert.equal((await service.createOrder('owner', { planId })).checkoutAvailable, true);
});
test('expired paid users can choose a different plan', async () => {
  const { service } = fixture({ currentCode: 'creator', endsAt: new Date(now - 1).toISOString() });
  assert.equal((await service.createOrder('owner', { planId })).checkoutAvailable, true);
});
test('same-plan renewals and changes from an active paid plan can both checkout', async () => {
  const endsAt = new Date(now + 86400000).toISOString();
  assert.equal((await fixture({ currentCode: 'starter', endsAt }).service.createOrder('owner', { planId })).checkoutAvailable, true);
  assert.equal((await fixture({ currentCode: 'creator', endsAt }).service.createOrder('owner', { planId })).checkoutAvailable, true);
  const upgrade = fixture({ currentCode: 'starter', targetCode: 'creator', endsAt });
  assert.equal((await upgrade.service.createOrder('owner', { planId })).checkoutAvailable, true);
  assert.equal(upgrade.orders[0].amount_idr, 59000);
  assert.equal(upgrade.orders[0].monthly_credits, 600);
});
test('a paid plan without an end date is rejected before charging for an unschedulable purchase', async () => {
  const { service, created } = fixture({ currentCode: 'starter', targetCode: 'creator' });
  await assert.rejects(service.createOrder('owner', { planId }), { status: 409, code: 'SUBSCRIPTION_END_DATE_REQUIRED' });
  assert.deepEqual(created, []);
});
test('database pending-order conflict is returned as a recoverable 409', async () => {
  const { service } = fixture({ currentCode: null, insertError: { code: '23505', message: 'pending_subscription_order_unique' } });
  await assert.rejects(service.createOrder('owner', { planId }), { status: 409, code: 'PENDING_SUBSCRIPTION_ORDER_EXISTS' });
});
test('cron recovers a timed-out creation using its original ID even without provider expiry', async () => {
  const { service, orders, created } = fixture({ orphan: true });
  assert.deepEqual(await service.reconcileExpiredPayments(), { processed: 1, failed: 0 });
  assert.deepEqual(created, [orderId]);
  assert.equal(orders[0].provider_reference, 'txn');
  assert.ok(orders[0].provider_expires_at);
});
test('cron restores missing expiry even if the provider reference was already saved', async () => {
  const { service, orders, created } = fixture({ orphan: true });
  orders[0].provider_reference = 'txn';
  await service.reconcileExpiredPayments();
  assert.deepEqual(created, [orderId]);
  assert.ok(orders[0].provider_expires_at);
});
test('recovery settles a completed payment rather than cancelling it', async () => {
  const { service, orders, gateway } = fixture({ orphan: true });
  gateway.status = async () => ({ txn_id: 'txn', order_id: orderId, amount: 29000, is_sandbox: false, status: 'completed' });
  assert.deepEqual(await service.reconcileExpiredPayments(), { processed: 1, failed: 0 });
  assert.equal(orders[0].status, 'paid');
});
test('fresh orders are not recovered and gateway outages leave recoverable pending orders', async () => {
  const { service, orders, created, gateway } = fixture({ orphan: true });
  orders[0].created_at = new Date(now - 60000).toISOString();
  assert.deepEqual(await service.reconcileExpiredPayments(), { processed: 0, failed: 0 });
  assert.deepEqual(created, []);
  orders[0].created_at = new Date(now - 3600000).toISOString();
  gateway.create = async () => { throw new Error('offline'); };
  assert.deepEqual(await service.reconcileExpiredPayments(), { processed: 0, failed: 1 });
  assert.equal(orders[0].status, 'pending');
});

test('passing provider expiry does not cancel pending orders; late completed payments still settle once', async () => {
  const { service, orders, gateway, rpcCalls } = fixture({ orphan: true });
  orders[0].provider_reference = 'txn';
  orders[0].provider_expires_at = new Date(now - 60000).toISOString();
  gateway.cancel = async () => { assert.fail('backend must not request cancellation based on local expiry'); };
  assert.equal((await service.checkOrder('owner', orderId)).status, 'pending');
  assert.equal(orders[0].status, 'pending');
  assert.equal(rpcCalls.length, 0);
  gateway.status = async () => ({ txn_id: 'txn', order_id: orderId, amount: 29000, is_sandbox: false, status: 'completed' });
  assert.equal((await service.checkOrder('owner', orderId)).status, 'paid');
  assert.equal((await service.checkOrder('owner', orderId)).duplicate, true);
  assert.equal(rpcCalls.filter(call => call.name === 'settle_pakasir_payment').length, 1);
});
test('expired pending orders stay recoverable across repeated cron runs and a provider timeout', async () => {
  const { service, orders, gateway, rpcCalls } = fixture({ orphan: true });
  orders[0].provider_reference = 'txn';
  orders[0].provider_expires_at = new Date(now - 60000).toISOString();
  gateway.cancel = async () => { assert.fail('cron must follow Pakasir status without issuing cancellation'); };
  for (let i = 0; i < 2; i++) assert.deepEqual(await service.reconcileExpiredPayments(), { processed: 1, failed: 0 });
  assert.equal(orders[0].status, 'pending');
  gateway.status = async () => { throw new Error('provider timeout'); };
  assert.deepEqual(await service.reconcileExpiredPayments(), { processed: 0, failed: 1 });
  assert.equal(orders[0].status, 'pending');
  assert.equal(rpcCalls.length, 0);
});
test('only Pakasir canceled status cancels a local order, preserving the provider reason', async () => {
  const { service, orders, gateway, rpcCalls } = fixture({ orphan: true });
  orders[0].provider_reference = 'txn';
  orders[0].provider_expires_at = new Date(now - 60000).toISOString();
  gateway.status = async () => ({ txn_id: 'txn', order_id: orderId, amount: 29000, is_sandbox: false, status: 'canceled' });
  assert.equal((await service.checkOrder('owner', orderId)).status, 'cancelled');
  assert.equal(rpcCalls[0].args.p_reason, 'provider_cancelled');
  assert.equal(rpcCalls.some(call => call.name === 'settle_pakasir_payment'), false);
});

test('cron reaches later completed payments even when earlier batches stay pending or time out', async () => {
  for (const timeout of [false, true]) {
    const { service, orders, gateway } = fixture({ orphan: true });
    const template = { ...orders[0], provider_expires_at: new Date(now - 60000).toISOString() };
    orders.length = 0;
    for (let index = 0; index < 3; index++) {
      const createdAt = new Date(now - 3600000 + index * 1000).toISOString();
      orders.push({ ...template, id: `00000000-0000-4000-8000-${String(index + 3).padStart(12, '0')}`,
        provider_reference: `txn-${index}`, created_at: createdAt, updated_at: createdAt });
    }
    gateway.status = async ref => {
      const order = orders.find(row => row.provider_reference === ref);
      if (timeout && ref !== 'txn-2') throw new Error('provider timeout');
      return { txn_id: ref, order_id: order.id, amount: 29000, is_sandbox: false, status: ref === 'txn-2' ? 'completed' : 'pending' };
    };
    await service.reconcileExpiredPayments({ limit: 2 });
    assert.equal(orders[2].status, 'pending');
    await service.reconcileExpiredPayments({ limit: 2 });
    assert.equal(orders[2].status, 'paid', `later order must be checked when older orders ${timeout ? 'time out' : 'stay pending'}`);
  }
});

test('three pending topups are allowed, a fourth is rejected, and existing checkout can be retried', async () => {
  const { service, orders, created } = fixture({ currentCode: 'starter' });
  const order = await service.createOrder('owner', { packageId: planId });
  const second = await service.createOrder('owner', { packageId: planId });
  const third = await service.createOrder('owner', { packageId: planId });
  await assert.rejects(service.createOrder('owner', { packageId: planId }), { status: 409, code: 'PENDING_TOPUP_ORDER_EXISTS' });
  assert.equal(orders.length, 3);
  await service.retryCheckout('owner', order.id);
  assert.deepEqual(created, [order.id, second.id, third.id, order.id]);
});
test('pending subscription and topup limits are independent', async () => {
  // Active subscription lookup uses the wall clock, independently of the checkout clock.
  const { service, orders } = fixture({ currentCode: 'starter', endsAt: new Date(Date.now() + 86400000).toISOString() });
  await service.createOrder('owner', { planId });
  await service.createOrder('owner', { packageId: planId });
  assert.deepEqual(orders.map(row => row.order_type), ['subscription', 'topup']);
  await service.createOrder('owner', { packageId: planId });
  await service.createOrder('owner', { packageId: planId });
  await assert.rejects(service.createOrder('owner', { planId }), { code: 'PENDING_SUBSCRIPTION_ORDER_EXISTS' });
  await assert.rejects(service.createOrder('owner', { packageId: planId }), { code: 'PENDING_TOPUP_ORDER_EXISTS' });
});
test('an expired pending topup releases its slot without changing its payment status', async () => {
  const { service, orders, gateway } = fixture({ currentCode: 'starter' });
  const order = await service.createOrder('owner', { packageId: planId });
  orders[0].provider_expires_at = new Date(now - 60000).toISOString();
  assert.equal((await service.createOrder('owner', { packageId: planId })).checkoutAvailable, true);
  await assert.rejects(service.retryCheckout('owner', order.id), { status: 409, code: 'TOPUP_PAYMENT_WINDOW_EXPIRED' });
  assert.equal(orders[0].status, 'pending');
  assert.equal(orders.length, 2);
  gateway.status = async () => ({ txn_id: 'txn', order_id: order.id, amount: 15000, is_sandbox: false, status: 'canceled' });
  assert.equal((await service.checkOrder('owner', order.id)).status, 'cancelled');
  await service.createOrder('owner', { packageId: planId });
  await service.createOrder('owner', { packageId: planId });
  await assert.rejects(service.createOrder('owner', { packageId: planId }), { code: 'PENDING_TOPUP_ORDER_EXISTS' });
});
test('topup expiry releases at the exact boundary, but unknown expiry requires retry', async () => {
  const { service, orders } = fixture({ currentCode: 'starter' });
  await service.createOrder('owner', { packageId: planId });
  orders[0].provider_expires_at = new Date(now).toISOString();
  assert.equal((await service.createOrder('owner', { packageId: planId })).checkoutAvailable, true);
  orders[1].provider_expires_at = null;
  await service.createOrder('owner', { packageId: planId });
  await service.createOrder('owner', { packageId: planId });
  orders[2].provider_expires_at = null;
  orders[3].provider_expires_at = null;
  await assert.rejects(service.createOrder('owner', { packageId: planId }), { code: 'PENDING_TOPUP_ORDER_EXISTS' });
});
test('late payment on an expired topup still credits the original order after a new order exists', async () => {
  const { service, orders, gateway } = fixture({ currentCode: 'starter' });
  const old = await service.createOrder('owner', { packageId: planId });
  orders[0].provider_expires_at = new Date(now - 1).toISOString();
  await service.createOrder('owner', { packageId: planId });
  gateway.status = async () => ({ txn_id: 'txn', order_id: old.id, amount: 15000, is_sandbox: false, status: 'completed' });
  assert.equal((await service.checkOrder('owner', old.id)).status, 'paid');
  assert.equal(orders[1].status, 'pending');
  await service.createOrder('owner', { packageId: planId });
  await service.createOrder('owner', { packageId: planId });
  await assert.rejects(service.createOrder('owner', { packageId: planId }), { code: 'PENDING_TOPUP_ORDER_EXISTS' });
});
test('paid topups release their pending slot', async () => {
  const { service, gateway } = fixture({ currentCode: 'starter' });
  const order = await service.createOrder('owner', { packageId: planId });
  gateway.status = async () => ({ txn_id: 'txn', order_id: order.id, amount: 15000, is_sandbox: false, status: 'completed' });
  assert.equal((await service.checkOrder('owner', order.id)).status, 'paid');
  assert.equal((await service.createOrder('owner', { packageId: planId })).checkoutAvailable, true);
});
test('topup DB conflicts are recoverable and Free users still cannot topup', async () => {
  await assert.rejects(fixture({ currentCode: 'starter', insertError: { code: '23505', message: 'pending_topup_order_unique' } })
    .service.createOrder('owner', { packageId: planId }), { status: 409, code: 'PENDING_TOPUP_ORDER_EXISTS' });
  await assert.rejects(fixture().service.createOrder('owner', { packageId: planId }), { status: 403, code: 'PAID_PLAN_REQUIRED' });
});
