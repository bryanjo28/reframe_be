const { isSupabaseConfigured } = require("../config/supabase");
const promptTemplatesService = require("./promptTemplatesService");
const sumopodService = require("./sumopodService");
const { createGenerationLog } = require("./generationLogsService");
const { consumeDailyGenerationHit } = require("./dailyGenerationUsageService");
const { consumeMonthlyAiCredits } = require("./subscriptionUsageService");
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
  if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") {
    return undefined;
  }

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
    scheduledJobId: readOptionalText(source, ["scheduledJobId", "scheduled_job_id"]),
    scheduledJobRunId: readOptionalText(
      source,
      ["scheduledJobRunId", "scheduled_job_run_id"]
    ),
    promptTemplateId: readOptionalText(source, ["promptTemplateId", "prompt_template_id"]),
    platform: readOptionalText(source, ["platform"]),
    formatOutput: readOptionalText(source, ["formatOutput", "format_output"]),
    content: readOptionalText(source, ["content"]),
    status: readOptionalText(source, ["status"]),
    scheduledAt: readOptionalText(source, ["scheduledAt", "scheduled_at"]),
    externalPostId: readOptionalText(source, ["externalPostId", "external_post_id"]),
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

function normalizeAutoGenerateContentOutputsPayload(payload = {}) {
  const source = getSource(payload);

  return {
    ...normalizeContentOutputPayload(source),
    targetCount: readOptionalNumber(source, ["targetCount", "target_count"]),
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

function assertAutoGenerateContentOutputsPayload(payload) {
  if (!payload.contentPillarId || payload.contentPillarId.length === 0) {
    throw createHttpError("Missing required field: contentPillarId", 400);
  }

  if (payload.targetCount === undefined || payload.targetCount === null) {
    throw createHttpError("Missing required field: targetCount", 400);
  }

  if (!Number.isInteger(payload.targetCount)) {
    throw createHttpError("targetCount must be an integer", 400);
  }

  if (payload.targetCount < 1 || payload.targetCount > 20) {
    throw createHttpError("targetCount must be between 1 and 20", 400);
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
    scheduledJobId: row.scheduled_job_id,
    scheduledJobRunId: row.scheduled_job_run_id,
    platform: row.platform,
    formatOutput: row.format_output,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    retryCount: row.retry_count,
    scheduledAt: row.scheduled_at,
    externalPostId: row.external_post_id,
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

  if (input.scheduledJobId !== undefined) {
    payload.scheduled_job_id = input.scheduledJobId;
  }

  if (input.scheduledJobRunId !== undefined) {
    payload.scheduled_job_run_id = input.scheduledJobRunId;
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

  if (input.scheduledAt !== undefined) {
    payload.scheduled_at = input.scheduledAt;
  }

  if (input.externalPostId !== undefined) {
    payload.external_post_id = input.externalPostId;
  }

  if (input.retryCount !== undefined) {
    payload.retry_count = input.retryCount;
  }

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {};

  if (input.content !== undefined) {
    payload.content = input.content;
  }

  if (input.status !== undefined) {
    payload.status = input.status;
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

async function listUnusedTopicsForAutoGeneration({ supabase, userId, contentPillarId, targetCount }) {
  const { data, error } = await supabase
    .from("content_topics")
    .select(
      "id, user_id, persona_config_id, content_pillar_id, category, subcategory, topic, used_at, created_at"
    )
    .eq("user_id", userId)
    .eq("content_pillar_id", contentPillarId)
    .is("used_at", null)
    .order("created_at", { ascending: true })
    .limit(targetCount);

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return (data || []).map((row) => ({
    id: row.id,
    user_id: row.user_id,
    persona_config_id: row.persona_config_id,
    content_pillar_id: row.content_pillar_id,
    category: row.category,
    subcategory: row.subcategory,
    topic: row.topic,
    used_at: row.used_at,
    created_at: row.created_at,
  }));
}

function mapScheduledJobRunRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    scheduledJobId: row.scheduled_job_id,
    userId: row.user_id,
    status: row.status,
    targetCount: row.target_count,
    fetchedCount: row.fetched_count,
    processedCount: row.processed_count,
    successCount: row.success_count,
    failedCount: row.failed_count,
    runPayload: row.run_payload,
    resultPayload: row.result_payload,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

async function createScheduledJobRun({ supabase, userId, payload }) {
  const insertPayload = {
    scheduled_job_id: payload.scheduledJobId,
    user_id: userId,
    status: payload.status || "running",
    target_count: payload.targetCount || 10,
    fetched_count: payload.fetchedCount || 0,
    processed_count: payload.processedCount || 0,
    success_count: payload.successCount || 0,
    failed_count: payload.failedCount || 0,
    run_payload: payload.runPayload || {},
    result_payload: payload.resultPayload || null,
    error_message: payload.errorMessage || null,
    started_at: payload.startedAt || new Date().toISOString(),
    finished_at: payload.finishedAt || null,
  };

  const { data, error } = await supabase
    .from("scheduled_job_runs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapScheduledJobRunRow(data);
}

async function updateScheduledJobRun({ supabase, userId, id, payload }) {
  const updatePayload = {};

  if (payload.status !== undefined) {
    updatePayload.status = payload.status;
  }

  if (payload.targetCount !== undefined) {
    updatePayload.target_count = payload.targetCount;
  }

  if (payload.fetchedCount !== undefined) {
    updatePayload.fetched_count = payload.fetchedCount;
  }

  if (payload.processedCount !== undefined) {
    updatePayload.processed_count = payload.processedCount;
  }

  if (payload.successCount !== undefined) {
    updatePayload.success_count = payload.successCount;
  }

  if (payload.failedCount !== undefined) {
    updatePayload.failed_count = payload.failedCount;
  }

  if (payload.runPayload !== undefined) {
    updatePayload.run_payload = payload.runPayload;
  }

  if (payload.resultPayload !== undefined) {
    updatePayload.result_payload = payload.resultPayload;
  }

  if (payload.errorMessage !== undefined) {
    updatePayload.error_message = payload.errorMessage;
  }

  if (payload.startedAt !== undefined) {
    updatePayload.started_at = payload.startedAt;
  }

  if (payload.finishedAt !== undefined) {
    updatePayload.finished_at = payload.finishedAt;
  }

  if (Object.keys(updatePayload).length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("scheduled_job_runs")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapScheduledJobRunRow(data);
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

async function generateContentOutputForTopic({ supabase, userId, input, topic, startedAt }) {
  const workingInput = normalizeContentOutputPayload(input);
  const generationStartedAt = startedAt || new Date().toISOString();
  let persona = null;
  let contentPillar = null;
  let sourceContentOutput = null;
  let promptTemplate = null;
  let resolvedPersonaConfigId = workingInput.personaConfigId || null;

  try {
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
      contentPillarId: workingInput.contentPillarId,
    });

    sourceContentOutput = await getSourceContentOutput({
      supabase,
      userId,
      sourceContentOutputId: workingInput.sourceContentOutputId,
    });

    if (workingInput.promptTemplateId) {
      promptTemplate = await promptTemplatesService.getPromptTemplateById({
        supabase,
        userId,
        id: workingInput.promptTemplateId,
      });
    }

    const promptContext = buildPromptContext({
      persona,
      topic,
      contentPillar,
      sourceContentOutput,
      input: workingInput,
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

    const dailyUsage = await consumeDailyGenerationHit({
      supabase,
      userId,
      usageKey: "generate_content",
    });

    const aiResult = await sumopodService.generateChatCompletion({
      model: workingInput.model || "gpt-4o-mini",
      maxTokens: workingInput.maxTokens || 1200,
      temperature: workingInput.temperature || 0.5,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const generatedContent = String(aiResult.content || "").trim() || buildDefaultDraft({
      persona,
      topic,
      contentPillar,
      platform: workingInput.platform || promptContext.platform,
      formatOutput: workingInput.formatOutput || promptContext.formatOutput,
      additionalPrompt: workingInput.additionalPrompt,
      improvementHint: workingInput.improvementHint,
    });

    logContentOutputGenerationDebug("sumopod_response", {
      model: aiResult.model,
      raw: aiResult.raw,
      content: aiResult.content,
    });

    const aiUsage = await consumeMonthlyAiCredits({
      supabase,
      userId,
      usage: aiResult.raw?.usage || null,
    });

    const usage = aiResult?.raw?.usage || {};

    const insertPayload = buildInsertPayload({
      userId,
      input: {
        ...workingInput,
        personaConfigId: resolvedPersonaConfigId,
        contentPillarId: contentPillar?.id || workingInput.contentPillarId || topic?.content_pillar_id || null,
        topicId: topic.id,
        platform: workingInput.platform || promptContext.platform || "threads",
        formatOutput: workingInput.formatOutput || promptContext.formatOutput || null,
        content: generatedContent,
        status: workingInput.status || "draft",
        scheduledAt: workingInput.scheduledAt || null,
        retryCount:
          workingInput.retryCount !== undefined
            ? workingInput.retryCount
            : workingInput.regenerate
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
        topicId: topic.id,
        scheduledJobRunId: workingInput.scheduledJobRunId || null,
        inputPayload: {
          ...workingInput,
          personaConfigId: resolvedPersonaConfigId,
          topicId: topic.id,
          promptTemplate: resolvedPromptTemplate,
          promptContext,
          sourceContentOutputId: workingInput.sourceContentOutputId || null,
          startedAt: generationStartedAt,
        },
        outputPayload: {
          contentOutput,
          generatedContent,
          aiResponse: {
            model: aiResult.model,
            usage,
            dailyUsage,
            subscriptionUsage: aiUsage,
          },
        },
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        status: "success",
      },
    });

    return {
      contentOutput,
      promptTemplate: resolvedPromptTemplate,
      generationLog,
      generated: true,
      topic,
      personaConfigId: resolvedPersonaConfigId,
    };
  } catch (error) {
    try {
      await createGenerationLog({
        supabase,
        userId,
        payload: {
          personaConfigId: resolvedPersonaConfigId || null,
          topicId: topic?.id || workingInput.topicId || null,
          scheduledJobRunId: workingInput.scheduledJobRunId || null,
          inputPayload: {
            ...workingInput,
            personaConfigId: resolvedPersonaConfigId || workingInput.personaConfigId || null,
            topicId: topic?.id || workingInput.topicId || null,
            promptTemplateId: workingInput.promptTemplateId || null,
            sourceContentOutputId: workingInput.sourceContentOutputId || null,
            startedAt: generationStartedAt,
          },
          outputPayload: null,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
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

async function generateContentOutput({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeContentOutputPayload(payload);

  if (!input.topicId) {
    throw createHttpError("Missing required field: topicId", 400);
  }

  const topic = await getTopicWithOptionalContentPillar({
    supabase,
    userId,
    topicId: input.topicId,
  });

  return generateContentOutputForTopic({
    supabase,
    userId,
    input,
    topic,
  });
}

async function autoGenerateContentOutputs({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeAutoGenerateContentOutputsPayload(payload);
  assertAutoGenerateContentOutputsPayload(input);

  const contentPillar = await assertContentPillarBelongsToUserAndPersona({
    supabase,
    userId,
    contentPillarId: input.contentPillarId,
    personaConfigId: input.personaConfigId || null,
  });

  const requestedCount = input.targetCount;
  const scheduledAt = input.scheduledAt || new Date().toISOString();

  const topics = await listUnusedTopicsForAutoGeneration({
    supabase,
    userId,
    contentPillarId: contentPillar.id,
    targetCount: requestedCount,
  });

  if (topics.length < requestedCount) {
    throw createHttpError(
      `Not enough unused topics for this content pillar. Requested ${requestedCount}, available ${topics.length}.`,
      400,
      {
        requestedCount,
        availableCount: topics.length,
        contentPillarId: contentPillar.id,
      }
    );
  }

  let scheduledJobRun = null;
  if (input.scheduledJobId) {
    scheduledJobRun = await createScheduledJobRun({
      supabase,
      userId,
      payload: {
        scheduledJobId: input.scheduledJobId,
        targetCount: requestedCount,
        runPayload: {
          ...input,
          scheduledAt,
          contentPillarId: contentPillar.id,
        },
      },
    });
  }

  const results = [];
  let successCount = 0;
  let failedCount = 0;

  for (const topic of topics) {
    try {
      const result = await generateContentOutputForTopic({
        supabase,
        userId,
        input: {
          ...input,
          contentPillarId: contentPillar.id,
          scheduledAt,
          scheduledJobId: input.scheduledJobId || null,
          scheduledJobRunId: scheduledJobRun?.id || input.scheduledJobRunId || null,
          topicId: topic.id,
        },
        topic,
        startedAt: new Date().toISOString(),
      });

      successCount += 1;
      results.push({
        topicId: topic.id,
        status: "success",
        contentOutput: result.contentOutput,
        generationLog: result.generationLog,
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        topicId: topic.id,
        status: "failed",
        error: error.message,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = {
    requestedCount,
    availableCount: topics.length,
    successCount,
    failedCount,
    scheduledAt,
  };

  if (scheduledJobRun) {
    const updatedRun = await updateScheduledJobRun({
      supabase,
      userId,
      id: scheduledJobRun.id,
      payload: {
        status: failedCount > 0 ? "completed_with_errors" : "completed",
        targetCount: requestedCount,
        fetchedCount: topics.length,
        processedCount: results.length,
        successCount,
        failedCount,
        resultPayload: {
          summary,
          results,
        },
        finishedAt,
      },
    });

    await supabase
      .from("scheduled_jobs")
      .update({
        last_run_at: finishedAt,
        last_run_status: failedCount > 0 ? "completed_with_errors" : "completed",
        last_run_generated_count: successCount,
        last_run_error: failedCount > 0 ? "One or more topics failed during auto generation" : null,
        error_message: failedCount > 0 ? "One or more topics failed during auto generation" : null,
      })
      .eq("id", input.scheduledJobId)
      .eq("user_id", userId);

    return {
      success: true,
      summary,
      results,
      scheduledJobRun: updatedRun || scheduledJobRun,
      scheduledJobId: input.scheduledJobId,
    };
  }

  return {
    success: true,
    summary,
    results,
    scheduledJobRun: null,
    scheduledJobId: null,
  };
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

  const aiUsage = await consumeMonthlyAiCredits({
    supabase,
    userId,
    usage: aiResult.raw?.usage || null,
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
    subscriptionUsage: aiUsage,
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
  createScheduledJobRun,
  deleteContentOutput,
  autoGenerateContentOutputs,
  generateContentOutputDemo,
  generateContentOutput,
  getContentOutputById,
  listContentOutputs,
  normalizeAutoGenerateContentOutputsPayload,
  normalizeContentOutputPayload,
  normalizeGenerateContentOutputDemoPayload,
  updateContentOutput,
  updateScheduledJobRun,
};
