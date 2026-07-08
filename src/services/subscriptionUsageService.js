const {
  getCurrentPeriodMonth,
  normalizeUsageAmount,
  recordUserAiUsage,
} = require("./userUsageService");

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
    maxPersonas: row.max_personas,
    monthlyAiCredits: row.monthly_ai_credits,
    dailyTopicGenerations: row.daily_topic_generations,
    dailyContentGenerations: row.daily_content_generations,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function mapUserSubscriptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status: row.status,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getActiveUserSubscription({ supabase, userId }) {
  if (!supabase) {
    throw createHttpError("Supabase client is required", 500);
  }

  if (!userId) {
    throw createHttpError("Missing required field: userId", 400);
  }

  const { data: subscriptionRow, error: subscriptionError } = await supabase
    .from("user_subscriptions")
    .select("id, user_id, plan_id, status, started_at, ends_at, created_at, updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .maybeSingle();

  if (subscriptionError) {
    throw createHttpError(subscriptionError.message, 400, subscriptionError);
  }

  if (!subscriptionRow) {
    return null;
  }

  const { data: planRow, error: planError } = await supabase
    .from("subscription_plans")
    .select(
      "id, code, name, max_personas, monthly_ai_credits, daily_topic_generations, daily_content_generations, is_active, created_at"
    )
    .eq("id", subscriptionRow.plan_id)
    .maybeSingle();

  if (planError) {
    throw createHttpError(planError.message, 400, planError);
  }

  if (!planRow) {
    throw createHttpError("Subscription plan not found", 404);
  }

  if (!planRow.is_active) {
    throw createHttpError("Subscription plan is inactive", 403);
  }

  return {
    subscription: mapUserSubscriptionRow(subscriptionRow),
    plan: mapSubscriptionPlanRow(planRow),
  };
}

async function getCurrentMonthlyAiUsage({ supabase, userId, periodMonth, now = new Date() }) {
  if (!supabase) {
    throw createHttpError("Supabase client is required", 500);
  }

  if (!userId) {
    throw createHttpError("Missing required field: userId", 400);
  }

  const targetPeriodMonth = periodMonth || getCurrentPeriodMonth(now);

  const { data, error } = await supabase
    .from("user_usage")
    .select("id, user_id, period_month, ai_credits_used, created_at, updated_at")
    .eq("user_id", userId)
    .eq("period_month", targetPeriodMonth)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return {
    periodMonth: targetPeriodMonth,
    usage: data
      ? {
          id: data.id,
          userId: data.user_id,
          periodMonth: data.period_month,
          aiCreditsUsed: data.ai_credits_used,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }
      : null,
  };
}

async function consumeMonthlyAiCredits({ supabase, userId, usage, periodMonth, now = new Date() }) {
  const creditsUsed = normalizeUsageAmount(usage);
  if (creditsUsed <= 0) {
    return null;
  }

  const activeSubscription = await getActiveUserSubscription({ supabase, userId });
  if (!activeSubscription) {
    throw createHttpError("No active subscription found for this user", 403);
  }

  const monthlyLimit = Number(activeSubscription.plan.monthlyAiCredits);
  if (!Number.isFinite(monthlyLimit) || monthlyLimit < 0) {
    throw createHttpError("Invalid monthly AI credit limit on subscription plan", 500);
  }

  const { periodMonth: targetPeriodMonth, usage: currentUsage } = await getCurrentMonthlyAiUsage({
    supabase,
    userId,
    periodMonth,
    now,
  });

  const currentCreditsUsed = currentUsage?.aiCreditsUsed || 0;
  const nextTotal = currentCreditsUsed + creditsUsed;

  if (nextTotal > monthlyLimit) {
    throw createHttpError("Monthly AI credits exceeded", 402, {
      monthlyAiCredits: monthlyLimit,
      aiCreditsUsed: currentCreditsUsed,
      requestedCredits: creditsUsed,
      remainingCredits: Math.max(0, monthlyLimit - currentCreditsUsed),
      periodMonth: targetPeriodMonth,
    });
  }

  const recordedUsage = await recordUserAiUsage({
    supabase,
    userId,
    usage,
    periodMonth: targetPeriodMonth,
    now,
  });

  return {
    subscription: activeSubscription.subscription,
    plan: activeSubscription.plan,
    usage: recordedUsage,
    periodMonth: targetPeriodMonth,
    remainingCredits: monthlyLimit - nextTotal,
    creditsUsed,
  };
}

module.exports = {
  consumeMonthlyAiCredits,
  getActiveUserSubscription,
  getCurrentMonthlyAiUsage,
  mapSubscriptionPlanRow,
  mapUserSubscriptionRow,
};
