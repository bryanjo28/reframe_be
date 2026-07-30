const express = require("express");

const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  validateLoginRequest,
  validateRegisterRequest,
} = require("../middlewares/authValidationMiddleware");

const router = express.Router();

const isRegistrationEnabled = String(process.env.AUTH_ENABLE_REGISTRATION || "")
  .trim()
  .toLowerCase();

router.post("/register", (req, res, next) => {
  const enabled =
    isRegistrationEnabled === "true" ||
    isRegistrationEnabled === "1" ||
    isRegistrationEnabled === "yes";

  if (!enabled) {
    return res.status(403).json({
      success: false,
      message: "Registration is disabled",
    });
  }

  return validateRegisterRequest(req, res, () => authController.register(req, res, next));
});

router.post("/login", validateLoginRequest, authController.login);
router.get("/me", authMiddleware, authController.me);
// router.get("/me/threads", authMiddleware, authController.meThreads);
router.patch("/me", authMiddleware, authController.updateMe);
router.patch("/me/password", authMiddleware, authController.changePassword);
router.post("/logout", authMiddleware, authController.logout);
router.post("/meta/uninstall", authController.handleMetaUninstall);

module.exports = router;
