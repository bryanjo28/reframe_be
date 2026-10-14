const { isSupabaseConfigured } = require("../config/supabase");
const { assertCapacity } = require("./entitlementsService");

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

function normalizeContentPillarPayload(payload = {}) {
  const source = getSource(payload);

  return {
    personaConfigId: readOptionalText(source, ["personaConfigId", "persona_config_id"]),
    pillarName: readOptionalText(source, ["pillarName", "pillar_name", "name"]),
    templateContent: readOptionalText(source, ["templateContent", "template_content"]),
    targetObjective: readOptionalText(source, ["targetObjective", "target_objective"]),
    audienceSegment: readOptionalText(source, ["audienceSegment", "audience_segment"]),
    keyMessage: readOptionalText(source, ["keyMessage", "key_message"]),
    ctaDirection: readOptionalText(source, ["ctaDirection", "cta_direction"]),
    isActive: readOptionalBoolean(source, ["isActive", "is_active"]),
    sortOrder: readOptionalNumber(source, ["sortOrder", "sort_order"]),
  };
}

function assertCreateContentPillarPayload(payload) {
  if (!payload.personaConfigId || payload.personaConfigId.length === 0) {
    throw createHttpError("Missing required field: personaConfigId", 400);
  }

  if (!payload.pillarName || payload.pillarName.length === 0) {
    throw createHttpError("Missing required field: pillarName", 400);
  }
}

