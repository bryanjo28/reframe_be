const { supabaseAdmin, isSupabaseAdminConfigured } = require('../config/supabase');
const { SUBSCRIPTION_PLANS } = require('../config/billing');

const DURATIONS = [1, 3, 12];
const PLAN_CODES = ['starter', 'creator', 'pro'];
const DEFAULTS = Object.freeze({
  defaultDurationMonths: 3,
  enabledDurations: DURATIONS,
  expiryReminderDays: [7, 3, 1],
  renewalPolicy: 'queue_after_paid_coverage',
  plans: {
    starter: { prices: { 1: 29000, 3: 74000, 12: 249000 }, monthlyAiCredits: 200 },
    creator: { prices: { 1: 59000, 3: 149000, 12: 499000 }, monthlyAiCredits: 600 },
    pro: { prices: { 1: 99000, 3: 249000, 12: 839000 }, monthlyAiCredits: 1200 },
  },
});

function httpError(message, status = 500, code = 'SUBSCRIPTION_PRICING_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

function validateConfig(input) {
  const config = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!config) throw httpError('Pricing configuration must be an object.', 400, 'INVALID_PRICING_CONFIG');
  const enabledDurations = config.enabledDurations;
  if (!Array.isArray(enabledDurations) || !enabledDurations.length || enabledDurations.some(value => !DURATIONS.includes(value)) || new Set(enabledDurations).size !== enabledDurations.length) {
    throw httpError('Enabled durations must be selected from 1, 3, and 12 months.', 400, 'INVALID_PRICING_CONFIG');
  }
  if (!enabledDurations.includes(config.defaultDurationMonths)) throw httpError('The default duration must be enabled.', 400, 'INVALID_PRICING_CONFIG');
  if (!Array.isArray(config.expiryReminderDays) || config.expiryReminderDays.some(value => ![7, 3, 1].includes(value)) || new Set(config.expiryReminderDays).size !== config.expiryReminderDays.length) {
    throw httpError('Reminder days may only contain 7, 3, or 1.', 400, 'INVALID_PRICING_CONFIG');
  }
  // Older admin clients can submit their existing drafts; normalize their
  // policy to the queued purchase behavior without changing prices.
  if (![DEFAULTS.renewalPolicy, 'same_plan_only'].includes(config.renewalPolicy)) throw httpError('Unsupported renewal policy.', 400, 'INVALID_PRICING_CONFIG');
  if (!config.plans || typeof config.plans !== 'object') throw httpError('Plan pricing is required.', 400, 'INVALID_PRICING_CONFIG');
  const plans = {};
  for (const code of PLAN_CODES) {
    const plan = config.plans[code];
    if (!plan || !plan.prices || !Number.isSafeInteger(plan.monthlyAiCredits) || plan.monthlyAiCredits < 1 || plan.monthlyAiCredits > 100000) {
      throw httpError(`Invalid ${code} plan configuration.`, 400, 'INVALID_PRICING_CONFIG');
    }
    const prices = {};
    for (const duration of DURATIONS) {
      const amount = plan.prices[String(duration)];
      if (!Number.isSafeInteger(amount) || amount < 500 || amount > 10000000) throw httpError(`Invalid ${code} ${duration}-month price.`, 400, 'INVALID_PRICING_CONFIG');
      prices[String(duration)] = amount;
    }
    if (prices['3'] <= prices['1'] || prices['3'] >= prices['1'] * 3 ||
        prices['12'] <= prices['3'] || prices['12'] >= prices['1'] * 12) {
      throw httpError(`${code} pricing must increase by duration and discount the 3- and 12-month totals.`, 400, 'INVALID_PRICING_CONFIG');
    }
    plans[code] = { prices, monthlyAiCredits: plan.monthlyAiCredits };
  }
  return {
    defaultDurationMonths: config.defaultDurationMonths,
    enabledDurations: [...enabledDurations].sort((a, b) => a - b),
    expiryReminderDays: [...config.expiryReminderDays].sort((a, b) => b - a),
    renewalPolicy: DEFAULTS.renewalPolicy,
    plans,
  };
}

