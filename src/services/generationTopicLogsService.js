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

function normalizeGenerationTopicLogPayload(payload = {}) {
  const source = getSource(payload);

  return {
    personaConfigId: readOptionalText(source, ["personaConfigId", "persona_config_id"]),
    promptTokens: readOptionalNumber(source, ["promptTokens", "prompt_tokens"]),
    completionTokens: readOptionalNumber(source, ["completionTokens", "completion_tokens"]),
    totalTokens: readOptionalNumber(source, ["totalTokens", "total_tokens"]),
    topicCount: readOptionalNumber(source, ["topicCount", "topic_count"]),
    provider: readOptionalText(source, ["provider"]),
    status: readOptionalText(source, ["status"]),
    errorMessage: readOptionalText(source, ["errorMessage", "error_message"]),
  };
}

function mapGenerationTopicLogRow(row) {
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
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    topicCount: row.topic_count,
    provider: row.provider,
  };
}

async function createGenerationTopicLog({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeGenerationTopicLogPayload(payload);

  if (!input.personaConfigId) {
    throw createHttpError("Missing required field: personaConfigId", 400);
  }

  const insertPayload = {
    user_id: userId,
    persona_config_id: input.personaConfigId,
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.totalTokens,
    topic_count: input.topicCount || 0,
    provider: input.provider || "sumopod",
    status: input.status || "success",
    error_message:
      input.errorMessage ||
      (input.status && input.status !== "success"
        ? "Generation topic failed"
        : "Topics generated successfully"),
  };

  const { data, error } = await supabase
    .from("generation_topic_logs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapGenerationTopicLogRow(data);
}

module.exports = {
  createGenerationTopicLog,
  mapGenerationTopicLogRow,
  normalizeGenerationTopicLogPayload,
};
