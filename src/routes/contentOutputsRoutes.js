const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const contentOutputsController = require("../controllers/contentOutputsController");
const {
  validateAutoGenerateContentOutputsRequest,
  validateContentOutputIdParam,
  validateCreateContentOutputRequest,
  validateGenerateContentOutputDemoRequest,
  validateGenerateContentOutputRequest,
  validateUpdateContentOutputRequest,
} = require("../middlewares/contentOutputsValidationMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", contentOutputsController.listContentOutputs);
router.get(
  "/:id",
  validateContentOutputIdParam,
  contentOutputsController.getContentOutputById
);
router.post(
  "/",
  validateCreateContentOutputRequest,
  contentOutputsController.createContentOutput
);
router.post(
  "/generate",
  validateGenerateContentOutputRequest,
  contentOutputsController.generateContentOutput
);
router.post(
  "/auto-generate",
  validateAutoGenerateContentOutputsRequest,
  contentOutputsController.autoGenerateContentOutputs
);
router.post(
  "/generate-demo",
  validateGenerateContentOutputDemoRequest,
  contentOutputsController.generateContentOutputDemo
);
router.patch(
  "/:id",
  validateContentOutputIdParam,
  validateUpdateContentOutputRequest,
  contentOutputsController.updateContentOutput
);
router.delete(
  "/:id",
  validateContentOutputIdParam,
  contentOutputsController.deleteContentOutput
);

module.exports = router;
