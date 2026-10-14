const { getCurrentPeriodMonth } = require("./userUsageService");
const {
  getActiveUserSubscription,
  getCurrentMonthlyAiUsage,
} = require("./subscriptionUsageService");
const {
  getCurrentDailyUsage,
  getDailyLimitFromPlan,
  getUsageDate,
} = require("./dailyGenerationUsageService");

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

function mapMonthlyUsageSummary({ plan, usage, periodMonth }) {
  const monthlyLimit = Number(plan?.monthlyAiCredits || 0);
  const aiCreditsUsed = usage?.aiCreditsUsed || 0;

  return {
    periodMonth: usage?.periodMonth || periodMonth || null,
    usage: usage || null,
    limit: monthlyLimit,
    used: aiCreditsUsed,
    remaining: monthlyLimit > 0 ? Math.max(0, monthlyLimit - aiCreditsUsed) : null,
    unlimited: monthlyLimit === 0,
  };
}

function mapDailyUsageSummary({ plan, usageKey, usage, usageDate }) {
  const dailyLimit = getDailyLimitFromPlan(plan, usageKey);
  const requestCount = usage?.requestCount || 0;

  return {
    usageKey,
    usageDate: usage?.usageDate || usageDate || null,
    usage: usage || null,
    limit: dailyLimit,
    used: requestCount,
    remaining: dailyLimit > 0 ? Math.max(0, dailyLimit - requestCount) : null,
    unlimited: dailyLimit === 0,
  };
}

async function getMyUsageSummary({ supabase, userId, now = new Date() }) {
  if (!supabase) {
    throw createHttpError("Supabase client is required", 500);
  }

  if (!userId) {
    throw createHttpError("Missing required field: userId", 400);
  }

  const activeSubscription = await getActiveUserSubscription({ supabase, userId });
  if (!activeSubscription) {
    throw createHttpError("No active subscription found for this user", 404);
  }

  const periodMonth = getCurrentPeriodMonth(now);
  const usageDate = getUsageDate(now);

  const [monthlyUsage, topicDailyUsage, contentDailyUsage, walletResult, creditLotsResult, historyResult] = await Promise.all([
    getCurrentMonthlyAiUsage({
      supabase,
      userId,
      periodMonth,
      now,
    }),
    getCurrentDailyUsage({
      supabase,
      userId,
      usageKey: "generate_topic",
      usageDate,
      now,
    }),
    getCurrentDailyUsage({
      supabase,
      userId,
      usageKey: "generate_content",
      usageDate,
      now,
    }),
    supabase.from("token_wallets").select("balance, updated_at").eq("user_id", userId).maybeSingle(),
    supabase.from("credit_lots").select("credit_type, original_credits, remaining_credits, expires_at").eq("user_id", userId),
    supabase.from("ai_usage_logs").select("request_id, feature, model, total_tokens, credits_charged, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
  ]);

  const plan = activeSubscription.plan;

  const monthlySummary = mapMonthlyUsageSummary({
    plan,
    usage: monthlyUsage.usage,
    periodMonth,
  });
  if (!walletResult.error && walletResult.data) {
    monthlySummary.remaining = Number(walletResult.data.balance || 0);
    monthlySummary.limit = monthlySummary.used + monthlySummary.remaining;
    monthlySummary.unlimited = false;
  }

  const activeLots = creditLotsResult.error ? [] : (creditLotsResult.data || []).filter((lot) => !lot.expires_at || new Date(lot.expires_at) > now);
  const subscriptionCredits = activeLots.filter((lot) => lot.credit_type !== "topup").reduce((sum, lot) => sum + Number(lot.remaining_credits || 0), 0);
  const topUpCredits = activeLots.filter((lot) => lot.credit_type === "topup").reduce((sum, lot) => sum + Number(lot.remaining_credits || 0), 0);
  if (activeLots.length) {
    monthlySummary.remaining = subscriptionCredits + topUpCredits;
    monthlySummary.limit = activeLots.reduce((sum, lot) => sum + Number(lot.original_credits || 0), 0);
    monthlySummary.used = Math.max(0, monthlySummary.limit - monthlySummary.remaining);
    monthlySummary.unlimited = false;
  }

  return {
    subscription: activeSubscription.subscription,
    plan,
    periodMonth,
    usageDate,
    wallet: !walletResult.error ? walletResult.data : null,
    credits: {
      subscription: subscriptionCredits,
      topUp: topUpCredits,
      total: subscriptionCredits + topUpCredits,
      nearestTopUpExpiration: activeLots.filter((lot) => lot.credit_type === "topup" && lot.expires_at).map((lot) => lot.expires_at).sort()[0] || null,
    },
    usageHistory: historyResult.error ? [] : historyResult.data || [],
    monthlyUsage: monthlySummary,
    dailyUsage: {
      generateTopic: mapDailyUsageSummary({
        plan,
        usageKey: "generate_topic",
        usage: topicDailyUsage.usage,
        usageDate,
      }),
      generateContent: mapDailyUsageSummary({
        plan,
        usageKey: "generate_content",
        usage: contentDailyUsage.usage,
        usageDate,
      }),
    },
  };
}

module.exports = {
  getMyUsageSummary,
  mapDailyUsageSummary,
  mapMonthlyUsageSummary,
};
