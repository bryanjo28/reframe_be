const { isSupabaseAdminConfigured, supabaseAdmin } = require("../../config/supabase");

function redactMessage(value) {
  return String(value || "Internal server error")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[JWT REDACTED]")
    .replace(/\b(?:sk|rk|sb_secret|sb_publishable|sk_live|sk_test)[-_a-zA-Z0-9]{8,}\b/gi, "[KEY REDACTED]")
    .replace(/\b(password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

function safeCode(value) {
  const code = String(value || "INTERNAL_SERVER_ERROR");
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : "INTERNAL_SERVER_ERROR";
}

function safePath(value) {
  return redactMessage(String(value || "/").split("?")[0]).slice(0, 500);
}

async function recordServerError({ requestId, userId, method, path, statusCode, errorCode, errorName, message }) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) return;

  try {
    const { error } = await supabaseAdmin.from("admin_error_logs").insert({
      request_id: requestId,
      user_id: userId || null,
      method: String(method || "UNKNOWN").slice(0, 16),
      path: safePath(path),
      status_code: Math.min(599, Math.max(500, Number(statusCode) || 500)),
      error_code: safeCode(errorCode),
      error_name: String(errorName || "Error").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "Error",
      message: redactMessage(message),
    });

    if (error) console.error(`[error-log] persistence failed code=${safeCode(error.code)}`);
  } catch (error) {
    console.error(`[error-log] persistence failed code=${safeCode(error?.code)}`);
  }
}

module.exports = { recordServerError, redactMessage };