function createSubscriptionPricingService({ db, now = () => new Date().toISOString() } = {}) {
  const database = () => {
    if (db) return db;
    if (!isSupabaseAdminConfigured || !supabaseAdmin) throw httpError('Subscription pricing database is unavailable.', 503);
    return supabaseAdmin;
  };
  async function readConfig() {
    const { data, error } = await database().from('subscription_pricing_config').select('*').eq('singleton', true).maybeSingle();
    if (error) throw httpError('Subscription pricing configuration could not be loaded.', 503);
    if (!data) throw httpError('Subscription pricing migration is required.', 503, 'SUBSCRIPTION_PRICING_SETUP_REQUIRED');
    return data;
  }
  async function getPublished() {
    const row = await readConfig();
    try {
      return { ...validateConfig(row.published), version: row.version, publishedAt: row.published_at };
    } catch {
      throw httpError('Published subscription pricing is invalid. Correct and republish the pricing configuration before accepting orders.', 503, 'INVALID_PUBLISHED_PRICING_CONFIG');
    }
  }
  async function getAdminConfig() {
    const row = await readConfig();
    const draft = validateConfig(row.draft);
    const published = validateConfig(row.published);
    return { version: row.version, draft, published, publishedAt: row.published_at, updatedAt: row.updated_at,
      impact: { changed: JSON.stringify(draft) !== JSON.stringify(published), fromVersion: row.version, proposedVersion: row.version + 1 } };
  }
  async function writeAudit(adminUserId, action, previous, next, reason) {
    const { error } = await database().from('admin_audit_logs').insert({
      admin_user_id: adminUserId, action, target_type: 'subscription_pricing_config', target_id: 'default',
      previous_values: previous || null, new_values: next, reason,
    });
    if (error) throw httpError('Pricing configuration changed, but its audit log failed. Contact an administrator.', 503, 'PRICING_AUDIT_FAILED');
  }
  async function saveDraft(config, adminUserId) {
    const next = validateConfig(config);
    const row = await readConfig();
    const { data, error } = await database().from('subscription_pricing_config').update({ draft: next, updated_by: adminUserId, updated_at: now() }).eq('singleton', true).select('*').single();
    if (error) throw httpError('Pricing draft could not be saved.', 503);
    await writeAudit(adminUserId, 'subscription.pricing.save_draft', row.draft, next, 'Saved draft subscription pricing and entitlement configuration.');
    return getAdminConfig();
  }
  async function publish(adminUserId) {
    const row = await readConfig();
    const draft = validateConfig(row.draft);
    const { data, error } = await database().rpc('publish_subscription_pricing', { p_config: draft, p_admin_user_id: adminUserId });
    if (error) throw httpError('Subscription pricing could not be published.', 503);
    return getAdminConfig();
  }
  async function listPlans() {
    const [config, plansResult] = await Promise.all([
      getPublished(),
      database().from('subscription_plans').select('id,code,name,price,currency,max_personas,content_pillars,max_threads_accounts,can_schedule,monthly_ai_credits,token_allowance,daily_topic_generations,daily_content_generations,is_active,created_at').eq('is_active', true).order('price'),
    ]);
    let planRows = plansResult.data;
    if (plansResult.error && /token_allowance|currency|max_threads_accounts|can_schedule|column .* does not exist/i.test(plansResult.error.message || '')) {
      const legacy = await database().from('subscription_plans').select('id,code,name,price,max_personas,content_pillars,monthly_ai_credits,daily_topic_generations,daily_content_generations,is_active,created_at').eq('is_active', true).order('price');
      if (legacy.error) throw httpError('Subscription plans could not be loaded.', 503);
      planRows = legacy.data;
    } else if (plansResult.error) throw httpError('Subscription plans could not be loaded.', 503);
    return (planRows || []).map(plan => {
      const configured = config.plans?.[plan.code];
      const fallback = SUBSCRIPTION_PLANS.find(item => item.code === plan.code);
      const monthlyCredits = configured?.monthlyAiCredits ?? plan.monthly_ai_credits ?? fallback?.credits ?? 0;
      return {
        ...plan,
        price: configured?.prices?.[String(config.defaultDurationMonths)] ?? plan.price,
        monthlyPrice: configured?.prices?.['1'] ?? plan.price,
        max_personas: plan.max_personas ?? fallback?.maxPersonas ?? 1,
        content_pillars: plan.content_pillars ?? fallback?.maxContentPillars ?? 1,
        max_threads_accounts: plan.max_threads_accounts ?? fallback?.maxThreadsAccounts ?? 0,
        can_schedule: plan.can_schedule ?? fallback?.canSchedule ?? false,
        monthly_ai_credits: monthlyCredits,
        pricing: configured ? { prices: configured.prices, monthlyAiCredits: monthlyCredits } : null,
        defaultDurationMonths: config.defaultDurationMonths,
        enabledDurations: config.enabledDurations,
        pricingConfigVersion: config.version,
      };
    });
  }
  return { getPublished, getAdminConfig, listPlans, publish, saveDraft };
}

module.exports = { DEFAULTS, DURATIONS, PLAN_CODES, createSubscriptionPricingService, validateConfig, ...createSubscriptionPricingService() };
