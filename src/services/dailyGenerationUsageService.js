const { getActiveUserSubscription } = require("./subscriptionUsageService");

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

function getUsageDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeUsageKey(usageKey) {
  return String(usageKey || "").trim();
}

function mapDailyUsageRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    usageDate: row.usage_date,
    usageKey: row.usage_key,
    requestCount: row.request_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDailyLimitFromPlan(plan, usageKey) {
  if (!plan) {
    return 0;
  }

  if (usageKey === "generate_topic") {
    return Number(plan.dailyTopicGenerations || 0);
  }

  if (usageKey === "generate_content") {
    return Number(plan.dailyContentGenerations || 0);
  }

  return 0;
}

async function getCurrentDailyUsage({ supabase, userId, usageKey, usageDate, now = new Date() }) {
  if (!supabase) {
    throw createHttpError("Supabase client is required", 500);
  }

  if (!userId) {
    throw createHttpError("Missing required field: userId", 400);
  }

  const targetUsageDate = usageDate || getUsageDate(now);
  const normalizedUsageKey = normalizeUsageKey(usageKey);

  if (!normalizedUsageKey) {
    throw createHttpError("Missing required field: usageKey", 400);
  }

  const { data, error } = await supabase
    .from("user_daily_usage")
    .select("id, user_id, usage_date, usage_key, request_count, created_at, updated_at")
    .eq("user_id", userId)
    .eq("usage_date", targetUsageDate)
    .eq("usage_key", normalizedUsageKey)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return {
    usageDate: targetUsageDate,
    usage: data ? mapDailyUsageRow(data) : null,
  };
}

async function consumeDailyGenerationHit({
  supabase,
  userId,
  usageKey,
  usageDate,
  now = new Date(),
}) {
  if (!supabase) {
    throw createHttpError("Supabase client is required", 500);
  }

  const normalizedUsageKey = normalizeUsageKey(usageKey);
  if (!normalizedUsageKey) {
    throw createHttpError("Missing required field: usageKey", 400);
  }

  const activeSubscription = await getActiveUserSubscription({ supabase, userId });
  if (!activeSubscription) {
    throw createHttpError("No active subscription found for this user", 403);
  }

  const dailyLimit = getDailyLimitFromPlan(activeSubscription.plan, normalizedUsageKey);
  if (!Number.isFinite(dailyLimit) || dailyLimit < 0) {
    throw createHttpError("Invalid daily limit on subscription plan", 500);
  }

  if (dailyLimit === 0) {
    return {
      subscription: activeSubscription.subscription,
      plan: activeSubscription.plan,
      usage: null,
      usageKey: normalizedUsageKey,
      usageDate: usageDate || getUsageDate(now),
      remainingHits: null,
      dailyLimit: 0,
      unlimited: true,
    };
  }

  const { usageDate: targetUsageDate, usage: currentUsage } = await getCurrentDailyUsage({
    supabase,
    userId,
    usageKey: normalizedUsageKey,
    usageDate,
    now,
  });

  const currentHits = currentUsage?.requestCount || 0;
  const nextHits = currentHits + 1;

  if (nextHits > dailyLimit) {
    throw createHttpError("Daily generation limit exceeded", 402, {
      dailyLimit,
      currentHits,
      requestedHits: 1,
      remainingHits: Math.max(0, dailyLimit - currentHits),
      usageKey: normalizedUsageKey,
      usageDate: targetUsageDate,
    });
  }

  const { data, error } = currentUsage
    ? await supabase
        .from("user_daily_usage")
        .update({
          request_count: nextHits,
          updated_at: now.toISOString(),
        })
        .eq("id", currentUsage.id)
        .select("id, user_id, usage_date, usage_key, request_count, created_at, updated_at")
        .single()
    : await supabase
        .from("user_daily_usage")
        .insert({
          user_id: userId,
          usage_date: targetUsageDate,
          usage_key: normalizedUsageKey,
          request_count: 1,
        })
        .select("id, user_id, usage_date, usage_key, request_count, created_at, updated_at")
        .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return {
    subscription: activeSubscription.subscription,
    plan: activeSubscription.plan,
    usage: mapDailyUsageRow(data),
    usageKey: normalizedUsageKey,
    usageDate: targetUsageDate,
    remainingHits: dailyLimit - nextHits,
    dailyLimit,
    unlimited: false,
  };
}

module.exports = {
  consumeDailyGenerationHit,
  getCurrentDailyUsage,
  getDailyLimitFromPlan,
  getUsageDate,
  mapDailyUsageRow,
};
