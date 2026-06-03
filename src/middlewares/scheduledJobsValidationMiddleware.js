const {
  normalizeScheduledJobPayload,
} = require("../services/scheduledJobsService");

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

function validateCreateScheduledJobRequest(req, res, next) {
  try {
    const scheduledJobInput = normalizeScheduledJobPayload(req.body);

    if (!scheduledJobInput.personaConfigId) {
      throw createHttpError("Missing required field: personaConfigId", 400);
    }

    if (!scheduledJobInput.scheduleType) {
      throw createHttpError("Missing required field: scheduleType", 400);
    }

    if (!scheduledJobInput.scheduleValue) {
      throw createHttpError("Missing required field: scheduleValue", 400);
    }

    if (scheduledJobInput.scheduleTimezone && scheduledJobInput.scheduleTimezone.length > 64) {
      throw createHttpError("scheduleTimezone is too long", 400);
    }

    if (scheduledJobInput.targetCount !== undefined && scheduledJobInput.targetCount !== null) {
      if (!Number.isInteger(scheduledJobInput.targetCount)) {
        throw createHttpError("targetCount must be an integer", 400);
      }

      if (scheduledJobInput.targetCount < 1 || scheduledJobInput.targetCount > 20) {
        throw createHttpError("targetCount must be between 1 and 20", 400);
      }
    }

    req.scheduledJobInput = scheduledJobInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateUpdateScheduledJobRequest(req, res, next) {
  try {
    req.scheduledJobInput = normalizeScheduledJobPayload(req.body);
    next();
  } catch (error) {
    next(error);
  }
}

function validateScheduledJobIdParam(req, res, next) {
  try {
    if (!validateUuidParam(req.params.id)) {
      throw createHttpError("Invalid scheduled job id", 400);
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateCreateScheduledJobRequest,
  validateScheduledJobIdParam,
  validateUpdateScheduledJobRequest,
};
