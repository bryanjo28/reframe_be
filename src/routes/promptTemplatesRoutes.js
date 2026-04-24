const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const promptTemplatesController = require("../controllers/promptTemplatesController");
const {
  validateCreatePromptTemplateRequest,
  validatePromptTemplateIdParam,
  validateUpdatePromptTemplateRequest,
} = require("../middlewares/promptTemplatesValidationMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", promptTemplatesController.listPromptTemplates);
router.get(
  "/:id",
  validatePromptTemplateIdParam,
  promptTemplatesController.getPromptTemplateById
);
router.post(
  "/",
  validateCreatePromptTemplateRequest,
  promptTemplatesController.createPromptTemplate
);
router.patch(
  "/:id",
  validatePromptTemplateIdParam,
  validateUpdatePromptTemplateRequest,
  promptTemplatesController.updatePromptTemplate
);
router.delete(
  "/:id",
  validatePromptTemplateIdParam,
  promptTemplatesController.deletePromptTemplate
);

module.exports = router;
