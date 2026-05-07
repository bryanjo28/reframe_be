const { isSupabaseConfigured } = require("../config/supabase");
const promptTemplatesService = require("./promptTemplatesService");
const sumopodService = require("./sumopodService");
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

function normalizeGenerateContentOutputDemoPayload(payload = {}) {
  const source = getSource(payload);

  return {
    persona: readOptionalText(source, ["persona"]),
    targetAudience: readOptionalText(source, ["targetAudience", "target_audience"]),
    nicheTopicFocus: readOptionalText(source, ["nicheTopicFocus", "niche_topic_focus"]),
    contentStyle: readOptionalText(source, ["contentStyle", "content_style"]),
    formatOutput: readOptionalText(source, ["formatOutput", "format_output"]) || "threads pendek",
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

function buildContentOutputDemoPrompt({ persona, targetAudience, nicheTopicFocus, contentStyle }) {
  return [
    "Kamu adalah asisten copywriter yang membuat maksimal 3 draft Threads singkat.",
    "Balas HANYA dalam JSON valid tanpa markdown, tanpa code fence, tanpa penjelasan tambahan.",
    "Struktur output harus seperti ini:",
    '{ "success": true, "threads": [ { "title": "", "content": "", "cta": "" } ] }',
    "",
    "Aturan output:",
    "1. Maksimal 3 threads.",
    "2. Semua threads harus singkat, padat, dan cocok untuk Threads.",
    "3. Gunakan bahasa Indonesia yang natural.",
    "4. Setiap thread harus punya angle berbeda tapi tetap relevan.",
    "5. CTA boleh ringan dan tidak hard-selling.",
    "",
    "Konteks persona:",
    `- persona: ${persona || "-"}`,
    `- target_audience: ${targetAudience || "-"}`,
    `- niche_topic_focus: ${nicheTopicFocus || "-"}`,
    `- content_style: ${contentStyle || "-"}`,
    `- format_output: threads pendek`,
    "",
    "Buat 3 opsi thread terbaik yang siap dipakai sebagai draft.",
  ].join("\n");
}

function mapPersonaConfigDraftRow(row) {
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

async function saveDemoPersonaConfig({ supabase, userId, input }) {
  const draftPayload = {
    persona: input.persona,
    target_audience: input.targetAudience,
    niche_topic_focus: input.nicheTopicFocus,
    content_style: input.contentStyle,
    platform: "Threads",
    format_output: input.formatOutput || "threads pendek",
    is_active: true,
  };

  const { data: existingPersonaConfig, error: existingError } = await supabase
    .from("persona_configs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw createHttpError(existingError.message, 400, existingError);
  }

  if (existingPersonaConfig) {
    const { data, error } = await supabase
      .from("persona_configs")
      .update(draftPayload)
      .eq("id", existingPersonaConfig.id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      throw createHttpError(error.message, 400, error);
    }

    return mapPersonaConfigDraftRow(data);
  }

  const { data, error } = await supabase
    .from("persona_configs")
    .insert({
      user_id: userId,
      ...draftPayload,
    })
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapPersonaConfigDraftRow(data);
}

function extractJsonText(text) {
  if (!text) {
    return "";
  }

  const rawText = String(text).trim();

  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return rawText.slice(firstBrace, lastBrace + 1);
  }

  return rawText;
}

function parseGeneratedJsonContent(content) {
  const jsonText = extractJsonText(content);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw createHttpError("Unable to parse generated content as JSON", 502, error);
  }
}

function buildContentOutputSystemPrompt() {
  return [
    "Kamu adalah asisten copywriter yang menulis content output untuk media sosial.",
    "Tulis dalam Bahasa Indonesia yang natural, jelas, dan siap dipakai.",
    "Kalau ada CTA link atau key message dari content pillar, gunakan secara natural tanpa memaksa.",
    "Jangan menambahkan penjelasan meta tentang proses berpikirmu.",
  ].join(" ");
}

function buildContentOutputUserPrompt({
  persona,
  topic,
  contentPillar,
  promptTemplate,
  promptContext,
  sourceContentOutput,
}) {
  const lines = [
    "Buat satu content output final yang siap dipakai.",
    "",
    "Konteks utama:",
    `- Topic: ${topic?.topic || promptContext.topic || "-"}`,
    `- Category: ${promptContext.category || "-"}`,
    `- Subcategory: ${promptContext.subcategory || "-"}`,
    `- Platform: ${promptContext.platform || "-"}`,
    `- Format Output: ${promptContext.formatOutput || "-"}`,
    "",
    "Persona:",
    `- Persona: ${persona?.persona || promptContext.persona || "-"}`,
    `- Target Audience: ${persona?.target_audience || promptContext.targetAudience || "-"}`,
    `- Niche Topic Focus: ${persona?.niche_topic_focus || promptContext.nicheTopicFocus || "-"}`,
    `- Content Style: ${persona?.content_style || promptContext.contentStyle || "-"}`,
    `- Tone: ${persona?.tone || promptContext.tone || "-"}`,
    `- Goal: ${persona?.goal || promptContext.goal || "-"}`,
    "",
    "Content pillar:",
    `- Pillar Name: ${contentPillar?.pillarName || promptContext.pillarName || "-"}`,
    `- Objective: ${contentPillar?.targetObjective || promptContext.pillarObjective || "-"}`,
    `- Audience Segment: ${contentPillar?.audienceSegment || promptContext.pillarAudienceSegment || "-"}`,
    `- Key Message: ${contentPillar?.keyMessage || promptContext.pillarKeyMessage || "-"}`,
    `- CTA Direction: ${contentPillar?.ctaDirection || promptContext.pillarCtaDirection || "-"}`,
    `- CTA Link / Affiliate: ${contentPillar?.affiliateLink || promptContext.pillarAffiliateLink || "-"}`,
    "",
    sourceContentOutput?.content
      ? [
          "Previous content reference:",
          sourceContentOutput.content,
          "",
        ].join("\n")
      : "",
    promptTemplate?.resolvedTemplate
      ? [
          "Prompt template reference:",
          promptTemplate.resolvedTemplate,
          "",
        ].join("\n")
      : "",
    promptContext.additionalPrompt
      ? `Instruksi tambahan dari user: ${promptContext.additionalPrompt}`
      : "",
    promptContext.improvementHint
      ? `Fokus perbaikan: ${promptContext.improvementHint}`
      : "",
    "",
    "Output requirements:",
    "1. Tulis satu output final yang langsung siap dipakai.",
    "2. Kalau cocok, buat hook yang kuat di awal.",
    "3. Jangan bertele-tele.",
    "4. Jika ada CTA link, letakkan natural di bagian yang relevan.",
    "5. Jangan pakai format JSON, cukup teks final.",
  ].filter(Boolean);

  return lines.join("\n");
}

function shouldLogContentOutputGenerationDebug() {
  const flag = String(process.env.CONTENT_OUTPUTS_GENERATE_DEBUG || "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

function logContentOutputGenerationDebug(label, payload) {
  if (!shouldLogContentOutputGenerationDebug()) {
    return;
  }

  console.log(`[content-outputs.generate] ${label}`, JSON.stringify(payload, null, 2));
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

async function getTopicWithOptionalContentPillar({
  supabase,
  userId,
  topicId,
}) {
  const { data, error } = await supabase
    .from("content_topics")
    .select(
      "id, user_id, persona_config_id, content_pillar_id, category, subcategory, topic, used_at, created_at"
    )
    .eq("id", topicId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content topic not found", 404);
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

async function markTopicAsUsed({ supabase, userId, topicId }) {
  if (!topicId) {
    return null;
  }

  const usedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("content_topics")
    .update({ used_at: usedAt })
    .eq("id", topicId)
    .eq("user_id", userId)
    .select("id, used_at")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return data || null;
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
  let resolvedPersonaConfigId = input.personaConfigId || null;

  try {
    if (!input.topicId) {
      throw createHttpError("Missing required field: topicId", 400);
    }

    topic = await getTopicWithOptionalContentPillar({
      supabase,
      userId,
      topicId: input.topicId,
    });

    resolvedPersonaConfigId = resolvedPersonaConfigId || topic.persona_config_id;

    if (!resolvedPersonaConfigId) {
      throw createHttpError("Unable to resolve personaConfigId from topic", 400);
    }

    persona = await assertPersonaConfigBelongsToUser({
      supabase,
      userId,
      personaConfigId: resolvedPersonaConfigId,
    });

    contentPillar = await resolveContentPillarForOutput({
      supabase,
      userId,
      personaConfigId: resolvedPersonaConfigId,
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
    const systemPrompt = buildContentOutputSystemPrompt();
    const userPrompt = buildContentOutputUserPrompt({
      persona,
      topic,
      contentPillar,
      promptTemplate: resolvedPromptTemplate,
      promptContext,
      sourceContentOutput,
    });

    logContentOutputGenerationDebug("prompt", {
      systemPrompt,
      userPrompt,
      promptTemplate: resolvedPromptTemplate,
      promptContext,
    });

    const aiResult = await sumopodService.generateChatCompletion({
      model: input.model || "gpt-4o-mini",
      maxTokens: input.maxTokens || 1200,
      temperature: input.temperature || 0.5,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const generatedContent = String(aiResult.content || "").trim() || buildDefaultDraft({
      persona,
      topic,
      contentPillar,
      platform: input.platform || promptContext.platform,
      formatOutput: input.formatOutput || promptContext.formatOutput,
      additionalPrompt: input.additionalPrompt,
      improvementHint: input.improvementHint,
    });

    logContentOutputGenerationDebug("sumopod_response", {
      model: aiResult.model,
      raw: aiResult.raw,
      content: aiResult.content,
    });

    const insertPayload = buildInsertPayload({
      userId,
      input: {
        ...input,
        personaConfigId: resolvedPersonaConfigId,
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

    try {
      await markTopicAsUsed({
        supabase,
        userId,
        topicId: topic.id,
      });
    } catch (topicUsedError) {
      console.error("Failed to mark topic as used:", topicUsedError);
    }

    const generationLog = await createGenerationLog({
      supabase,
      userId,
      payload: {
        personaConfigId: resolvedPersonaConfigId,
        topicId: input.topicId,
        inputPayload: {
          ...input,
          personaConfigId: resolvedPersonaConfigId,
          promptTemplate: resolvedPromptTemplate,
          promptContext,
          sourceContentOutputId: input.sourceContentOutputId || null,
          startedAt,
        },
        outputPayload: {
          contentOutput,
          generatedContent,
          aiResponse: {
            model: aiResult.model,
            usage: aiResult.raw?.usage || null,
          },
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
          personaConfigId: resolvedPersonaConfigId || null,
          topicId: input.topicId || null,
          inputPayload: {
            ...input,
            personaConfigId: resolvedPersonaConfigId || input.personaConfigId || null,
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

async function generateContentOutputDemo({ supabase, userId, payload }) {
  const input = normalizeGenerateContentOutputDemoPayload(payload);

  if (!input.persona) {
    throw createHttpError("Missing required field: persona", 400);
  }

  if (!input.targetAudience) {
    throw createHttpError("Missing required field: targetAudience", 400);
  }

  if (!input.nicheTopicFocus) {
    throw createHttpError("Missing required field: nicheTopicFocus", 400);
  }

  if (!input.contentStyle) {
    throw createHttpError("Missing required field: contentStyle", 400);
  }

  const savedPersonaConfig = await saveDemoPersonaConfig({
    supabase,
    userId,
    input,
  });

  const systemPrompt = [
    "Kamu adalah asisten copywriter yang menulis draft Threads singkat.",
    "Output harus berupa JSON valid saja, tanpa markdown dan tanpa code fence.",
  ].join(" ");

  const userPrompt = buildContentOutputDemoPrompt(input);

  logContentOutputGenerationDebug("demo_prompt", {
    userId,
    input,
    systemPrompt,
    userPrompt,
  });

  const aiResult = await sumopodService.generateChatCompletion({
    model: "gpt-4o-mini",
    maxTokens: 1200,
    temperature: 0.8,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  logContentOutputGenerationDebug("demo_sumopod_response", {
    model: aiResult.model,
    raw: aiResult.raw,
    content: aiResult.content,
  });

  const parsedContent = parseGeneratedJsonContent(aiResult.content);
  if (Array.isArray(parsedContent?.threads) && parsedContent.threads.length > 3) {
    parsedContent.threads = parsedContent.threads.slice(0, 3);
  }

  const usage = aiResult?.raw?.usage || {};

  return {
    success: true,
    parsed_content: parsedContent,
    usage: {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
    },
    request: {
      personaConfigId: savedPersonaConfig?.id || null,
      persona: input.persona,
      targetAudience: input.targetAudience,
      nicheTopicFocus: input.nicheTopicFocus,
      contentStyle: input.contentStyle,
      formatOutput: input.formatOutput,
      maxThreads: 3,
    },
    personaConfig: savedPersonaConfig,
  };
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
  generateContentOutputDemo,
  generateContentOutput,
  getContentOutputById,
  listContentOutputs,
  normalizeContentOutputPayload,
  normalizeGenerateContentOutputDemoPayload,
  updateContentOutput,
};
