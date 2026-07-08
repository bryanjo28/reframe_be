const usageService = require("../services/usageService");

async function getMyUsage(req, res, next) {
  try {
    const data = await usageService.getMyUsageSummary({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Usage summary fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMyUsage,
};
