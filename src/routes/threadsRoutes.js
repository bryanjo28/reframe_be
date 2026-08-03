const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const threadsController = require("../controllers/threadsController");
const threadsAuthService = require("../services/threadsAuthService");
const {
  publishTextThread,
} = require("../services/threadsPublishService");
const {
  validateAutoPostThreadsRequest,
  validateRunScheduledThreadsJobRequest,
} = require("../middlewares/threadsPublishValidationMiddleware");

const router = express.Router();

router.get("/connect", authMiddleware, threadsController.getConnectUrl);
router.post("/connect", authMiddleware, threadsController.getConnectUrl);
router.get("/callback", threadsController.handleThreadsCallback);
router.post("/delete", authMiddleware, threadsController.handleThreadsDeleteCallback);
router.delete("/delete", authMiddleware, threadsController.handleThreadsDeleteCallback);

router.post(
  "/auto-post",
  authMiddleware,
  validateAutoPostThreadsRequest,
  threadsController.autoPostThreadsDrafts
);

router.post(
  "/auto-post/run",
  authMiddleware,
  validateRunScheduledThreadsJobRequest,
  threadsController.runScheduledThreadsJob
);

router.post("/post", async (req, res) => {
  const accessToken =
    req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : req.body.access_token || req.query.access_token;

  const content = req.body.text || req.body.content;
  const replyControl = req.body.reply_control || "everyone";

  if (!accessToken) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return res.json({
      success: true,
      message: "Mock post berhasil",
      data: {
        id: "mock_thread_123",
        content,
        posted_at: new Date(),
      },
    });
  }

  if (!content || !String(content).trim()) {
    return res.status(400).json({
      success: false,
      error: "Missing content/text.",
    });
  }

  try {
    const userIdFromBody = req.body.user_id || req.body.userId;
    const user = userIdFromBody
      ? { id: userIdFromBody }
      : await threadsAuthService.getThreadsUser(accessToken);

    const publishResult = await publishTextThread({
      accessToken,
      threadsId: user.id,
      content,
      replyControl,
    });

    return res.json({
      success: true,
      message: "Threads post published successfully",
      user_id: user.id,
      creation: publishResult.rawCreationResponse,
      publish: publishResult.rawPublishResponse,
      creation_id: publishResult.creationId,
      platform_post_id: publishResult.platformPostId,
    });
  } catch (err) {
    console.error("THREADS POST ERROR:");
    console.error(err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

module.exports = router;
