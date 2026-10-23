const assert = require('node:assert/strict');
const { DEFAULTS } = require('../src/services/subscriptionPricingService');
const { listSubscriptionPlans, mapSubscriptionPlanRow } = require('../src/services/subscriptionPlansService');

const planRows = [
  { id: 'free-id', code: 'free', name: 'Free', price: 0, currency: 'IDR', max_personas: 1, content_pillars: 1, max_threads_accounts: 0, can_schedule: false, monthly_ai_credits: 6, token_allowance: 30000, is_active: true },
  { id: 'starter-id', code: 'starter', name: 'Starter', price: 29000, currency: 'IDR', max_personas: 2, content_pillars: 3, max_threads_accounts: 1, can_schedule: true, monthly_ai_credits: 200, token_allowance: 1000000, is_active: true },
  { id: 'creator-id', code: 'creator', name: 'Creator', price: 59000, currency: 'IDR', max_personas: 5, content_pillars: 10, max_threads_accounts: 1, can_schedule: true, monthly_ai_credits: 600, token_allowance: 3000000, is_active: true },
  { id: 'pro-id', code: 'pro', name: 'Pro', price: 99000, currency: 'IDR', max_personas: 10, content_pillars: 20, max_threads_accounts: 1, can_schedule: true, monthly_ai_credits: 1200, token_allowance: 6000000, is_active: true },
];

function createDb() {
  return {
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          return table === 'subscription_pricing_config'
            ? { data: { singleton: true, version: 4, published: DEFAULTS, draft: DEFAULTS, published_at: '2026-10-21T00:00:00.000Z' }, error: null }
            : { data: null, error: null };
        },
        async order() {
          return table === 'subscription_plans' ? { data: planRows, error: null } : { data: [], error: null };
        },
      };
      return query;
    },
  };
}

async function main() {
  const mapped = mapSubscriptionPlanRow({
    id: 'plan-1', code: 'free', name: 'Free', max_personas: 1, content_pillars: 1,
    max_threads_accounts: 0, can_schedule: false, monthly_ai_credits: 6, is_active: true,
  });
  assert.equal(mapped.maxContentPillars, 1);
  assert.equal(mapped.maxThreadsAccounts, 0);
  assert.equal(mapped.canSchedule, false);

  const plans = await listSubscriptionPlans({ db: createDb() });
  assert.equal(plans.length, 4);
  assert.deepEqual(plans.map(plan => plan.code), ['free', 'starter', 'creator', 'pro']);

  const free = plans[0];
  assert.equal(free.monthly_ai_credits, 6);
  assert.equal(free.max_personas, 1);
  assert.equal(free.content_pillars, 1);
  assert.equal(free.max_threads_accounts, 0);
  assert.equal(free.can_schedule, false);

  const starter = plans[1];
  assert.equal(starter.monthly_ai_credits, 200);
  assert.equal(starter.max_personas, 2);
  assert.equal(starter.content_pillars, 3);
  assert.equal(starter.max_threads_accounts, 1);
  assert.equal(starter.can_schedule, true);
  assert.equal(starter.price, DEFAULTS.plans.starter.prices[3]);
  assert.equal(starter.monthlyPrice, DEFAULTS.plans.starter.prices[1]);
  assert.deepEqual(starter.pricing.prices, DEFAULTS.plans.starter.prices);
  assert.deepEqual(starter.enabledDurations, [1, 3, 12]);

  const creator = plans[2];
  assert.equal(creator.max_personas, 5);
  assert.equal(creator.content_pillars, 10);
  assert.equal(creator.monthly_ai_credits, 600);

  const pro = plans[3];
  assert.equal(pro.max_personas, 10);
  assert.equal(pro.content_pillars, 20);
  assert.equal(pro.monthly_ai_credits, 1200);

  console.log('ok - plan API returns screenshot entitlements and the same published prices used by checkout');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
