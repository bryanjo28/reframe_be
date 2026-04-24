const {
  assertRequiredAuthFields,
  normalizeAuthPayload,
} = require("../services/authService");

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

module.exports = {
  validateLoginRequest,
  validateRegisterRequest,
};
