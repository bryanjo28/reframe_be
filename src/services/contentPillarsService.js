const { isSupabaseConfigured } = require("../config/supabase");
const sumopodService = require("./sumopodService");

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
    affiliateLink: readOptionalText(source, ["affiliateLink", "affiliate_link"]),
    aiEnhancedVersion: readOptionalText(source, ["aiEnhancedVersion", "ai_enhanced_version"]),
    userReviewEdit: readOptionalText(source, ["userReviewEdit", "user_review_edit"]),
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
    formatOutput: row.format_output,
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
    subcategory: row.subcategory,
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
    formatOutput: row.format_output,
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
    affiliateLink: row.affiliate_link,
    aiEnhancedVersion: row.ai_enhanced_version,
    userReviewEdit: row.user_review_edit,
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

function buildContentPillarEnhancementPrompt(contentPillar, personaConfig = null) {
  const lines = [
    "Ubah data content pillar berikut menjadi rangkaian kalimat yang natural, rapi, dan mudah dipahami.",
    "Tujuannya adalah menghasilkan versi enhanced yang bisa langsung dipakai sebagai konten/brief yang lebih matang.",
    "Jangan mengarang fakta baru. Pertahankan makna inti dari data yang diberikan.",
    "Gunakan Bahasa Indonesia yang jelas dan profesional.",
    "Data content pillar:",
    `- Pillar Name: ${contentPillar.pillarName || contentPillar.name || "-"}`,
    `- Template Content: ${contentPillar.templateContent || "-"}`,
    `- Target Objective: ${contentPillar.targetObjective || "-"}`,
    `- Audience Segment: ${contentPillar.audienceSegment || "-"}`,
    `- Key Message: ${contentPillar.keyMessage || "-"}`,
    `- CTA Direction: ${contentPillar.ctaDirection || "-"}`,
    `- Affiliate Link: ${contentPillar.affiliateLink || "-"}`,
    "",
    "Persona config:",
    `- Persona: ${personaConfig?.persona || "-"}`,
    `- Target Audience: ${personaConfig?.targetAudience || "-"}`,
    `- Niche Topic Focus: ${personaConfig?.nicheTopicFocus || "-"}`,
    `- Content Style: ${personaConfig?.contentStyle || "-"}`,
    `- Tone: ${personaConfig?.tone || "-"}`,
    `- Goal: ${personaConfig?.goal || "-"}`,
    `- Posisi Persona Saat Ini: ${personaConfig?.posisiPersonaSaatIni || "-"}`,
    `- Audience Masalah Utama: ${personaConfig?.audienceMasalahUtama || "-"}`,
    `- Apa Yang Mereka Rasakan: ${personaConfig?.apaYangMerekaRasakan || "-"}`,
    `- Kenapa Harus Follow: ${personaConfig?.kenapaHarusFollow || "-"}`,
    `- Gaya Komunikasi: ${personaConfig?.gayaKomunikasi || "-"}`,
    `- Platform: ${personaConfig?.platform || "-"}`,
    `- Format Output: ${personaConfig?.formatOutput || "-"}`,
    `- Gaya Hook: ${personaConfig?.gayaHook || "-"}`,
    `- Seberapa Personal: ${personaConfig?.seberapaPersonal || "-"}`,
    `- CTA Style: ${personaConfig?.ctaStyle || "-"}`,
    `- Content Pillar Prioritas: ${personaConfig?.contentPillarPrioritas || "-"}`,
    `- Referensi Gaya: ${personaConfig?.referensiGaya || "-"}`,
    `- Batasan Konten: ${personaConfig?.batasanKonten || "-"}`,
    "",
    "Output yang diinginkan:",
    "Buat 1 versi enhanced yang terasa seperti rangkaian kalimat yang menyatu. Jika perlu, boleh dibuat 1-2 paragraf singkat. Fokus pada kejelasan, alur, dan kualitas bahasa.",
    "Note: Jangan ada kalimat berikut adalah / tentu ini adalah. Tapi langsung to the point hasil enhanced pillarnya apa."
  ];

  return lines.join("\n");
}

