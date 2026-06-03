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
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw createHttpError("config must be valid JSON", 400, error);
    }
  }

  return null;
}

function normalizeScheduledJobPayload(payload = {}) {
  const source = getSource(payload);

  return {
    personaConfigId: readOptionalText(source, ["personaConfigId", "persona_config_id"]),
    promptTemplateId: readOptionalText(source, ["promptTemplateId", "prompt_template_id"]),
    jobType: readOptionalText(source, ["jobType", "job_type"]),
    config: readOptionalJson(source, ["config"]),
    targetCount: readOptionalNumber(source, ["targetCount", "target_count"]),
    scheduleType: readOptionalText(source, ["scheduleType", "schedule_type"]),
    scheduleValue: readOptionalText(source, ["scheduleValue", "schedule_value"]),
    scheduleTimezone: readOptionalText(source, ["scheduleTimezone", "schedule_timezone"]),
    status: readOptionalText(source, ["status"]),
    lastRunAt: readOptionalText(source, ["lastRunAt", "last_run_at"]),
    nextRunAt: readOptionalText(source, ["nextRunAt", "next_run_at"]),
    lastRunStatus: readOptionalText(source, ["lastRunStatus", "last_run_status"]),
    lastRunGeneratedCount: readOptionalNumber(
      source,
      ["lastRunGeneratedCount", "last_run_generated_count"]
    ),
    lastRunError: readOptionalText(source, ["lastRunError", "last_run_error"]),
    errorMessage: readOptionalText(source, ["errorMessage", "error_message"]),
  };
}

function assertCreateScheduledJobPayload(payload) {
  if (!payload.personaConfigId) {
    throw createHttpError("Missing required field: personaConfigId", 400);
  }

  if (!payload.scheduleType) {
    throw createHttpError("Missing required field: scheduleType", 400);
  }

  if (!payload.scheduleValue) {
    throw createHttpError("Missing required field: scheduleValue", 400);
  }

  if (payload.targetCount !== undefined && payload.targetCount !== null) {
    if (!Number.isInteger(payload.targetCount)) {
      throw createHttpError("targetCount must be an integer", 400);
    }

    if (payload.targetCount < 1 || payload.targetCount > 20) {
      throw createHttpError("targetCount must be between 1 and 20", 400);
    }
  }
}

function mapScheduledJobRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    personaConfigId: row.persona_config_id,
    promptTemplateId: row.prompt_template_id,
    jobType: row.job_type,
    config: row.config,
    targetCount: row.target_count,
    scheduleType: row.schedule_type,
    scheduleValue: row.schedule_value,
    scheduleTimezone: row.schedule_timezone,
    status: row.status,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastRunStatus: row.last_run_status,
    lastRunGeneratedCount: row.last_run_generated_count,
    lastRunError: row.last_run_error,
    createdAt: row.created_at,
    errorMessage: row.error_message,
  };
}

