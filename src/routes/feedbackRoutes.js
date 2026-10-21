const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { feedbackSubmissionLimiter } = require('../middlewares/rateLimiters');
const feedbackController = require('../controllers/feedbackController');

const router = express.Router();

router.post('/', authMiddleware, feedbackSubmissionLimiter, feedbackController.create);

module.exports = router;
