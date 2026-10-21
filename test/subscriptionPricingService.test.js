const assert = require('node:assert/strict');
const { DEFAULTS, createSubscriptionPricingService, validateConfig } = require('../src/services/subscriptionPricingService');
const { createPaymentsService } = require('../src/services/pakasirPaymentsService');

async function main() {
  const expected = {
    starter: { monthlyCredits: 200, prices: { 1: 29000, 3: 74000, 12: 249000 } },
    creator: { monthlyCredits: 600, prices: { 1: 59000, 3: 149000, 12: 499000 } },
    pro: { monthlyCredits: 1200, prices: { 1: 99000, 3: 249000, 12: 839000 } },
  };
  const config = validateConfig(DEFAULTS);
  assert.deepEqual(config.enabledDurations, [1, 3, 12]);
  for (const [plan, definition] of Object.entries(expected)) {
    const prices = definition.prices;
    for (const [duration, amount] of Object.entries(prices)) assert.equal(config.plans[plan].prices[duration], amount);
  }
  assert.throws(() => validateConfig({ ...config, defaultDurationMonths: 6 }), { code: 'INVALID_PRICING_CONFIG' });
  assert.throws(() => validateConfig({ ...config, enabledDurations: [1, 6] }), { code: 'INVALID_PRICING_CONFIG' });
  assert.throws(() => validateConfig({ ...config, plans: { ...config.plans, creator: { ...config.plans.creator, prices: { ...config.plans.creator.prices, 12: -1 } } } }), { code: 'INVALID_PRICING_CONFIG' });

  const configRow = { singleton: true, version: 8, draft: config, published: config, published_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' };
  const pricing = createSubscriptionPricingService({ db: {
    from(table) {
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: table === 'subscription_pricing_config' ? configRow : null, error: null }; } };
    },
  } });
  assert.equal((await pricing.getPublished()).version, 8);

  const productId = '00000000-0000-4000-8000-000000000012';
  let product = { id: productId, price: 59000, monthly_ai_credits: 600, code: 'creator', is_active: true };
  const orders = [];
  const paymentDb = {
    from(table) {
      const filters = {};
      let inserted = null;
      return {
        select() { return this; }, eq(key, value) { filters[key] = value; return this; }, lte() { return this; }, order() { return this; }, limit() { return this; },
        async maybeSingle() {
          if (table === 'subscription_pricing_config') return { data: configRow, error: null };
          if (table === 'subscription_plans') return { data: product, error: null };
          if (table === 'payment_orders') return { data: filters.status === 'pending' ? null : null, error: null };
          if (table === 'user_subscriptions') return { data: null, error: null };
          return { data: null, error: null };
        },
        insert(row) { inserted = { ...row }; orders.push(inserted); return this; },
        async single() { return { data: inserted, error: null }; },
        update() { return this; }, then(resolve) { resolve({ error: null }); },
      };
    },
  };
  const gateway = { configured() {}, async create(id, amount, method) { return { txn_id: `txn-${id}`, order_id: id, project: 'test-shop', amount, payment_method: method,
    expired_at: '2099-01-01T00:00:00.000Z', qr_string: 'test-qr', va_number: '' }; } };
  const payments = createPaymentsService({ db: paymentDb, gateway, env: { PAKASIR_SLUG: 'test-shop' } });
  for (const [planCode, definition] of Object.entries(expected)) {
    product = { ...product, code: planCode, monthly_ai_credits: definition.monthlyCredits };
    for (const [durationText, total] of Object.entries(definition.prices)) {
      const duration = Number(durationText);
      await payments.createOrder('user-1', { planId: productId, durationMonths: duration, amount: 1, credits: 999999 });
      const order = orders.at(-1);
      assert.equal(order.amount_idr, total, `${planCode} ${duration} month checkout uses configured total`);
      assert.equal(order.monthly_price_idr, definition.prices[1]);
      assert.equal(order.monthly_credits, definition.monthlyCredits, 'duration never multiplies the monthly grant');
      assert.equal(order.duration_months, duration);
      assert.equal(order.pricing_config_version, 8);
    }
  }
  await assert.rejects(payments.createOrder('user-1', { planId: productId, durationMonths: 6 }), { code: 'INVALID_SUBSCRIPTION_DURATION' });

  const configWith12Disabled = { ...configRow, published: { ...config, enabledDurations: [1, 3], defaultDurationMonths: 3 } };
  const disabledPayments = createPaymentsService({
    db: { from(table) {
      const filters = {};
      let inserted = null;
      return {
        select() { return this; }, eq(key, value) { filters[key] = value; return this; }, lte() { return this; }, order() { return this; }, limit() { return this; },
        async maybeSingle() {
          if (table === 'subscription_pricing_config') return { data: configWith12Disabled, error: null };
          if (table === 'subscription_plans') return { data: product, error: null };
          return { data: null, error: null };
        },
        insert(row) { inserted = row; return this; }, async single() { return { data: inserted, error: null }; },
        update() { return this; }, then(resolve) { resolve({ error: null }); },
      };
    } },
    gateway, env: { PAKASIR_SLUG: 'test-shop' },
  });
  await assert.rejects(disabledPayments.createOrder('user-1', { planId: productId, durationMonths: 12 }), { code: 'SUBSCRIPTION_DURATION_UNAVAILABLE' });
  console.log('ok - published subscription pricing, all configured durations, server-owned amount, and monthly credits snapshot');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
