const {
  normalizeContentPillarPayload,
} = require("../services/contentPillarsService");

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

function validateCreateContentPillarRequest(req, res, next) {
  try {
    const contentPillarInput = normalizeContentPillarPayload(req.body);

    if (!contentPillarInput.personaConfigId) {
      throw createHttpError("Missing required field: personaConfigId", 400);
    }

    if (!contentPillarInput.pillarName) {
      throw createHttpError("Missing required field: pillarName", 400);
    }

    req.contentPillarInput = contentPillarInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateEnhanceContentPillarRequest(req, res, next) {
  try {
    const contentPillarInput = normalizeContentPillarPayload(req.body);

    if (!contentPillarInput.personaConfigId) {
      throw createHttpError("Missing required field: personaConfigId", 400);
    }

    if (!contentPillarInput.pillarName) {
      throw createHttpError("Missing required field: name", 400);
    }

    req.contentPillarInput = contentPillarInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateUpdateContentPillarRequest(req, res, next) {
  try {
    const contentPillarInput = normalizeContentPillarPayload(req.body);

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "name") && !contentPillarInput.pillarName) {
      throw createHttpError("Missing required field: name", 400);
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, "pillarName") &&
      !contentPillarInput.pillarName
    ) {
      throw createHttpError("Missing required field: pillarName", 400);
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, "personaConfigId") &&
      !contentPillarInput.personaConfigId
    ) {
      throw createHttpError("Missing required field: personaConfigId", 400);
    }

    req.contentPillarInput = contentPillarInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateContentPillarIdParam(req, res, next) {
  try {
    if (!validateUuidParam(req.params.id)) {
      throw createHttpError("Invalid content pillar id", 400);
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateContentPillarIdParam,
  validateCreateContentPillarRequest,
  validateEnhanceContentPillarRequest,
  validateUpdateContentPillarRequest,
};
