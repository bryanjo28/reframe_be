const { isSupabaseConfigured } = require("../config/supabase");
const promptTemplatesService = require("./promptTemplatesService");
const { createGenerationLog } = require("./generationLogsService");
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

function normalizeContentOutputPayload(payload = {}) {
  const source = getSource(payload);

  return {
    personaConfigId: readOptionalText(source, ["personaConfigId", "persona_config_id"]),
    contentPillarId: readOptionalText(source, ["contentPillarId", "content_pillar_id"]),
    topicId: readOptionalText(source, ["topicId", "topic_id"]),
    promptTemplateId: readOptionalText(source, ["promptTemplateId", "prompt_template_id"]),
    platform: readOptionalText(source, ["platform"]),
    formatOutput: readOptionalText(source, ["formatOutput", "format_output"]),
    content: readOptionalText(source, ["content"]),
    status: readOptionalText(source, ["status"]),
    retryCount: readOptionalNumber(source, ["retryCount", "retry_count"]),
    additionalPrompt: readOptionalText(source, ["additionalPrompt", "additional_prompt"]),
    improvementHint: readOptionalText(source, ["improvementHint", "improvement_hint"]),
    regenerate: readOptionalBoolean(source, ["regenerate"]),
    sourceContentOutputId: readOptionalText(
      source,
      ["sourceContentOutputId", "source_content_output_id"]
    ),
  };
}

function assertCreateContentOutputPayload(payload) {
  if (!payload.personaConfigId || payload.personaConfigId.length === 0) {
    throw createHttpError("Missing required field: personaConfigId", 400);
  }

  if (!payload.content || payload.content.length === 0) {
    throw createHttpError("Missing required field: content", 400);
  }
}

function mapContentOutputRow(row) {
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
    formatOutput: row.format_output,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    retryCount: row.retry_count,
  };
}

function buildInsertPayload({ userId, input }) {
  const payload = {
    user_id: userId,
    persona_config_id: input.personaConfigId,
    content: input.content,
  };

  if (input.contentPillarId !== undefined) {
    payload.content_pillar_id = input.contentPillarId;
  }

  if (input.topicId !== undefined) {
    payload.topic_id = input.topicId;
  }

  if (input.platform !== undefined) {
    payload.platform = input.platform;
  }

  if (input.formatOutput !== undefined) {
    payload.format_output = input.formatOutput;
  }

  if (input.status !== undefined) {
    payload.status = input.status;
  }

  if (input.retryCount !== undefined) {
    payload.retry_count = input.retryCount;
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

  if (input.topicId !== undefined) {
    payload.topic_id = input.topicId;
  }

  if (input.platform !== undefined) {
    payload.platform = input.platform;
  }

  if (input.formatOutput !== undefined) {
    payload.format_output = input.formatOutput;
  }

  if (input.content !== undefined) {
    payload.content = input.content;
  }

  if (input.status !== undefined) {
    payload.status = input.status;
  }

  if (input.retryCount !== undefined) {
    payload.retry_count = input.retryCount;
  }

  return payload;
}

function interpolateTemplate(templateText, variables = {}, context = {}) {
  if (!templateText) {
    return "";
  }

  return String(templateText).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const value = variables[key];
      return value === undefined || value === null ? "" : String(value);
    }

    if (Object.prototype.hasOwnProperty.call(context, key)) {
      const value = context[key];
      return value === undefined || value === null ? "" : String(value);
    }

    return "";
  });
}

function buildDefaultDraft({
  persona,
  topic,
  contentPillar,
  platform,
  formatOutput,
  additionalPrompt,
  improvementHint,
}) {
  const personaName = persona?.persona || "persona yang sudah disetel";
  const topicText = topic?.topic || "topik umum";
  const pillarName = contentPillar?.pillarName || "content pillar umum";
  const pillarObjective = contentPillar?.targetObjective || "tujuan konten belum diset";
  const tone = persona?.tone || "natural";
  const targetAudience = persona?.targetAudience || "audiens target";
  const addOn = additionalPrompt ? ` Instruksi tambahan: ${additionalPrompt}.` : "";
  const hint = improvementHint ? ` Fokus perbaikan: ${improvementHint}.` : "";

  return [
    `Buat konten ${platform || "threads"} dalam format ${formatOutput || "single post"}.`,
    `Persona: ${personaName}.`,
    `Content pillar: ${pillarName}.`,
    `Objective: ${pillarObjective}.`,
    `Target audience: ${targetAudience}.`,
    `Topik: ${topicText}.`,
    `Tone: ${tone}.${addOn}${hint}`,
    "Draft awal ini bisa diedit lagi sebelum publish.",
  ].join(" ");
}

