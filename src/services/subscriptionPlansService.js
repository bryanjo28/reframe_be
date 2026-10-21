function mapSubscriptionPlanRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    price: row.price,
    maxPersonas: row.max_personas,
    maxContentPillars: row.content_pillars ?? row.max_content_pillars,
    maxThreadsAccounts: row.max_threads_accounts,
    canSchedule: row.can_schedule,
    monthlyAiCredits: row.monthly_ai_credits,
    tokenAllowance: row.token_allowance || Number(row.monthly_ai_credits || 0) * 5000,
    currency: row.currency || "IDR",
    dailyTopicGenerations: row.daily_topic_generations,
    dailyContentGenerations: row.daily_content_generations,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

async function listSubscriptionPlans({ db } = {}) {
  // Always include published duration pricing and the same plan catalog data
  // used by payment creation. The public request-scoped client cannot read the
  // service-only pricing configuration table.
  return require('./subscriptionPricingService').createSubscriptionPricingService({ db }).listPlans();
}

module.exports = {
  listSubscriptionPlans,
  mapSubscriptionPlanRow,
};
