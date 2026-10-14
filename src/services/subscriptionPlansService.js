const {
  isSupabaseConfigured,
  supabase: publicSupabase,
} = require("../config/supabase");

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

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
    maxContentPillars: row.content_pillars,
    monthlyAiCredits: row.monthly_ai_credits,
    tokenAllowance: row.token_allowance || Number(row.monthly_ai_credits || 0) * 5000,
    currency: row.currency || "IDR",
    dailyTopicGenerations: row.daily_topic_generations,
    dailyContentGenerations: row.daily_content_generations,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

async function listSubscriptionPlans({ supabase } = {}) {
  const client = supabase || publicSupabase;

  if (!isSupabaseConfigured || !client) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  let { data, error } = await client
    .from("subscription_plans")
    .select("id, code, name, price, currency, max_personas, content_pillars, monthly_ai_credits, token_allowance, daily_topic_generations, daily_content_generations, is_active, created_at")
    .eq("is_active", true)
    .order("price", { ascending: true });

  // Keep the application usable while an additive billing migration is being
  // deployed. Values absent from the legacy schema are derived by the mapper.
  if (error && /currency|token_allowance|column .* does not exist/i.test(error.message || "")) {
    const legacyResult = await client
      .from("subscription_plans")
      .select("id, code, name, price, max_personas, content_pillars, monthly_ai_credits, daily_topic_generations, daily_content_generations, is_active, created_at")
      .eq("is_active", true)
      .order("price", { ascending: true });
    data = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return (data || []).map(mapSubscriptionPlanRow);
}

module.exports = {
  listSubscriptionPlans,
  mapSubscriptionPlanRow,
};
