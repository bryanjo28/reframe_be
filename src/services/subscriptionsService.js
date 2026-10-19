const { getActiveUserSubscription } = require("./subscriptionUsageService");

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

async function getCurrentUserSubscription({ supabase, userId }) {
  if (!supabase) {
    throw createHttpError("Supabase client is required", 500);
  }

  if (!userId) {
    throw createHttpError("Missing required field: userId", 400);
  }

  const activeSubscription = await getActiveUserSubscription({ supabase, userId });

  const { getSubscriptionTimeline } = require('./subscriptionPeriodsService');
  const timeline = await getSubscriptionTimeline({ supabase, userId });
  return {
    subscription: activeSubscription?.subscription || null,
    plan: activeSubscription?.plan || null,
    ...timeline,
    active: timeline.active || (activeSubscription ? { ...activeSubscription.subscription, plan: activeSubscription.plan } : null),
    coverageEndsAt: timeline.coverageEndsAt || activeSubscription?.subscription?.endsAt || null,
  };
}

module.exports = {
  getCurrentUserSubscription,
};
