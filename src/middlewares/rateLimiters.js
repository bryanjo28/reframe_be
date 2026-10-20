const { ipKeyGenerator, rateLimit } = require("express-rate-limit");

const LIMITS = Object.freeze({
  global: { windowMs: 15 * 60 * 1000, limit: 300 },
  login: { windowMs: 15 * 60 * 1000, limit: 10 },
  register: { windowMs: 60 * 60 * 1000, limit: 5 },
  forgotPassword: { windowMs: 60 * 60 * 1000, limit: 5 },
  resendVerification: { windowMs: 60 * 60 * 1000, limit: 5 },
  aiGeneration: { windowMs: 15 * 60 * 1000, limit: 20 },
  threadsPublish: { windowMs: 15 * 60 * 1000, limit: 20 },
  metaDeletion: { windowMs: 60 * 60 * 1000, limit: 20 },
  adminApi: { windowMs: 60 * 1000, limit: 60 },
  paymentTrigger: { windowMs: 60 * 1000, limit: 5 },
});

function handler(req, res) {
  return res.status(429).json({
    success: false,
    error_code: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests. Please try again later.",
  });
}

function createLimiter(config, options = {}) {
  return rateLimit({
    ...config,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler,
    ...options,
  });
}

function authenticatedUserKey(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  return `ip:${ipKeyGenerator(req.ip)}`;
}

const globalApiLimiter = createLimiter(LIMITS.global);
const loginLimiter = createLimiter(LIMITS.login);
const registerLimiter = createLimiter(LIMITS.register);
const forgotPasswordLimiter = createLimiter(LIMITS.forgotPassword);
const resendVerificationLimiter = createLimiter(LIMITS.resendVerification);
const aiGenerationLimiter = createLimiter(LIMITS.aiGeneration, { keyGenerator: authenticatedUserKey });
const threadsPublishLimiter = createLimiter(LIMITS.threadsPublish, { keyGenerator: authenticatedUserKey });
const metaDeletionLimiter = createLimiter(LIMITS.metaDeletion);
const adminApiLimiter = createLimiter(LIMITS.adminApi, { keyGenerator: authenticatedUserKey });
// Shared by order creation and checkout retry; counters are per Node process.
const paymentTriggerLimiter = createLimiter(LIMITS.paymentTrigger, { keyGenerator: authenticatedUserKey });

module.exports = {
  LIMITS,
  aiGenerationLimiter,
  adminApiLimiter,
  forgotPasswordLimiter,
  globalApiLimiter,
  loginLimiter,
  metaDeletionLimiter,
  paymentTriggerLimiter,
  registerLimiter,
  resendVerificationLimiter,
  threadsPublishLimiter,
};
