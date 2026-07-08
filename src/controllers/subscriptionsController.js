const subscriptionsService = require("../services/subscriptionsService");

async function getMySubscription(req, res, next) {
  try {
    const data = await subscriptionsService.getCurrentUserSubscription({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Current subscription fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMySubscription,
};
