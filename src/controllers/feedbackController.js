const { submitFeedback } = require('../services/feedbackService');

async function create(req, res, next) {
  try {
    const rawMessage = req.body?.message;
    if (typeof rawMessage !== 'string') {
      return res.status(400).json({ success: false, error_code: 'FEEDBACK_MESSAGE_REQUIRED', message: 'Write your feedback before submitting.' });
    }

    const message = rawMessage.trim();
    if (message.length < 10 || message.length > 5000) {
      return res.status(400).json({ success: false, error_code: 'FEEDBACK_MESSAGE_INVALID', message: 'Feedback must be between 10 and 5,000 characters.' });
    }

    const requestedPath = typeof req.body?.pagePath === 'string' ? req.body.pagePath.trim() : '';
    const pagePath = requestedPath.startsWith('/') && requestedPath.length <= 200 ? requestedPath : null;
    const metadata = req.user.user_metadata || {};
    const name = String(metadata.full_name || metadata.name || metadata.account_name || '').trim().slice(0, 120);
    const email = String(req.user.email || '').trim().slice(0, 320);
    if (!email) {
      return res.status(400).json({ success: false, error_code: 'FEEDBACK_EMAIL_REQUIRED', message: 'Your account needs an email address to submit feedback.' });
    }
    const data = await submitFeedback({
      userId: req.user.id,
      email,
      name,
      message,
      pagePath,
    });

    return res.status(201).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create };
