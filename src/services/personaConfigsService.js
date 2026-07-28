const { isSupabaseConfigured } = require("../config/supabase");
const { getActiveUserSubscription } = require("./subscriptionUsageService");

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

function normalizePersonaConfigPayload(payload = {}) {
  const source = getSource(payload);

  return {
    persona: readOptionalText(source, ["persona"]),
    targetAudience: readOptionalText(source, ["targetAudience", "target_audience"]),
    nicheTopicFocus: readOptionalText(source, ["nicheTopicFocus", "niche_topic_focus"]),
    contentStyle: readOptionalText(source, ["contentStyle", "content_style"]),
    tone: readOptionalText(source, ["tone"]),
    goal: readOptionalText(source, ["goal"]),
    platform: readOptionalText(source, ["platform"]),
    formatOutput: readOptionalText(source, ["formatOutput", "format_output"]),
    isActive: readOptionalBoolean(source, ["isActive", "is_active"]),
  };
}

function mapPersonaConfigRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    persona: row.persona,
    targetAudience: row.target_audience,
    nicheTopicFocus: row.niche_topic_focus,
    contentStyle: row.content_style,
    tone: row.tone,
    goal: row.goal,
    platform: row.platform,
    formatOutput: row.format_output,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildInsertPayload({ userId, input }) {
  const payload = { user_id: userId };

  if (input.persona !== undefined) payload.persona = input.persona;
  if (input.targetAudience !== undefined) payload.target_audience = input.targetAudience;
  if (input.nicheTopicFocus !== undefined) payload.niche_topic_focus = input.nicheTopicFocus;
  if (input.contentStyle !== undefined) payload.content_style = input.contentStyle;
  if (input.tone !== undefined) payload.tone = input.tone;
  if (input.goal !== undefined) payload.goal = input.goal;
  if (input.platform !== undefined) payload.platform = input.platform;
  if (input.formatOutput !== undefined) payload.format_output = input.formatOutput;
  if (input.isActive !== undefined && input.isActive !== null) payload.is_active = input.isActive;

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {};

  if (input.persona !== undefined) payload.persona = input.persona;
  if (input.targetAudience !== undefined) payload.target_audience = input.targetAudience;
  if (input.nicheTopicFocus !== undefined) payload.niche_topic_focus = input.nicheTopicFocus;
  if (input.contentStyle !== undefined) payload.content_style = input.contentStyle;
  if (input.tone !== undefined) payload.tone = input.tone;
  if (input.goal !== undefined) payload.goal = input.goal;
  if (input.platform !== undefined) payload.platform = input.platform;
  if (input.formatOutput !== undefined) payload.format_output = input.formatOutput;
  if (input.isActive !== undefined && input.isActive !== null) payload.is_active = input.isActive;

  return payload;
}

async function ensurePersonaConfigWithinPlanLimit({ supabase, userId }) {
  const activeSubscription = await getActiveUserSubscription({ supabase, userId });

  if (!activeSubscription) {
    throw createHttpError("No active subscription found for this user", 403);
  }

  const maxPersonas = Number(activeSubscription.plan.maxPersonas);

  if (!Number.isFinite(maxPersonas) || maxPersonas < 0) {
    throw createHttpError("Invalid persona limit on subscription plan", 500);
  }

  const { count, error } = await supabase
    .from("persona_configs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  const currentPersonaCount = count || 0;

  if (currentPersonaCount >= maxPersonas) {
    throw createHttpError(
      "Kamu sudah mencapai batas persona untuk plan kamu. Upgrade plan untuk menambah persona.",
      402,
      {
        code: "PERSONA_LIMIT_EXCEEDED",
        maxPersonas,
        currentPersonaCount,
        remainingPersonas: 0,
      }
    );
  }

  return {
    activeSubscription,
    maxPersonas,
    currentPersonaCount,
    remainingPersonas: maxPersonas - currentPersonaCount,
  };
}

async function listPersonaConfigs({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return (data || []).map(mapPersonaConfigRow);
}

async function getPersonaConfigById({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  if (!data) {
    throw createHttpError("Persona config not found", 404);
  }

  return mapPersonaConfigRow(data);
}

async function createPersonaConfig({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizePersonaConfigPayload(payload);
  await ensurePersonaConfigWithinPlanLimit({ supabase, userId });

  const insertPayload = buildInsertPayload({ userId, input });

  const { data, error } = await supabase
    .from("persona_configs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapPersonaConfigRow(data);
}

async function updatePersonaConfig({ supabase, userId, id, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizePersonaConfigPayload(payload);
  const updatePayload = buildUpdatePayload(input);

  if (Object.keys(updatePayload).length === 0) {
    throw createHttpError("No valid fields to update", 400);
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Persona config not found", 404);
  }

  return mapPersonaConfigRow(data);
}

async function deletePersonaConfig({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Persona config not found", 404);
  }

  return mapPersonaConfigRow(data);
}

module.exports = {
  createPersonaConfig,
  deletePersonaConfig,
  getPersonaConfigById,
  listPersonaConfigs,
  normalizePersonaConfigPayload,
  updatePersonaConfig,
};
