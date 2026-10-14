const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const publishedPostsController = require("../controllers/publishedPostsController");

const router = express.Router();

router.use(authMiddleware);
router.get("/", publishedPostsController.listPublishedPosts);

module.exports = router;
