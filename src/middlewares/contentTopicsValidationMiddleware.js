const {
  normalizeContentTopicPayload,
} = require("../services/contentTopicsService");

function createHttpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateUuidParam(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function validateCreateContentTopicRequest(req, res, next) {
  try {
    const contentTopicInput = normalizeContentTopicPayload(req.body);

    if (!contentTopicInput.personaConfigId) {
      throw createHttpError("Missing required field: personaConfigId", 400);
    }

    if (!contentTopicInput.topic) {
      throw createHttpError("Missing required field: topic", 400);
    }

    req.contentTopicInput = contentTopicInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateUpdateContentTopicRequest(req, res, next) {
  try {
    req.contentTopicInput = normalizeContentTopicPayload(req.body);
    next();
  } catch (error) {
    next(error);
  }
}

function validateContentTopicIdParam(req, res, next) {
  try {
    if (!validateUuidParam(req.params.id)) {
      throw createHttpError("Invalid content topic id", 400);
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateContentTopicIdParam,
  validateCreateContentTopicRequest,
  validateUpdateContentTopicRequest,
};
