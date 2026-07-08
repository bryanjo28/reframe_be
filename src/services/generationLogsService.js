const { isSupabaseConfigured } = require("../config/supabase");

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

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

function readOptionalBoolean(source, keys) {
  if (!hasKey(source, keys)) {
    return undefined;
  }

  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
  const value = source[matchedKey];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return Boolean(value);
}

function readOptionalJson(source, keys) {
  if (!hasKey(source, keys)) {
    return undefined;
  }

  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
  const value = source[matchedKey];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (text.length === 0) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return null;
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

function normalizeGenerationLogPayload(payload = {}) {
  const source = getSource(payload);

  return {
    personaConfigId: readOptionalText(source, ["personaConfigId", "persona_config_id"]),
    promptTokens: readOptionalNumber(source, ["promptTokens", "prompt_tokens"]),
    completionTokens: readOptionalNumber(source, ["completionTokens", "completion_tokens"]),
    totalTokens: readOptionalNumber(source, ["totalTokens", "total_tokens"]),
    topicId: readOptionalText(source, ["topicId", "topic_id"]),
    scheduledJobRunId: readOptionalText(
      source,
      ["scheduledJobRunId", "scheduled_job_run_id"]
    ),
    inputPayload: readOptionalJson(source, ["inputPayload", "input_payload"]),
    outputPayload: readOptionalJson(source, ["outputPayload", "output_payload"]),
    status: readOptionalText(source, ["status"]),
    errorMessage: readOptionalText(source, ["errorMessage", "error_message"]),
  };
}

function mapGenerationLogRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    personaConfigId: row.persona_config_id,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    topicId: row.topic_id,
    scheduledJobRunId: row.scheduled_job_run_id,
    inputPayload: row.input_payload,
    outputPayload: row.output_payload,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

async function createGenerationLog({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeGenerationLogPayload(payload);
  const insertPayload = {
    user_id: userId,
    persona_config_id: input.personaConfigId || null,
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.totalTokens,
    topic_id: input.topicId || null,
    scheduled_job_run_id: input.scheduledJobRunId || null,
    input_payload: input.inputPayload || null,
    output_payload: input.outputPayload || null,
    status: input.status || "success",
    error_message: input.errorMessage || null,
  };

  const { data, error } = await supabase
    .from("generation_logs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapGenerationLogRow(data);
}

module.exports = {
  createGenerationLog,
  mapGenerationLogRow,
  normalizeGenerationLogPayload,
};
