const {
  normalizeContentTopicPayload,
} = require("../services/contentTopicsService");
const {
  normalizeGenerateContentTopicsPayload,
} = require("../services/contentTopicsGenerationService");

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

function validateGenerateContentTopicsRequest(req, res, next) {
  try {
    const contentTopicGenerateInput = normalizeGenerateContentTopicsPayload(req.body);

    if (!contentTopicGenerateInput.contentPillarId) {
      throw createHttpError("Missing required field: contentPillarId", 400);
    }

    if (!contentTopicGenerateInput.templateText) {
      throw createHttpError("Missing required field: templateText", 400);
    }

    if (
      contentTopicGenerateInput.jumlahTopics === undefined ||
      contentTopicGenerateInput.jumlahTopics === null
    ) {
      throw createHttpError("Missing required field: jumlahTopics", 400);
    }

    if (!Number.isInteger(contentTopicGenerateInput.jumlahTopics)) {
      throw createHttpError("jumlahTopics must be an integer", 400);
    }

    if (
      contentTopicGenerateInput.jumlahTopics < 1 ||
      contentTopicGenerateInput.jumlahTopics > 10
    ) {
      throw createHttpError("jumlahTopics must be between 1 and 10", 400);
    }

    req.contentTopicGenerateInput = contentTopicGenerateInput;
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
  validateGenerateContentTopicsRequest,
  validateUpdateContentTopicRequest,
};
