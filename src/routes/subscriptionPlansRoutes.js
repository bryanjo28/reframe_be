const express = require("express");

const subscriptionPlansController = require("../controllers/subscriptionPlansController");

const router = express.Router();

router.get("/", subscriptionPlansController.listSubscriptionPlans);

module.exports = router;
