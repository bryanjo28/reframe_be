const subscriptionPlansService = require("../services/subscriptionPlansService");

async function listSubscriptionPlans(req, res, next) {
  try {
    const data = await subscriptionPlansService.listSubscriptionPlans({
      supabase: req.supabase,
    });

    res.status(200).json({
      success: true,
      message: "Subscription plans fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listSubscriptionPlans,
};
