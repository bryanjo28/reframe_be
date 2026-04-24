const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const personaConfigsController = require("../controllers/personaConfigsController");
const {
  validateCreatePersonaConfigRequest,
  validatePersonaConfigIdParam,
  validateUpdatePersonaConfigRequest,
} = require("../middlewares/personaConfigsValidationMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", personaConfigsController.listPersonaConfigs);
router.get(
  "/:id",
  validatePersonaConfigIdParam,
  personaConfigsController.getPersonaConfigById
);
router.post(
  "/",
  validateCreatePersonaConfigRequest,
  personaConfigsController.createPersonaConfig
);
router.patch(
  "/:id",
  validatePersonaConfigIdParam,
  validateUpdatePersonaConfigRequest,
  personaConfigsController.updatePersonaConfig
);
router.delete(
  "/:id",
  validatePersonaConfigIdParam,
  personaConfigsController.deletePersonaConfig
);

module.exports = router;
