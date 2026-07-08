const { isSupabaseConfigured } = require("../config/supabase");
const sumopodService = require("./sumopodService");
const { createGenerationTopicLog } = require("./generationTopicLogsService");
const { consumeDailyGenerationHit } = require("./dailyGenerationUsageService");
const { consumeMonthlyAiCredits } = require("./subscriptionUsageService");

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

function normalizeGenerateContentTopicsPayload(payload = {}) {
  const source = getSource(payload);

  return {
    contentPillarId: readOptionalText(source, ["contentPillarId", "content_pillar_id"]),
    templateId: readOptionalText(
      source,
      ["templateId", "template_id", "promptTemplateId", "prompt_template_id"]
    ),
    templateText: readOptionalText(source, ["templateText", "template_text"]),
    jumlahTopics: readOptionalNumber(
      source,
      ["jumlahTopics", "jumlah_topics", "totalTopics", "total_topics"]
    ),
  };
}


function assertGenerateContentTopicsPayload(payload) {
  if (!payload.contentPillarId || payload.contentPillarId.length === 0) {
    throw createHttpError("Missing required field: contentPillarId", 400);
  }

  if (!payload.templateText || payload.templateText.length === 0) {
    throw createHttpError("Missing required field: templateText", 400);
  }

  if (payload.jumlahTopics === undefined || payload.jumlahTopics === null) {
    throw createHttpError("Missing required field: jumlahTopics", 400);
  }

  if (!Number.isInteger(payload.jumlahTopics)) {
    throw createHttpError("jumlahTopics must be an integer", 400);
  }

  if (payload.jumlahTopics < 1 || payload.jumlahTopics > 10) {
    throw createHttpError("jumlahTopics must be between 1 and 10", 400);
  }
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContentPillarRow(row) {
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
  };
}

