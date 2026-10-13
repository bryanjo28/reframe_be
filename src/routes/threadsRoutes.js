const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const threadsController = require("../controllers/threadsController");
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
router.post("/delete", threadsController.handleThreadsDeleteCallback);
router.get("/delete/status/:code", threadsController.getThreadsDeletionStatus);
router.delete("/delete", authMiddleware, threadsController.disconnectThreadsAccount);

router.post(
  "/auto-post",
  authMiddleware,
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
  validateRunScheduledThreadsJobRequest,
  threadsController.runScheduledThreadsJob
);

router.post(
  "/auto-post/retry",
  authMiddleware,
  validateRetryFailedThreadsRequest,
  threadsController.retryFailedThreadsPost
);

module.exports = router;
