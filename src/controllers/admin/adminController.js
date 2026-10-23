const adminService = require("../../services/admin/adminService");
const subscriptionPricingService = require("../../services/subscriptionPricingService");

async function getSubscriptionPricing(req, res, next) {
  try { return res.status(200).json({ success: true, data: await subscriptionPricingService.getAdminConfig() }); }
  catch (error) { return next(error); }
}

async function saveSubscriptionPricingDraft(req, res, next) {
  try { return res.status(200).json({ success: true, data: await subscriptionPricingService.saveDraft(req.body?.config, req.user.id) }); }
  catch (error) { return next(error); }
}

async function publishSubscriptionPricing(req, res, next) {
  try { return res.status(200).json({ success: true, data: await subscriptionPricingService.publish(req.user.id) }); }
  catch (error) { return next(error); }
}

async function getOverview(req, res, next) {
  try {
    const data = await adminService.getOverview(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getSubscriptionFinancials(req, res, next) {
  try {
    const data = await adminService.getSubscriptionFinancials({ from: req.query.from, to: req.query.to });
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
}

function list(method) {
  return async (req, res, next) => {
    try {
      const data = await adminService[method](req.query);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  };
}

async function getUserDetails(req, res, next) {
  try {
    const data = await adminService.getUserDetails({ ...req.query, userId: req.params.userId });
    return res.status(data ? 200 : 404).json({ success: Boolean(data), data, message: data ? undefined : "User not found" });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getAiUsage: list("getAiUsage"),
  getAuditLogs: list("getAuditLogs"),
  getErrorLogs: list("getErrorLogs"),
  getFeedback: list("getFeedback"),
  getOverview,
  getSubscriptionFinancials,
  getProfitability: list("getProfitability"),
  getScheduledPosts: list("getScheduledPosts"),
  getTransactions: list("getTransactions"),
  getUsers: list("getUsers"),
  getUserDetails,
  getSubscriptionPricing,
  saveSubscriptionPricingDraft,
  publishSubscriptionPricing,
};
