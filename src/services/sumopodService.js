const { OpenAI } = require("openai");
const { MAX_AI_OUTPUT_TOKENS } = require("../config/billing");

function normalizeBaseURL(baseURL) {
  if (!baseURL) {
    return "";
  }

  return baseURL.endsWith("/v1") ? baseURL : `${baseURL.replace(/\/$/, "")}/v1`;
}

function createSumoPodClient() {
  const apiKey = process.env.SUMO_API_KEY || "";
  const baseURL = normalizeBaseURL(process.env.SUMO_BASE_URL || "");
  const model = process.env.SUMO_MODEL || "";

  if (!apiKey || !baseURL || !model) {
    const error = new Error("SUMO_API_KEY, SUMO_BASE_URL, dan SUMO_MODEL harus diisi");
    error.status = 400;
    error.details = {
      requiredEnv: ["SUMO_API_KEY", "SUMO_BASE_URL", "SUMO_MODEL"],
    };
    throw error;
  }

  return new OpenAI({
    apiKey,
    baseURL,
  });
}

async function generateChatCompletion({
  messages,
  maxTokens = 10000,
  temperature = 0.3,
}) {
  const openai = createSumoPodClient();
  const model = process.env.SUMO_MODEL;

  const response = await openai.chat.completions.create({
    model,
    messages,
    max_tokens: Math.min(Math.max(1, Number(maxTokens) || 1200), MAX_AI_OUTPUT_TOKENS),
    temperature,
  });

  return {
    model: response.model,
    content: response.choices?.[0]?.message?.content || "",
    raw: response,
  };
}

function getSumoPodConfigStatus() {
  const apiKey = process.env.SUMO_API_KEY || "";
  const baseURL = process.env.SUMO_BASE_URL || "";
  const model = process.env.SUMO_MODEL || "";

  return {
    configured: Boolean(apiKey && baseURL && model),
    hasApiKey: Boolean(apiKey),
    hasBaseUrl: Boolean(baseURL),
    baseURL: normalizeBaseURL(baseURL),
    model,
  };
}

module.exports = {
  generateChatCompletion,
  getSumoPodConfigStatus,
};