function mapPersonaConfig(row) {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContentTopic(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    personaConfigId: row.persona_config_id,
    contentPillarId: row.content_pillar_id,
    category: row.category,
    topic: row.topic,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

function mapContentOutput(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    personaConfigId: row.persona_config_id,
    contentPillarId: row.content_pillar_id,
    topicId: row.topic_id,
    platform: row.platform,
    content: row.content,
    status: row.status,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContentPillarRow(row, relations = {}) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    personaConfigId: row.persona_config_id,
    pillarName: row.pillar_name,
    templateContent: row.template_content,
    targetObjective: row.target_objective,
    audienceSegment: row.audience_segment,
    keyMessage: row.key_message,
    ctaDirection: row.cta_direction,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    personaConfig: relations.personaConfig || null,
    contentTopics: relations.contentTopics || [],
    contentOutputs: relations.contentOutputs || [],
    contentTopicCount:
      relations.contentTopicCount !== undefined
        ? relations.contentTopicCount
        : relations.contentTopics?.length || 0,
    contentOutputCount:
      relations.contentOutputCount !== undefined
        ? relations.contentOutputCount
        : relations.contentOutputs?.length || 0,
  };
}

function buildInsertPayload({ userId, input }) {
  const payload = {
    user_id: userId,
    persona_config_id: input.personaConfigId,
    pillar_name: input.pillarName,
  };

  if (input.templateContent !== undefined) {
    payload.template_content = input.templateContent;
  }

  if (input.targetObjective !== undefined) {
    payload.target_objective = input.targetObjective;
  }

  if (input.audienceSegment !== undefined) {
    payload.audience_segment = input.audienceSegment;
  }

  if (input.keyMessage !== undefined) {
    payload.key_message = input.keyMessage;
  }

  if (input.ctaDirection !== undefined) {
    payload.cta_direction = input.ctaDirection;
  }

  if (input.isActive !== undefined && input.isActive !== null) {
    payload.is_active = input.isActive;
  }

  if (input.sortOrder !== undefined && input.sortOrder !== null) {
    payload.sort_order = input.sortOrder;
  }

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {};

  if (input.personaConfigId !== undefined) {
    payload.persona_config_id = input.personaConfigId;
  }

  if (input.pillarName !== undefined) {
    payload.pillar_name = input.pillarName;
  }

  if (input.templateContent !== undefined) {
    payload.template_content = input.templateContent;
  }

  if (input.targetObjective !== undefined) {
    payload.target_objective = input.targetObjective;
  }

  if (input.audienceSegment !== undefined) {
    payload.audience_segment = input.audienceSegment;
  }

  if (input.keyMessage !== undefined) {
    payload.key_message = input.keyMessage;
  }

  if (input.ctaDirection !== undefined) {
    payload.cta_direction = input.ctaDirection;
  }

  if (input.isActive !== undefined && input.isActive !== null) {
    payload.is_active = input.isActive;
  }

  if (input.sortOrder !== undefined && input.sortOrder !== null) {
    payload.sort_order = input.sortOrder;
  }

  return payload;
}

async function assertPersonaConfigBelongsToUser({ supabase, userId, personaConfigId }) {
  const { data, error } = await supabase
    .from("persona_configs")
    .select("id, persona, target_audience, niche_topic_focus, content_style, tone, goal, platform")
    .eq("id", personaConfigId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Persona config not found", 404);
  }

  return mapPersonaConfig(data);
}

async function assertContentPillarBelongsToUserAndPersona({
  supabase,
  userId,
  contentPillarId,
  personaConfigId,
}) {
  if (!contentPillarId) {
    return null;
  }

  const { data, error } = await supabase
    .from("content_pillars")
    .select("id, user_id, persona_config_id, pillar_name, template_content, target_objective, audience_segment, key_message, cta_direction, is_active, sort_order, created_at, updated_at")
    .eq("id", contentPillarId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content pillar not found", 404);
  }

  if (personaConfigId && data.persona_config_id !== personaConfigId) {
    throw createHttpError("contentPillarId does not belong to the selected personaConfigId", 400);
  }

  return mapContentPillarRow(data);
}

async function getContentPillarRelations({ supabase, userId, contentPillarId }) {
  const { data: pillarData, error: pillarError } = await supabase
    .from("content_pillars")
    .select("id, persona_config_id")
    .eq("id", contentPillarId)
    .eq("user_id", userId)
    .maybeSingle();

  if (pillarError) {
    throw createHttpError(pillarError.message, 500, pillarError);
  }

  if (!pillarData) {
    throw createHttpError("Content pillar not found", 404);
  }

  const [personaConfigResult, topicsResult, outputsResult] = await Promise.all([
    supabase
      .from("persona_configs")
      .select("id, user_id, persona, target_audience, niche_topic_focus, content_style, tone, goal, platform, created_at, updated_at")
      .eq("id", pillarData.persona_config_id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("content_topics")
      .select("id, user_id, persona_config_id, content_pillar_id, category, topic, used_at, created_at")
      .eq("content_pillar_id", contentPillarId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("content_outputs")
      .select("id, user_id, persona_config_id, content_pillar_id, topic_id, platform, content, status, retry_count, created_at, updated_at")
      .eq("content_pillar_id", contentPillarId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const { data: personaConfigData, error: personaConfigError } = personaConfigResult;
  const { data: topicsData, error: topicsError } = topicsResult;
  const { data: outputsData, error: outputsError } = outputsResult;

  if (personaConfigError) {
    throw createHttpError(personaConfigError.message, 500, personaConfigError);
  }

  if (topicsError) {
    throw createHttpError(topicsError.message, 500, topicsError);
  }

  if (outputsError) {
    throw createHttpError(outputsError.message, 500, outputsError);
  }

  return {
    personaConfig: mapPersonaConfig(personaConfigData),
    contentTopics: (topicsData || []).map(mapContentTopic),
    contentOutputs: (outputsData || []).map(mapContentOutput),
  };
}

async function listContentPillars({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_pillars")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  const rows = data || [];

  const mappedRows = await Promise.all(
    rows.map(async (row) => {
      const { data: personaConfigData, error: personaConfigError } = await supabase
        .from("persona_configs")
        .select("id, user_id, persona, target_audience, niche_topic_focus, content_style, tone, goal, platform, created_at, updated_at")
        .eq("id", row.persona_config_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (personaConfigError) {
        throw createHttpError(personaConfigError.message, 500, personaConfigError);
      }

      const { data: topicsData, error: topicsError } = await supabase
        .from("content_topics")
        .select("id")
        .eq("content_pillar_id", row.id)
        .eq("user_id", userId);

      if (topicsError) {
        throw createHttpError(topicsError.message, 500, topicsError);
      }

      const { data: outputsData, error: outputsError } = await supabase
        .from("content_outputs")
        .select("id")
        .eq("content_pillar_id", row.id)
        .eq("user_id", userId);

      if (outputsError) {
        throw createHttpError(outputsError.message, 500, outputsError);
      }

      return mapContentPillarRow(row, {
        personaConfig: mapPersonaConfig(personaConfigData),
        contentTopicCount: topicsData?.length || 0,
        contentOutputCount: outputsData?.length || 0,
      });
    })
  );

  return mappedRows;
}

async function getContentPillarById({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_pillars")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  if (!data) {
    throw createHttpError("Content pillar not found", 404);
  }

  const relations = await getContentPillarRelations({
    supabase,
    userId,
    contentPillarId: data.id,
  });

  return mapContentPillarRow(data, relations);
}

async function createContentPillar({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeContentPillarPayload(payload);
  assertCreateContentPillarPayload(input);
  await assertPersonaConfigBelongsToUser({
    supabase,
    userId,
    personaConfigId: input.personaConfigId,
  });
  await assertCapacity({ supabase, userId, resource: "content_pillar" });

  const insertPayload = buildInsertPayload({ userId, input });
  const { data, error } = await supabase
    .from("content_pillars")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  const relations = await getContentPillarRelations({
    supabase,
    userId,
    contentPillarId: data.id,
  });

  return mapContentPillarRow(data, relations);
}

async function updateContentPillar({ supabase, userId, id, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeContentPillarPayload(payload);
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

  const { data, error } = await supabase
    .from("content_pillars")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content pillar not found", 404);
  }

  const relations = await getContentPillarRelations({
    supabase,
    userId,
    contentPillarId: data.id,
  });

  return mapContentPillarRow(data, relations);
}

async function deleteContentPillar({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_pillars")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content pillar not found", 404);
  }

  return mapContentPillarRow(data);
}

module.exports = {
  assertContentPillarBelongsToUserAndPersona,
  createContentPillar,
  deleteContentPillar,
  getContentPillarById,
  listContentPillars,
  normalizeContentPillarPayload,
  updateContentPillar,
};
