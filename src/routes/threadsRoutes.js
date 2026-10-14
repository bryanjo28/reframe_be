const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const threadsController = require("../controllers/threadsController");
const {
  metaDeletionLimiter,
  threadsPublishLimiter,
} = require("../middlewares/rateLimiters");
const {
  validateAutoPostThreadsRequest,
  validateRetryFailedThreadsRequest,
  validateRescheduleContentRequest,
  validateRunScheduledThreadsJobRequest,
  validateScheduledContentParam,
} = require("../middlewares/threadsPublishValidationMiddleware");

const router = express.Router();

router.get("/connect", authMiddleware, threadsController.getConnectUrl);
router.post("/connect", authMiddleware, threadsController.getConnectUrl);
router.get("/callback", threadsController.handleThreadsCallback);
router.post("/delete", metaDeletionLimiter, threadsController.handleThreadsDeleteCallback);
router.get("/delete/status/:code", threadsController.getThreadsDeletionStatus);
router.delete("/delete", authMiddleware, threadsController.disconnectThreadsAccount);

router.post(
  "/auto-post",
  authMiddleware,
  threadsPublishLimiter,
  validateAutoPostThreadsRequest,
  threadsController.autoPostThreadsDrafts
);

router.patch(
  "/auto-post/:contentOutputId",
  authMiddleware,
  validateScheduledContentParam,
  validateRescheduleContentRequest,
  threadsController.rescheduleContent
);

router.delete(
  "/auto-post/:contentOutputId",
  authMiddleware,
  validateScheduledContentParam,
  threadsController.cancelContentSchedule
);

router.post(
  "/auto-post/run",
  authMiddleware,
  threadsPublishLimiter,
  validateRunScheduledThreadsJobRequest,
  threadsController.runScheduledThreadsJob
);

router.post(
  "/auto-post/retry",
  authMiddleware,
  threadsPublishLimiter,
  validateRetryFailedThreadsRequest,
  threadsController.retryFailedThreadsPost
);

module.exports = router;
