const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const subscriptionsController = require("../controllers/subscriptionsController");

const router = express.Router();

router.use(authMiddleware);

router.get("/me", subscriptionsController.getMySubscription);

module.exports = router;
