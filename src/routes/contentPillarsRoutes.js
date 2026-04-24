const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const contentPillarsController = require("../controllers/contentPillarsController");
const {
  validateContentPillarIdParam,
  validateCreateContentPillarRequest,
  validateEnhanceContentPillarRequest,
  validateUpdateContentPillarRequest,
} = require("../middlewares/contentPillarsValidationMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", contentPillarsController.listContentPillars);
router.post(
  "/enhance",
  validateEnhanceContentPillarRequest,
  contentPillarsController.enhanceContentPillar
);
router.post(
  "/enhance/:id",
  validateContentPillarIdParam,
  validateEnhanceContentPillarRequest,
  contentPillarsController.enhanceContentPillar
);
router.get(
  "/:id",
  validateContentPillarIdParam,
  contentPillarsController.getContentPillarById
);
router.post(
  "/",
  validateCreateContentPillarRequest,
  contentPillarsController.createContentPillar
);
router.patch(
  "/:id",
  validateContentPillarIdParam,
  validateUpdateContentPillarRequest,
  contentPillarsController.updateContentPillar
);
router.delete(
  "/:id",
  validateContentPillarIdParam,
  contentPillarsController.deleteContentPillar
);

module.exports = router;
