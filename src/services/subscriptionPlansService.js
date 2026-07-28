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
    monthlyAiCredits: row.monthly_ai_credits,
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

  const { data, error } = await client
    .from("subscription_plans")
    .select("id, code, name, price, max_personas, monthly_ai_credits, daily_topic_generations, daily_content_generations, is_active, created_at")
    .eq("is_active", true)
    .order("price", { ascending: true });

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return (data || []).map(mapSubscriptionPlanRow);
}

module.exports = {
  listSubscriptionPlans,
  mapSubscriptionPlanRow,
};
