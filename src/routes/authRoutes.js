const express = require("express");

const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  validateLoginRequest,
  validateRegisterRequest,
} = require("../middlewares/authValidationMiddleware");

const router = express.Router();

router.post("/register", validateRegisterRequest, authController.register);
router.post("/login", validateLoginRequest, authController.login);
router.get("/me", authMiddleware, authController.me);
// router.get("/me/threads", authMiddleware, authController.meThreads);
router.patch("/me", authMiddleware, authController.updateMe);
router.patch("/me/password", authMiddleware, authController.changePassword);
router.post("/logout", authMiddleware, authController.logout);

module.exports = router;
