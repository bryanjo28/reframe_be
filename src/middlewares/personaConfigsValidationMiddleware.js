const {
  normalizePersonaConfigPayload,
} = require("../services/personaConfigsService");

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

function validateCreatePersonaConfigRequest(req, res, next) {
  try {
    const personaConfigInput = normalizePersonaConfigPayload(req.body);

    if (!personaConfigInput.persona) {
      throw createHttpError("Missing required field: persona", 400);
    }

    req.personaConfigInput = personaConfigInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateUpdatePersonaConfigRequest(req, res, next) {
  try {
    req.personaConfigInput = normalizePersonaConfigPayload(req.body);
    next();
  } catch (error) {
    next(error);
  }
}

function validatePersonaConfigIdParam(req, res, next) {
  try {
    if (!validateUuidParam(req.params.id)) {
      throw createHttpError("Invalid persona config id", 400);
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateCreatePersonaConfigRequest,
  validatePersonaConfigIdParam,
  validateUpdatePersonaConfigRequest,
};
