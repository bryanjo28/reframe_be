const express = require("express");

const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  validateLoginRequest,
  validateForgotPasswordRequest,
  validateRegisterRequest,
  validateRegistrationEnabled,
  validateResendVerificationRequest,
} = require("../middlewares/authValidationMiddleware");

const router = express.Router();

router.post(
  "/register",
  validateRegistrationEnabled,
  validateRegisterRequest,
  authController.register
);

router.post("/login", validateLoginRequest, authController.login);
router.post(
  "/resend-verification",
  validateResendVerificationRequest,
  authController.resendVerificationEmail
);
router.post(
  "/forgot-password",
  validateForgotPasswordRequest,
  authController.forgotPassword
);
router.post("/reset-password", authMiddleware, authController.resetPassword);
router.get("/me", authMiddleware, authController.me);
// router.get("/me/threads", authMiddleware, authController.meThreads);
router.patch("/me", authMiddleware, authController.updateMe);
router.patch("/me/password", authMiddleware, authController.changePassword);
router.post("/logout", authMiddleware, authController.logout);
router.post("/meta/uninstall", authController.handleMetaUninstall);

module.exports = router;