function shouldLogContentPillarEnhancementDebug() {
  const flag = String(process.env.CONTENT_PILLAR_ENHANCE_DEBUG || "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

function logContentPillarEnhancementDebug({
  enhancementInput,
  personaConfig,
  contentPillar,
  prompt,
  model,
  maxTokens,
  temperature,
}) {
  if (!shouldLogContentPillarEnhancementDebug()) {
    return;
  }

  console.log(
    "[content-pillars.enhance] debug",
    JSON.stringify(
      {
        model,
        maxTokens,
        temperature,
        enhancementInput,
        personaConfig,
        contentPillar,
        prompt,
      },
      null,
      2
    )
  );
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

  if (input.affiliateLink !== undefined) {
    payload.affiliate_link = input.affiliateLink;
  }

  if (input.aiEnhancedVersion !== undefined) {
    payload.ai_enhanced_version = input.aiEnhancedVersion;
  }

  if (input.userReviewEdit !== undefined) {
    payload.user_review_edit = input.userReviewEdit;
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

  if (input.affiliateLink !== undefined) {
    payload.affiliate_link = input.affiliateLink;
  }

  if (input.aiEnhancedVersion !== undefined) {
    payload.ai_enhanced_version = input.aiEnhancedVersion;
  }

  if (input.userReviewEdit !== undefined) {
    payload.user_review_edit = input.userReviewEdit;
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
    .select("id, user_id, persona_config_id, pillar_name, template_content, target_objective, audience_segment, key_message, cta_direction, affiliate_link, ai_enhanced_version, user_review_edit, is_active, sort_order, created_at, updated_at")
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
      .select("id, user_id, persona, target_audience, niche_topic_focus, content_style, tone, goal, platform, format_output, created_at, updated_at")
      .eq("id", pillarData.persona_config_id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("content_topics")
      .select("id, user_id, persona_config_id, content_pillar_id, category, subcategory, topic, used_at, created_at")
      .eq("content_pillar_id", contentPillarId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("content_outputs")
      .select("id, user_id, persona_config_id, content_pillar_id, topic_id, platform, format_output, content, status, retry_count, created_at, updated_at")
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
        .select("id, user_id, persona, target_audience, niche_topic_focus, content_style, tone, goal, platform, format_output, created_at, updated_at")
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

async function enhanceContentPillarWithAi({
  supabase,
  userId,
  id,
  input,
  model = "gemini-2.5-flash-lite",
  maxTokens = 350,
  temperature = 0.5,
  systemPrompt = "You are a helpful assistant that rewrites marketing strategy inputs into a polished, concise, and coherent Indonesian paragraph.",
}) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const enhancementInput = normalizeContentPillarPayload(input);
  if (!enhancementInput.personaConfigId) {
    throw createHttpError("Missing required field: personaConfigId", 400);
  }

  if (!enhancementInput.pillarName) {
    throw createHttpError("Missing required field: name", 400);
  }

  const personaConfig = await assertPersonaConfigBelongsToUser({
    supabase,
    userId,
    personaConfigId: enhancementInput.personaConfigId,
  });

  const contentPillar = id
    ? await assertContentPillarBelongsToUserAndPersona({
        supabase,
        userId,
        contentPillarId: id,
        personaConfigId: enhancementInput.personaConfigId,
      })
    : null;

  const prompt = buildContentPillarEnhancementPrompt(enhancementInput, personaConfig);
  logContentPillarEnhancementDebug({
    enhancementInput,
    personaConfig,
    contentPillar,
    prompt,
    model,
    maxTokens,
    temperature,
  });

  const result = await sumopodService.generateChatCompletion({
    model,
    maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });

  return {
    contentPillar,
    enhancementInput,
    personaConfig,
    model: result.model,
    aiEnhancedVersion: result.content,
    prompt,
    systemPrompt,
  };
}

module.exports = {
  assertContentPillarBelongsToUserAndPersona,
  createContentPillar,
  deleteContentPillar,
  enhanceContentPillarWithAi,
  getContentPillarById,
  listContentPillars,
  normalizeContentPillarPayload,
  updateContentPillar,
};
