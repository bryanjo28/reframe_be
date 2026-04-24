const express = require("express");

const sumopodController = require("../controllers/sumopodController");

const router = express.Router();

router.get("/health", sumopodController.health);
router.post("/test", sumopodController.testChat);

module.exports = router;
