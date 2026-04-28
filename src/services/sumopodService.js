const { OpenAI } = require("openai");

function normalizeBaseURL(baseURL) {
  if (!baseURL) {
    return "";
  }

  return baseURL.endsWith("/v1") ? baseURL : `${baseURL.replace(/\/$/, "")}/v1`;
}

function createSumoPodClient() {
  const apiKey = process.env.SUMO_API_KEY || "";
  const baseURL = normalizeBaseURL(process.env.SUMO_BASE_URL || "");

  if (!apiKey || !baseURL) {
    const error = new Error("SUMO_API_KEY dan SUMO_BASE_URL harus diisi");
    error.status = 400;
    error.details = {
      requiredEnv: ["SUMO_API_KEY", "SUMO_BASE_URL"],
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
  model = "gpt-4o-mini",
  maxTokens = 150,
  temperature = 0.5,
}) {
  const openai = createSumoPodClient();

  const response = await openai.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  return {
    model: response.model,
    content: response.choices?.[0]?.message?.content || "",
    raw: response,
  };
}

async function testChatCompletion({
  prompt = "Say hello in a creative way",
  model = "gemini-2.5-flash-lite",
  maxTokens = 150,
  temperature = 0.5,
  systemPrompt = "You are a helpful assistant that answers clearly and concisely in Bahasa Indonesia.",
}) {
  return generateChatCompletion({
    model,
    maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });
}

function getSumoPodConfigStatus() {
  const apiKey = process.env.SUMO_API_KEY || "";
  const baseURL = process.env.SUMO_BASE_URL || "";

  return {
    configured: Boolean(apiKey && baseURL),
    hasApiKey: Boolean(apiKey),
    hasBaseUrl: Boolean(baseURL),
    baseURL: normalizeBaseURL(baseURL),
  };
}

module.exports = {
  generateChatCompletion,
  getSumoPodConfigStatus,
  testChatCompletion,
};
