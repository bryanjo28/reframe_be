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

  if (!activeSubscription) {
    throw createHttpError("No active subscription found for this user", 404);
  }

  return activeSubscription;
}

module.exports = {
  getCurrentUserSubscription,
};
