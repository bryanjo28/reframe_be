const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const usageController = require("../controllers/usageController");

const router = express.Router();

router.use(authMiddleware);

router.get("/me", usageController.getMyUsage);

module.exports = router;
