const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const contentTopicsController = require("../controllers/contentTopicsController");
const {
  validateContentTopicIdParam,
  validateCreateContentTopicRequest,
  validateUpdateContentTopicRequest,
} = require("../middlewares/contentTopicsValidationMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", contentTopicsController.listContentTopics);
router.get(
  "/:id",
  validateContentTopicIdParam,
  contentTopicsController.getContentTopicById
);
router.post(
  "/",
  validateCreateContentTopicRequest,
  contentTopicsController.createContentTopic
);
router.patch(
  "/:id",
  validateContentTopicIdParam,
  validateUpdateContentTopicRequest,
  contentTopicsController.updateContentTopic
);
router.delete(
  "/:id",
  validateContentTopicIdParam,
  contentTopicsController.deleteContentTopic
);

module.exports = router;