function buildInsertPayload({ userId, input }) {
  const payload = {
    user_id: userId,
    persona_config_id: input.personaConfigId,
    schedule_type: input.scheduleType,
    schedule_value: input.scheduleValue,
  };

  if (input.promptTemplateId !== undefined) {
    payload.prompt_template_id = input.promptTemplateId;
  }

  if (input.jobType !== undefined) {
    payload.job_type = input.jobType;
  }

  if (input.config !== undefined) {
    payload.config = input.config;
  }

  if (input.targetCount !== undefined) {
    payload.target_count = input.targetCount;
  }

  if (input.scheduleTimezone !== undefined) {
    payload.schedule_timezone = input.scheduleTimezone;
  }

  if (input.status !== undefined) {
    payload.status = input.status;
  }

  if (input.lastRunAt !== undefined) {
    payload.last_run_at = input.lastRunAt;
  }

  if (input.nextRunAt !== undefined) {
    payload.next_run_at = input.nextRunAt;
  }

  if (input.lastRunStatus !== undefined) {
    payload.last_run_status = input.lastRunStatus;
  }

  if (input.lastRunGeneratedCount !== undefined) {
    payload.last_run_generated_count = input.lastRunGeneratedCount;
  }

  if (input.lastRunError !== undefined) {
    payload.last_run_error = input.lastRunError;
  }

  if (input.errorMessage !== undefined) {
    payload.error_message = input.errorMessage;
  }

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {};

  if (input.personaConfigId !== undefined) {
    payload.persona_config_id = input.personaConfigId;
  }

  if (input.promptTemplateId !== undefined) {
    payload.prompt_template_id = input.promptTemplateId;
  }

  if (input.jobType !== undefined) {
    payload.job_type = input.jobType;
  }

  if (input.config !== undefined) {
    payload.config = input.config;
  }

  if (input.targetCount !== undefined) {
    payload.target_count = input.targetCount;
  }

  if (input.scheduleType !== undefined) {
    payload.schedule_type = input.scheduleType;
  }

  if (input.scheduleValue !== undefined) {
    payload.schedule_value = input.scheduleValue;
  }

  if (input.scheduleTimezone !== undefined) {
    payload.schedule_timezone = input.scheduleTimezone;
  }

  if (input.status !== undefined) {
    payload.status = input.status;
  }

  if (input.lastRunAt !== undefined) {
    payload.last_run_at = input.lastRunAt;
  }

  if (input.nextRunAt !== undefined) {
    payload.next_run_at = input.nextRunAt;
  }

  if (input.lastRunStatus !== undefined) {
    payload.last_run_status = input.lastRunStatus;
  }

  if (input.lastRunGeneratedCount !== undefined) {
    payload.last_run_generated_count = input.lastRunGeneratedCount;
  }

  if (input.lastRunError !== undefined) {
    payload.last_run_error = input.lastRunError;
  }

  if (input.errorMessage !== undefined) {
    payload.error_message = input.errorMessage;
  }

  return payload;
}

async function assertPersonaConfigBelongsToUser({ supabase, userId, personaConfigId }) {
  const { data, error } = await supabase
    .from("persona_configs")
    .select("id")
    .eq("id", personaConfigId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Persona config not found", 404);
  }

  return data;
}

async function assertPromptTemplateBelongsToUser({ supabase, userId, promptTemplateId }) {
  if (!promptTemplateId) {
    return null;
  }

  const { data, error } = await supabase
    .from("prompt_templates")
    .select("id, user_id, is_global")
    .eq("id", promptTemplateId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Prompt template not found", 404);
  }

  if (data.is_global) {
    return data;
  }

  if (data.user_id !== userId) {
    throw createHttpError("promptTemplateId does not belong to the current user", 400);
  }

  return data;
}

async function listScheduledJobs({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("scheduled_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return (data || []).map(mapScheduledJobRow);
}

async function getScheduledJobById({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("scheduled_jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  if (!data) {
    throw createHttpError("Scheduled job not found", 404);
  }

  return mapScheduledJobRow(data);
}

async function createScheduledJob({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeScheduledJobPayload(payload);
  assertCreateScheduledJobPayload(input);

  await assertPersonaConfigBelongsToUser({
    supabase,
    userId,
    personaConfigId: input.personaConfigId,
  });

  await assertPromptTemplateBelongsToUser({
    supabase,
    userId,
    promptTemplateId: input.promptTemplateId || null,
  });

  const insertPayload = buildInsertPayload({ userId, input });

  const { data, error } = await supabase
    .from("scheduled_jobs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapScheduledJobRow(data);
}

async function updateScheduledJob({ supabase, userId, id, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeScheduledJobPayload(payload);
  const updatePayload = buildUpdatePayload(input);

  if (Object.keys(updatePayload).length === 0) {
    throw createHttpError("No valid fields to update", 400);
  }

  if (input.personaConfigId !== undefined) {
    await assertPersonaConfigBelongsToUser({
      supabase,
      userId,
      personaConfigId: input.personaConfigId,
    });
  }

  if (input.promptTemplateId !== undefined) {
    await assertPromptTemplateBelongsToUser({
      supabase,
      userId,
      promptTemplateId: input.promptTemplateId,
    });
  }

  const { data, error } = await supabase
    .from("scheduled_jobs")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Scheduled job not found", 404);
  }

  return mapScheduledJobRow(data);
}

async function deleteScheduledJob({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("scheduled_jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Scheduled job not found", 404);
  }

  return mapScheduledJobRow(data);
}

module.exports = {
  createScheduledJob,
  deleteScheduledJob,
  getScheduledJobById,
  listScheduledJobs,
  mapScheduledJobRow,
  normalizeScheduledJobPayload,
  updateScheduledJob,
};
