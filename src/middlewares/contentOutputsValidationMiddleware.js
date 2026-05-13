const {
  normalizeAutoGenerateContentOutputsPayload,
  normalizeContentOutputPayload,
  normalizeGenerateContentOutputDemoPayload,
} = require("../services/contentOutputsService");

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

function validateCreateContentOutputRequest(req, res, next) {
  try {
    const contentOutputInput = normalizeContentOutputPayload(req.body);

    if (!contentOutputInput.personaConfigId) {
      throw createHttpError("Missing required field: personaConfigId", 400);
    }

    if (!contentOutputInput.content) {
      throw createHttpError("Missing required field: content", 400);
    }

    req.contentOutputInput = contentOutputInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateGenerateContentOutputRequest(req, res, next) {
  try {
    const contentOutputInput = normalizeContentOutputPayload(req.body);

    if (!contentOutputInput.topicId) {
      throw createHttpError("Missing required field: topicId", 400);
    }

    req.contentOutputInput = contentOutputInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateAutoGenerateContentOutputsRequest(req, res, next) {
  try {
    const contentOutputAutoGenerateInput = normalizeAutoGenerateContentOutputsPayload(req.body);

    if (!contentOutputAutoGenerateInput.contentPillarId) {
      throw createHttpError("Missing required field: contentPillarId", 400);
    }

    if (contentOutputAutoGenerateInput.targetCount === undefined || contentOutputAutoGenerateInput.targetCount === null) {
      throw createHttpError("Missing required field: targetCount", 400);
    }

    if (!Number.isInteger(contentOutputAutoGenerateInput.targetCount)) {
      throw createHttpError("targetCount must be an integer", 400);
    }

    if (contentOutputAutoGenerateInput.targetCount < 1 || contentOutputAutoGenerateInput.targetCount > 20) {
      throw createHttpError("targetCount must be between 1 and 20", 400);
    }

    if (
      contentOutputAutoGenerateInput.scheduledAt &&
      Number.isNaN(Date.parse(contentOutputAutoGenerateInput.scheduledAt))
    ) {
      throw createHttpError("scheduledAt must be a valid date-time string", 400);
    }

    req.contentOutputAutoGenerateInput = contentOutputAutoGenerateInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateGenerateContentOutputDemoRequest(req, res, next) {
  try {
    const contentOutputDemoInput = normalizeGenerateContentOutputDemoPayload(req.body);

    if (!contentOutputDemoInput.persona) {
      throw createHttpError("Missing required field: persona", 400);
    }

    if (!contentOutputDemoInput.targetAudience) {
      throw createHttpError("Missing required field: targetAudience", 400);
    }

    if (!contentOutputDemoInput.nicheTopicFocus) {
      throw createHttpError("Missing required field: nicheTopicFocus", 400);
    }

    if (!contentOutputDemoInput.contentStyle) {
      throw createHttpError("Missing required field: contentStyle", 400);
    }

    req.contentOutputDemoInput = contentOutputDemoInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateUpdateContentOutputRequest(req, res, next) {
  try {
    req.contentOutputInput = normalizeContentOutputPayload(req.body);
    next();
  } catch (error) {
    next(error);
  }
}

function validateContentOutputIdParam(req, res, next) {
  try {
    if (!validateUuidParam(req.params.id)) {
      throw createHttpError("Invalid content output id", 400);
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateContentOutputIdParam,
  validateAutoGenerateContentOutputsRequest,
  validateCreateContentOutputRequest,
  validateGenerateContentOutputDemoRequest,
  validateGenerateContentOutputRequest,
  validateUpdateContentOutputRequest,
};
