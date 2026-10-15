const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/adminMiddleware");
const { adminApiLimiter } = require("../middlewares/rateLimiters");
const adminController = require("../controllers/adminController");

const router = express.Router();

router.use(authMiddleware, requireAdmin, adminApiLimiter);
router.get("/overview", adminController.getOverview);
router.get("/users", adminController.getUsers);
router.get("/profitability", adminController.getProfitability);
router.get("/users/:userId", (req, res, next) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.userId)) {
    return res.status(400).json({ success: false, error_code: "ADMIN_INVALID_USER_ID", message: "Invalid user id" });
  }
  return adminController.getUserDetails(req, res, next);
});
router.get("/transactions", adminController.getTransactions);
router.get("/ai-usage", adminController.getAiUsage);
router.get("/scheduled-posts", adminController.getScheduledPosts);
router.get("/audit-logs", adminController.getAuditLogs);
router.get("/error-logs", adminController.getErrorLogs);

module.exports = router;
