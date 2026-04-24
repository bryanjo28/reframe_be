const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const threadsController = require("../controllers/threadsController");

const router = express.Router();

router.get("/connect", authMiddleware, threadsController.getConnectUrl);
router.get("/callback", threadsController.handleThreadsCallback);

router.post("/post", async (req, res) => {
  const { content } = req.body;

  await new Promise((resolve) => setTimeout(resolve, 1000));

  res.json({
    success: true,
    message: "Mock post berhasil",
    data: {
      id: "mock_thread_123",
      content,
      posted_at: new Date(),
    },
  });
});

module.exports = router;
