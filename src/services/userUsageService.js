function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

function getUsageTimeZone() {
  return process.env.USER_USAGE_TIMEZONE || "Asia/Jakarta";
}

function getCurrentPeriodMonth(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: getUsageTimeZone(),
    year: "numeric",
    month: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  if (!year || !month) {
    throw createHttpError("Unable to resolve current usage period", 500);
  }

  return `${year}-${month}-01`;
}

function normalizeUsageAmount(usage) {
  if (!usage || typeof usage !== "object") {
    return 0;
  }

  const totalTokens = Number(usage.total_tokens);
  if (Number.isFinite(totalTokens) && totalTokens > 0) {
    return Math.floor(totalTokens);
  }

  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  const fallbackTotal =
    (Number.isFinite(promptTokens) ? promptTokens : 0) +
    (Number.isFinite(completionTokens) ? completionTokens : 0);

  return fallbackTotal > 0 ? Math.floor(fallbackTotal) : 0;
}

function mapUserUsageRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    periodMonth: row.period_month,
    aiCreditsUsed: row.ai_credits_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function recordUserAiUsage({ supabase, userId, usage, periodMonth, now = new Date() }) {
  if (!userId) {
    throw createHttpError("Missing required field: userId", 400);
  }

  if (!supabase) {
    throw createHttpError("Supabase client is required", 500);
  }

  const aiCreditsUsed = normalizeUsageAmount(usage);
  if (aiCreditsUsed <= 0) {
    return null;
  }

  const targetPeriodMonth = periodMonth || getCurrentPeriodMonth(now);

  const { data: existingRow, error: selectError } = await supabase
    .from("user_usage")
    .select("id, ai_credits_used")
    .eq("user_id", userId)
    .eq("period_month", targetPeriodMonth)
    .maybeSingle();

  if (selectError) {
    throw createHttpError(selectError.message, 400, selectError);
  }

  if (existingRow) {
    const nextTotal = (existingRow.ai_credits_used || 0) + aiCreditsUsed;
    const { data, error: updateError } = await supabase
      .from("user_usage")
      .update({
        ai_credits_used: nextTotal,
        updated_at: now.toISOString(),
      })
      .eq("id", existingRow.id)
      .select("*")
      .single();

    if (updateError) {
      throw createHttpError(updateError.message, 400, updateError);
    }

    return mapUserUsageRow(data);
  }

  const { data, error: insertError } = await supabase
    .from("user_usage")
    .insert({
      user_id: userId,
      period_month: targetPeriodMonth,
      ai_credits_used: aiCreditsUsed,
    })
    .select("*")
    .single();

  if (insertError) {
    throw createHttpError(insertError.message, 400, insertError);
  }

  return mapUserUsageRow(data);
}

module.exports = {
  getCurrentPeriodMonth,
  mapUserUsageRow,
  normalizeUsageAmount,
  recordUserAiUsage,
};
