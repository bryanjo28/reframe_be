const express = require("express");

const sumopodController = require("../controllers/sumopodController");

const router = express.Router();

router.get("/health", sumopodController.health);
module.exports = router;
