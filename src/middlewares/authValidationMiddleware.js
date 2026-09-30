const {
  assertRequiredAuthFields,
  normalizeAuthPayload,
} = require("../services/authService");

function validateRegistrationEnabled(req, res, next) {
  const value = String(process.env.AUTH_ENABLE_REGISTRATION || "")
    .trim()
    .toLowerCase();
  const enabled = value === "true" || value === "1" || value === "yes";

  if (!enabled) {
    return res.status(403).json({
      success: false,
      error_code: "REGISTRATION_DISABLED",
      message: "Registration is disabled",
    });
  }

  return next();
}

function validateRegisterRequest(req, res, next) {
  try {
    const authInput = normalizeAuthPayload(req.body);
    assertRequiredAuthFields(authInput, ["email", "password", "accountName"]);

    req.authInput = authInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateLoginRequest(req, res, next) {
  try {
    const authInput = normalizeAuthPayload(req.body);
    assertRequiredAuthFields(authInput, ["email", "password"]);

    req.authInput = authInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateResendVerificationRequest(req, res, next) {
  try {
    const authInput = normalizeAuthPayload(req.body);
    assertRequiredAuthFields(authInput, ["email"]);

    req.authInput = authInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateForgotPasswordRequest(req, res, next) {
  try {
    const authInput = normalizeAuthPayload(req.body);
    assertRequiredAuthFields(authInput, ["email"]);

    req.authInput = authInput;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateForgotPasswordRequest,
  validateLoginRequest,
  validateRegisterRequest,
  validateRegistrationEnabled,
  validateResendVerificationRequest,
};
