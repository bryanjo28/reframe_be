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

  const [monthlyUsage, topicDailyUsage, contentDailyUsage] = await Promise.all([
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
  ]);

  const plan = activeSubscription.plan;

  return {
    subscription: activeSubscription.subscription,
    plan,
    periodMonth,
    usageDate,
    monthlyUsage: mapMonthlyUsageSummary({
      plan,
      usage: monthlyUsage.usage,
      periodMonth,
    }),
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
