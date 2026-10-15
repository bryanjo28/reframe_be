const crypto = require("crypto");
const {
  AI_PRICING_USD_PER_MILLION,
  MAX_AI_CREDITS_PER_REQUEST,
  MAX_AI_OUTPUT_TOKENS,
  TOKENS_PER_CREDIT,
  USD_TO_IDR_RATE,
} = require("../config/billing");
const { supabaseAdmin } = require("../config/supabase");

function httpError(message, status = 500, code, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeProviderUsage(usage, fallback = {}) {
  const inputTokens = number(usage?.prompt_tokens ?? usage?.input_tokens);
  const outputTokens = number(usage?.completion_tokens ?? usage?.output_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? usage?.cached_input_tokens)
  );
  const providerTotal = number(usage?.total_tokens);
  const totalTokens = providerTotal || inputTokens + outputTokens || number(fallback.totalTokens);
  return {
    inputTokens: inputTokens || number(fallback.inputTokens),
    cachedInputTokens,
    outputTokens: outputTokens || number(fallback.outputTokens),
    totalTokens,
    isEstimated: !providerTotal && inputTokens + outputTokens === 0,
  };
}

function creditsForTokens(totalTokens) {
  const tokens = number(totalTokens);
  return tokens > 0 ? Math.ceil(tokens / TOKENS_PER_CREDIT) : 0;
}

function calculateCosts(usage) {
  const normalized = normalizeProviderUsage(usage);
  const uncachedInput = Math.max(0, normalized.inputTokens - normalized.cachedInputTokens);
  const actualCostUsd = (
    uncachedInput * AI_PRICING_USD_PER_MILLION.input +
    normalized.cachedInputTokens * AI_PRICING_USD_PER_MILLION.cachedInput +
    normalized.outputTokens * AI_PRICING_USD_PER_MILLION.output
  ) / 1_000_000;
  const estimatedCostIdr = Math.round((actualCostUsd * USD_TO_IDR_RATE + Number.EPSILON) * 100) / 100;
  return {
    actualCostUsd,
    estimatedCostIdr,
  };
}

function estimateReservation({ messages = [], maxTokens = 1200 }) {
  const characters = messages.reduce((sum, item) => sum + String(item?.content || "").length, 0);
  // One token per character is deliberately conservative for reservation safety,
  // including emoji and non-Latin input where char/token ratios vary widely.
  const estimatedInputTokens = characters;
  const cappedOutputTokens = Math.min(number(maxTokens) || 1200, MAX_AI_OUTPUT_TOKENS);
  const estimatedTotalTokens = estimatedInputTokens + cappedOutputTokens;
  const credits = Math.max(1, creditsForTokens(estimatedTotalTokens));
  if (credits > MAX_AI_CREDITS_PER_REQUEST) {
    throw httpError("Permintaan AI melebihi batas biaya per request.", 400, "AI_REQUEST_LIMIT_EXCEEDED");
  }
  return { credits, estimatedInputTokens, maxOutputTokens: cappedOutputTokens, estimatedTotalTokens };
}

function mapRpcError(error) {
  if (/insufficient|tidak cukup/i.test(error?.message || "")) {
    return httpError(
      "AI Credits kamu tidak cukup untuk melakukan generate. Top up credits atau upgrade paket untuk melanjutkan.",
      402,
      "INSUFFICIENT_AI_CREDITS"
    );
  }
  return httpError(error?.message || "Credit transaction failed", 500, "AI_CREDIT_TRANSACTION_FAILED", error);
}

async function reserveCredits({ userId, feature, messages, maxTokens, requestId = crypto.randomUUID(), db = supabaseAdmin }) {
  if (!db?.rpc) throw httpError("AI credit storage belum dikonfigurasi.", 503, "AI_CREDIT_STORAGE_UNAVAILABLE");
  const estimate = estimateReservation({ messages, maxTokens });
  const { data, error } = await db.rpc("reserve_ai_credits", {
    p_user_id: userId,
    p_request_id: requestId,
    p_feature: feature,
    p_credits: estimate.credits,
  });
  if (error) throw mapRpcError(error);
  return { requestId, ...estimate, ...(data || {}) };
}

async function settleCredits({ userId, requestId, feature, model, usage, fallbackUsage, status = "success", db = supabaseAdmin }) {
  const normalized = normalizeProviderUsage(usage, fallbackUsage);
  const credits = Math.max(normalized.totalTokens > 0 ? 1 : 0, creditsForTokens(normalized.totalTokens));
  const costs = calculateCosts({
    input_tokens: normalized.inputTokens,
    cached_input_tokens: normalized.cachedInputTokens,
    output_tokens: normalized.outputTokens,
    total_tokens: normalized.totalTokens,
  });
  const { data, error } = await db.rpc("settle_ai_credits", {
    p_user_id: userId,
    p_request_id: requestId,
    p_feature: feature,
    p_model: model || "unknown",
    p_input_tokens: normalized.inputTokens,
    p_cached_input_tokens: normalized.cachedInputTokens,
    p_output_tokens: normalized.outputTokens,
    p_total_tokens: normalized.totalTokens,
    p_estimated_cost_idr: costs.estimatedCostIdr,
    p_actual_cost_usd: costs.actualCostUsd,
    p_credits_charged: credits,
    p_usage_status: normalized.isEstimated ? "estimated" : status,
  });
  if (error) throw mapRpcError(error);
  return { ...(data || {}), usage: normalized, creditsUsed: credits, ...costs };
}

async function releaseReservation({ userId, requestId, reason = "provider_failed_before_usage", db = supabaseAdmin }) {
  const { data, error } = await db.rpc("release_ai_credit_reservation", {
    p_user_id: userId,
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw mapRpcError(error);
  return data;
}

module.exports = { calculateCosts, creditsForTokens, estimateReservation, normalizeProviderUsage, releaseReservation, reserveCredits, settleCredits };
