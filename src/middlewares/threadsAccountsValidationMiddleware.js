const {
  normalizeThreadsAccountPayload,
} = require("../services/threadsAccountsService");

function createHttpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateThreadsAccountRequest(req, res, next) {
  try {
    const threadsAccountInput = normalizeThreadsAccountPayload(req.body);

    if (!threadsAccountInput.accessToken) {
      throw createHttpError("Missing required field: accessToken", 400);
    }

    if (!threadsAccountInput.accountId) {
      throw createHttpError("Missing required field: accountId", 400);
    }

    if (!threadsAccountInput.threadsId) {
      throw createHttpError("Missing required field: threadsId", 400);
    }

    req.threadsAccountInput = threadsAccountInput;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateThreadsAccountRequest,
};
