const { normalizePromptTemplatePayload } = require("../services/promptTemplatesService");

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

function validateCreatePromptTemplateRequest(req, res, next) {
  try {
    const promptTemplateInput = normalizePromptTemplatePayload(req.body);

    if (!promptTemplateInput.name) {
      throw createHttpError("Missing required field: name", 400);
    }

    if (!promptTemplateInput.template) {
      throw createHttpError("Missing required field: template", 400);
    }

    req.promptTemplateInput = promptTemplateInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateUpdatePromptTemplateRequest(req, res, next) {
  try {
    req.promptTemplateInput = normalizePromptTemplatePayload(req.body);
    next();
  } catch (error) {
    next(error);
  }
}

function validatePromptTemplateIdParam(req, res, next) {
  try {
    if (!validateUuidParam(req.params.id)) {
      throw createHttpError("Invalid prompt template id", 400);
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateCreatePromptTemplateRequest,
  validatePromptTemplateIdParam,
  validateUpdatePromptTemplateRequest,
};
