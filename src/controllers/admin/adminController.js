const adminService = require("../../services/admin/adminService");

async function getOverview(req, res, next) {
  try {
    const data = await adminService.getOverview(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
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
  getOverview,
  getProfitability: list("getProfitability"),
  getScheduledPosts: list("getScheduledPosts"),
  getTransactions: list("getTransactions"),
  getUsers: list("getUsers"),
  getUserDetails,
};