async function getOwnedContentPillarWithPersona({ supabase, userId, contentPillarId }) {
  const { data: contentPillarData, error: contentPillarError } = await supabase
    .from("content_pillars")
    .select(
      "id, user_id, persona_config_id, pillar_name, template_content, target_objective, audience_segment, key_message, cta_direction, affiliate_link, ai_enhanced_version, user_review_edit, is_active, sort_order, created_at, updated_at"
    )
    .eq("id", contentPillarId)
    .eq("user_id", userId)
    .maybeSingle();

  if (contentPillarError) {
    throw createHttpError(contentPillarError.message, 400, contentPillarError);
  }

  if (!contentPillarData) {
    throw createHttpError("Content pillar not found", 404);
  }

  const { data: personaConfigData, error: personaConfigError } = await supabase
    .from("persona_configs")
    .select(
      "id, user_id, persona, target_audience, niche_topic_focus, content_style, tone, goal, platform, format_output, created_at, updated_at"
    )
    .eq("id", contentPillarData.persona_config_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (personaConfigError) {
    throw createHttpError(personaConfigError.message, 400, personaConfigError);
  }

  if (!personaConfigData) {
    throw createHttpError("Persona config not found", 404);
  }

  return {
    contentPillar: mapContentPillarRow(contentPillarData),
    personaConfig: mapPersonaConfigRow(personaConfigData),
  };
}

function buildTopicGenerationPrompt({ contentPillar, personaConfig, templateText, jumlahTopics }) {
  return [
    "Kamu adalah asisten yang membuat daftar ide content topic untuk konten media sosial.",
    "Balas HANYA dalam JSON valid tanpa markdown, tanpa code fence, tanpa penjelasan tambahan.",
    "Struktur output harus seperti ini:",
    '{ "success": true, "topics": [ { "title": "", "angle": "", "audience_pain": "", "category_type": "", "why_it_works": "" } ] }',
    "",
    `Jumlah topics yang harus dibuat: ${jumlahTopics}`,
    "",
    "Template / arahan utama:",
    templateText,
    "",
    "Konteks content pillar:",
    `- pillar_name: ${contentPillar?.pillarName || "-"}`,
    `- template_content: ${contentPillar?.templateContent || "-"}`,
    `- target_objective: ${contentPillar?.targetObjective || "-"}`,
    `- audience_segment: ${contentPillar?.audienceSegment || "-"}`,
    `- key_message: ${contentPillar?.keyMessage || "-"}`,
    `- cta_direction: ${contentPillar?.ctaDirection || "-"}`,
    "",
    "Konteks persona config:",
    `- persona: ${personaConfig?.persona || "-"}`,
    `- target_audience: ${personaConfig?.targetAudience || "-"}`,
    `- niche_topic_focus: ${personaConfig?.nicheTopicFocus || "-"}`,
    `- content_style: ${personaConfig?.contentStyle || "-"}`,
    `- tone: ${personaConfig?.tone || "-"}`,
    `- goal: ${personaConfig?.goal || "-"}`,
    `- platform: ${personaConfig?.platform || "-"}`,
    `- format_output: ${personaConfig?.formatOutput || "-"}`,
    "",
    "Aturan:",
    "1. title harus berupa ide topic utama.",
    "2. angle harus menjelaskan sudut pandang topic.",
    "3. audience_pain harus jelaskan masalah/pain point audiens.",
    "4. category_type boleh berupa educational, storytelling, opinion, tutorial, atau analisis.",
    "5. why_it_works harus singkat dan spesifik.",
    "6. topics harus berjumlah sesuai permintaan dan unik.",
  ].join("\n");
}


function buildSystemPrompt() {
  return "You generate Indonesian content topic ideas and must output only valid JSON.";
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

function parseGeneratedTopicsContent(content) {
  const jsonText = extractJsonText(content);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw createHttpError("Unable to parse generated topic content as JSON", 502, error);
  }
}

function getUsageFromResult(result) {
  const usage = result?.raw?.usage || {};

  return {
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };
}

function shouldLogContentTopicsGenerationDebug() {
  const flag = String(process.env.CONTENT_TOPICS_GENERATE_DEBUG || "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

function logContentTopicsGenerationDebug(label, payload) {
  if (!shouldLogContentTopicsGenerationDebug()) {
    return;
  }

  console.log(`[content-topics.generate] ${label}`, JSON.stringify(payload, null, 2));
}

async function generateContentTopics({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeGenerateContentTopicsPayload(payload);
  assertGenerateContentTopicsPayload(input);

  const { contentPillar, personaConfig } = await getOwnedContentPillarWithPersona({
    supabase,
    userId,
    contentPillarId: input.contentPillarId,
  });

  const prompt = buildTopicGenerationPrompt({
    contentPillar,
    personaConfig,
    templateText: input.templateText,
    jumlahTopics: input.jumlahTopics,
  });
  const systemPrompt = buildSystemPrompt();

  logContentTopicsGenerationDebug("request", {
    userId,
    input,
    contentPillar,
    personaConfig,
    prompt,
    systemPrompt,
  });

  try {
    const dailyUsage = await consumeDailyGenerationHit({
      supabase,
      userId,
      usageKey: "generate_topic",
    });

    const result = await sumopodService.generateChatCompletion({
      model: "gpt-4o-mini",
      maxTokens: 1200,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });

    logContentTopicsGenerationDebug("sumopod_raw_response", {
      model: result.model,
      raw: result.raw,
      content: result.content,
    });

    const parsedContent = parseGeneratedTopicsContent(result.content);
    const usage = getUsageFromResult(result);
    const topicCount = Array.isArray(parsedContent?.topics) ? parsedContent.topics.length : 0;

    const subscriptionUsage = await consumeMonthlyAiCredits({
      supabase,
      userId,
      usage: result.raw?.usage || null,
    });

    const generationTopicLog = await createGenerationTopicLog({
      supabase,
      userId,
      payload: {
        personaConfigId: personaConfig.id,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        topicCount,
        provider: "sumopod",
        status: "success",
      },
    });

    const response = {
      success: true,
      parsed_content: parsedContent,
      usage: {
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
      },
      daily_usage: dailyUsage,
      subscription_usage: subscriptionUsage,
      generation_topic_log: generationTopicLog,
      request: {
        contentPillarId: input.contentPillarId,
        templateId: input.templateId || null,
        jumlahTopics: input.jumlahTopics,
      },
    };

    logContentTopicsGenerationDebug("response", {
      raw: result.raw,
      parsedContent,
      usage,
      generationTopicLog,
    });

  return response;
  } catch (error) {
    try {
      await createGenerationTopicLog({
        supabase,
        userId,
        payload: {
          personaConfigId: personaConfig.id,
          topicCount: input.jumlahTopics,
          provider: "sumopod",
          status: "failed",
          errorMessage: error.message,
        },
      });
    } catch (logError) {
      console.error("Failed to write generation topic log:", logError);
    }

    throw error;
  }
}

module.exports = {
  generateContentTopics,
  normalizeGenerateContentTopicsPayload,
  parseGeneratedTopicsContent,
};
