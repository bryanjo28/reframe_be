function createHttpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getSource(payload) {
  return payload && typeof payload === "object" ? payload : {};
}

function hasKey(source, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function readOptionalText(source, keys) {
  if (!hasKey(source, keys)) {
    return undefined;
  }

  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
  const value = source[matchedKey];

  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function readOptionalNumber(source, keys) {
  if (!hasKey(source, keys)) {
    return undefined;
  }

  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
  const value = source[matchedKey];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function validateUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function normalizeAutoPostThreadsPayload(payload = {}) {
  const source = getSource(payload);

  return {
    personaConfigId: readOptionalText(source, ["personaConfigId", "persona_config_id"]),
    contentOutputId: readOptionalText(source, ["contentOutputId", "content_output_id"]),
    limit: readOptionalNumber(source, ["limit"]),
    scheduledAt: readOptionalText(source, ["scheduledAt", "scheduled_at"]),
  };
}

function validateAutoPostThreadsRequest(req, res, next) {
  try {
    const threadsAutoPostInput = normalizeAutoPostThreadsPayload(req.body);

    if (threadsAutoPostInput.personaConfigId && !validateUuid(threadsAutoPostInput.personaConfigId)) {
      throw createHttpError("personaConfigId must be a valid UUID", 400);
    }

    if (threadsAutoPostInput.contentOutputId && !validateUuid(threadsAutoPostInput.contentOutputId)) {
      throw createHttpError("contentOutputId must be a valid UUID", 400);
    }

    if (!threadsAutoPostInput.scheduledAt) {
      throw createHttpError("Missing required field: scheduledAt", 400);
    }

    if (Number.isNaN(Date.parse(threadsAutoPostInput.scheduledAt))) {
      throw createHttpError("scheduledAt must be a valid date-time string", 400);
    }

    if (threadsAutoPostInput.limit !== undefined && threadsAutoPostInput.limit !== null) {
      if (!Number.isInteger(threadsAutoPostInput.limit)) {
        throw createHttpError("limit must be an integer", 400);
      }

      if (threadsAutoPostInput.limit < 1 || threadsAutoPostInput.limit > 20) {
        throw createHttpError("limit must be between 1 and 20", 400);
      }
    }

    req.threadsAutoPostInput = threadsAutoPostInput;
    next();
  } catch (error) {
    next(error);
  }
}

function validateRunScheduledThreadsJobRequest(req, res, next) {
  try {
    const source = getSource(req.body);
    const limit = readOptionalNumber(source, ["limit"]);

    if (limit !== undefined && limit !== null) {
      if (!Number.isInteger(limit)) {
        throw createHttpError("limit must be an integer", 400);
      }

      if (limit < 1 || limit > 20) {
        throw createHttpError("limit must be between 1 and 20", 400);
      }
    }

    req.threadsRunScheduledJobInput = {
      limit,
    };

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  normalizeAutoPostThreadsPayload,
  validateAutoPostThreadsRequest,
  validateRunScheduledThreadsJobRequest,
};
