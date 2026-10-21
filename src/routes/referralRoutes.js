const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { referralValidationLimiter } = require('../middlewares/rateLimiters');
const referralController = require('../controllers/referralController');

const router = express.Router();

router.get('/config', referralValidationLimiter, referralController.publicConfig);
router.get('/validate/:code', referralValidationLimiter, referralController.validate);
router.get('/resolve/:code', referralValidationLimiter, referralController.resolve);
router.get('/me', authMiddleware, referralController.me);

module.exports = router;