async function assertPersonaConfigBelongsToUser({ supabase, userId, personaConfigId }) {
  const { data, error } = await supabase
    .from("persona_configs")
    .select("id, persona, target_audience, niche_topic_focus, content_style, tone, goal, platform, format_output")
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

async function assertTopicBelongsToUserAndPersona({
  supabase,
  userId,
  topicId,
  personaConfigId,
}) {
  if (!topicId) {
    return null;
  }

  const { data, error } = await supabase
    .from("content_topics")
    .select("id, persona_config_id, content_pillar_id, category, subcategory, topic, used_at")
    .eq("id", topicId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content topic not found", 404);
  }

  if (personaConfigId && data.persona_config_id !== personaConfigId) {
    throw createHttpError("topicId does not belong to the selected personaConfigId", 400);
  }

  return data;
}

async function resolveContentPillarForOutput({
  supabase,
  userId,
  personaConfigId,
  topic,
  contentPillarId,
}) {
  const resolvedContentPillarId = contentPillarId || topic?.content_pillar_id || null;

  if (!resolvedContentPillarId) {
    return null;
  }

  const contentPillar = await assertContentPillarBelongsToUserAndPersona({
    supabase,
    userId,
    contentPillarId: resolvedContentPillarId,
    personaConfigId,
  });

  if (topic?.content_pillar_id && topic.content_pillar_id !== resolvedContentPillarId) {
    throw createHttpError("contentPillarId does not match the selected topic", 400);
  }

  return contentPillar;
}

async function getSourceContentOutput({ supabase, userId, sourceContentOutputId }) {
  if (!sourceContentOutputId) {
    return null;
  }

  const { data, error } = await supabase
    .from("content_outputs")
    .select("*")
    .eq("id", sourceContentOutputId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Source content output not found", 404);
  }

  return data;
}

function buildPromptContext({ persona, topic, contentPillar, sourceContentOutput, input }) {
  return {
    persona: persona?.persona || "",
    targetAudience: persona?.target_audience || "",
    nicheTopicFocus: persona?.niche_topic_focus || "",
    contentStyle: persona?.content_style || "",
    tone: persona?.tone || "",
    goal: persona?.goal || "",
    pillarName: contentPillar?.pillarName || "",
    pillarObjective: contentPillar?.targetObjective || "",
    pillarAudienceSegment: contentPillar?.audienceSegment || "",
    pillarKeyMessage: contentPillar?.keyMessage || "",
    pillarCtaDirection: contentPillar?.ctaDirection || "",
    pillarAffiliateLink: contentPillar?.affiliateLink || "",
    category: topic?.category || "",
    subcategory: topic?.subcategory || "",
    topic: topic?.topic || "",
    platform: input.platform || persona?.platform || "threads",
    formatOutput: input.formatOutput || persona?.format_output || "single post",
    additionalPrompt: input.additionalPrompt || "",
    improvementHint: input.improvementHint || "",
    previousContent: sourceContentOutput?.content || "",
  };
}

function resolvePromptTemplate(promptTemplate, context) {
  if (!promptTemplate) {
    return null;
  }

  const variables =
    promptTemplate.variables && typeof promptTemplate.variables === "object"
      ? promptTemplate.variables
      : {};

  const resolvedTemplate = interpolateTemplate(promptTemplate.template, variables, context);

  return {
    id: promptTemplate.id,
    name: promptTemplate.name,
    template: promptTemplate.template,
    resolvedTemplate,
    variables: promptTemplate.variables || null,
    isGlobal: promptTemplate.isGlobal,
  };
}

async function listContentOutputs({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_outputs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return (data || []).map(mapContentOutputRow);
}

async function getContentOutputById({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_outputs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  if (!data) {
    throw createHttpError("Content output not found", 404);
  }

  return mapContentOutputRow(data);
}

async function createContentOutput({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeContentOutputPayload(payload);
  assertCreateContentOutputPayload(input);

  const persona = await assertPersonaConfigBelongsToUser({
    supabase,
    userId,
    personaConfigId: input.personaConfigId,
  });

  const topic = await assertTopicBelongsToUserAndPersona({
    supabase,
    userId,
    topicId: input.topicId,
    personaConfigId: input.personaConfigId,
  });

  const contentPillar = await resolveContentPillarForOutput({
    supabase,
    userId,
    personaConfigId: input.personaConfigId,
    topic,
    contentPillarId: input.contentPillarId,
  });

  const insertPayload = buildInsertPayload({
    userId,
    input: {
      ...input,
      contentPillarId: contentPillar?.id || input.contentPillarId || topic?.content_pillar_id || null,
    },
  });
  const { data, error } = await supabase
    .from("content_outputs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapContentOutputRow(data);
}

async function generateContentOutput({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeContentOutputPayload(payload);
  const startedAt = new Date().toISOString();
  let persona = null;
  let topic = null;
  let contentPillar = null;
  let sourceContentOutput = null;
  let promptTemplate = null;

  try {
    if (!input.personaConfigId) {
      throw createHttpError("Missing required field: personaConfigId", 400);
    }

    persona = await assertPersonaConfigBelongsToUser({
      supabase,
      userId,
      personaConfigId: input.personaConfigId,
    });

    topic = await assertTopicBelongsToUserAndPersona({
      supabase,
      userId,
      topicId: input.topicId,
      personaConfigId: input.personaConfigId,
    });

    contentPillar = await resolveContentPillarForOutput({
      supabase,
      userId,
      personaConfigId: input.personaConfigId,
      topic,
      contentPillarId: input.contentPillarId,
    });

    sourceContentOutput = await getSourceContentOutput({
      supabase,
      userId,
      sourceContentOutputId: input.sourceContentOutputId,
    });

    if (input.promptTemplateId) {
      promptTemplate = await promptTemplatesService.getPromptTemplateById({
        supabase,
        userId,
        id: input.promptTemplateId,
      });
    }

    const promptContext = buildPromptContext({
      persona,
      topic,
      contentPillar,
      sourceContentOutput,
      input,
    });

    const resolvedPromptTemplate = resolvePromptTemplate(promptTemplate, promptContext);
    const generatedContent = resolvedPromptTemplate?.resolvedTemplate
      ? `${resolvedPromptTemplate.resolvedTemplate}\n\n${buildDefaultDraft({
          persona,
          topic,
          contentPillar,
          platform: input.platform || promptContext.platform,
          formatOutput: input.formatOutput || promptContext.formatOutput,
          additionalPrompt: input.additionalPrompt,
          improvementHint: input.improvementHint,
        })}`
      : buildDefaultDraft({
          persona,
          topic,
          contentPillar,
          platform: input.platform || promptContext.platform,
          formatOutput: input.formatOutput || promptContext.formatOutput,
          additionalPrompt: input.additionalPrompt,
          improvementHint: input.improvementHint,
        });

    const insertPayload = buildInsertPayload({
      userId,
      input: {
        ...input,
        contentPillarId: contentPillar?.id || input.contentPillarId || topic?.content_pillar_id || null,
        platform: input.platform || promptContext.platform || "threads",
        formatOutput: input.formatOutput || promptContext.formatOutput || null,
        content: generatedContent,
        status: input.status || "draft",
        retryCount:
          input.retryCount !== undefined
            ? input.retryCount
            : input.regenerate
              ? (sourceContentOutput?.retry_count || 0) + 1
              : 0,
      },
    });

    const { data, error } = await supabase
      .from("content_outputs")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      throw createHttpError(error.message, 400, error);
    }

    const contentOutput = mapContentOutputRow(data);

    const generationLog = await createGenerationLog({
      supabase,
      userId,
      payload: {
        personaConfigId: input.personaConfigId,
        topicId: input.topicId,
        inputPayload: {
          ...input,
          promptTemplate: resolvedPromptTemplate,
          promptContext,
          sourceContentOutputId: input.sourceContentOutputId || null,
          startedAt,
        },
        outputPayload: {
          contentOutput,
          generatedContent,
        },
        status: "success",
      },
    });

    return {
      contentOutput,
      promptTemplate: resolvedPromptTemplate,
      generationLog,
      generated: true,
    };
  } catch (error) {
    try {
      await createGenerationLog({
        supabase,
        userId,
        payload: {
          personaConfigId: input.personaConfigId || null,
          topicId: input.topicId || null,
          inputPayload: {
            ...input,
            promptTemplateId: input.promptTemplateId || null,
            sourceContentOutputId: input.sourceContentOutputId || null,
            startedAt,
          },
          outputPayload: null,
          status: "failed",
          errorMessage: error.message,
        },
      });
    } catch (logError) {
      console.error("Failed to write generation log:", logError);
    }

    throw error;
  }
}

async function updateContentOutput({ supabase, userId, id, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeContentOutputPayload(payload);
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

  const topic = await assertTopicBelongsToUserAndPersona({
    supabase,
    userId,
    topicId: input.topicId,
    personaConfigId: input.personaConfigId,
  });

  if (input.contentPillarId !== undefined || topic?.content_pillar_id) {
    await resolveContentPillarForOutput({
      supabase,
      userId,
      personaConfigId: input.personaConfigId,
      topic,
      contentPillarId: input.contentPillarId,
    });
  }

  const { data, error } = await supabase
    .from("content_outputs")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content output not found", 404);
  }

  return mapContentOutputRow(data);
}

async function deleteContentOutput({ supabase, userId, id }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("content_outputs")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content output not found", 404);
  }

  return mapContentOutputRow(data);
}

module.exports = {
  createContentOutput,
  deleteContentOutput,
  generateContentOutput,
  getContentOutputById,
  listContentOutputs,
  normalizeContentOutputPayload,
  updateContentOutput,
};
