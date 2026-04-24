const { isSupabaseConfigured } = require("../config/supabase");
const {
  assertContentPillarBelongsToUserAndPersona,
} = require("./contentPillarsService");

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

function normalizeContentTopicPayload(payload = {}) {
  const source = getSource(payload);

  return {
    personaConfigId: readOptionalText(source, ["personaConfigId", "persona_config_id"]),
    contentPillarId: readOptionalText(source, ["contentPillarId", "content_pillar_id"]),
    category: readOptionalText(source, ["category"]),
    subcategory: readOptionalText(source, ["subcategory"]),
    topic: readOptionalText(source, ["topic"]),
    usedAt: readOptionalText(source, ["usedAt", "used_at"]),
  };
}

function assertCreateContentTopicPayload(payload) {
  if (!payload.personaConfigId || payload.personaConfigId.length === 0) {
    throw createHttpError("Missing required field: personaConfigId", 400);
  }

  if (!payload.topic || payload.topic.length === 0) {
    throw createHttpError("Missing required field: topic", 400);
  }
}

function mapContentTopicRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    personaConfigId: row.persona_config_id,
    contentPillarId: row.content_pillar_id,
    category: row.category,
    subcategory: row.subcategory,
    topic: row.topic,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

function buildInsertPayload({ userId, input }) {
  const payload = {
    user_id: userId,
    persona_config_id: input.personaConfigId,
  };

  if (input.contentPillarId !== undefined) {
    payload.content_pillar_id = input.contentPillarId;
  }

  if (input.category !== undefined) {
    payload.category = input.category;
  }

  if (input.subcategory !== undefined) {
    payload.subcategory = input.subcategory;
  }

  if (input.topic !== undefined) {
    payload.topic = input.topic;
  }

  if (input.usedAt !== undefined) {
    payload.used_at = input.usedAt;
  }

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {};

  if (input.personaConfigId !== undefined) {
    payload.persona_config_id = input.personaConfigId;
  }

  if (input.contentPillarId !== undefined) {
    payload.content_pillar_id = input.contentPillarId;
  }

  if (input.category !== undefined) {
    payload.category = input.category;
  }

  if (input.subcategory !== undefined) {
    payload.subcategory = input.subcategory;
  }

  if (input.topic !== undefined) {
    payload.topic = input.topic;
  }

  if (input.usedAt !== undefined) {
    payload.used_at = input.usedAt;
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
}

async function listContentTopics({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_topics")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return (data || []).map(mapContentTopicRow);
}

async function getContentTopicById({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_topics")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  if (!data) {
    throw createHttpError("Content topic not found", 404);
  }

  return mapContentTopicRow(data);
}

async function createContentTopic({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeContentTopicPayload(payload);
  assertCreateContentTopicPayload(input);

  await assertPersonaConfigBelongsToUser({
    supabase,
    userId,
    personaConfigId: input.personaConfigId,
  });

  if (input.contentPillarId !== undefined) {
    await assertContentPillarBelongsToUserAndPersona({
      supabase,
      userId,
      contentPillarId: input.contentPillarId,
      personaConfigId: input.personaConfigId,
    });
  }

  const insertPayload = buildInsertPayload({ userId, input });
  const { data, error } = await supabase
    .from("content_topics")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapContentTopicRow(data);
}

async function updateContentTopic({ supabase, userId, id, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeContentTopicPayload(payload);
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

  if (input.contentPillarId !== undefined) {
    await assertContentPillarBelongsToUserAndPersona({
      supabase,
      userId,
      contentPillarId: input.contentPillarId,
      personaConfigId: input.personaConfigId,
    });
  }

  const { data, error } = await supabase
    .from("content_topics")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content topic not found", 404);
  }

  return mapContentTopicRow(data);
}

async function deleteContentTopic({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_topics")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content topic not found", 404);
  }

  return mapContentTopicRow(data);
}

module.exports = {
  createContentTopic,
  deleteContentTopic,
  getContentTopicById,
  listContentTopics,
  normalizeContentTopicPayload,
  updateContentTopic,
};
