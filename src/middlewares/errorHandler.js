const { recordServerError, redactMessage } = require("../services/adminErrorLogService");

async function errorHandler(err, req, res, next) {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error_code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large.",
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && Object.hasOwn(err, "body")) {
    return res.status(400).json({
      success: false,
      error_code: "INVALID_JSON",
      message: "Request body contains invalid JSON.",
    });
  }

  const statusCode = err.status || 500;
  if (statusCode >= 500) {
    const errorCode = /^[A-Za-z0-9_.:-]{1,100}$/.test(String(err.code || ""))
      ? err.code
      : "INTERNAL_SERVER_ERROR";
    const errorName = String(err.name || "Error").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "Error";
    const message = redactMessage(err.message);
    const requestId = req.requestId || require("node:crypto").randomUUID();

    console.error("[api-error]", { requestId, method: req.method, path: req.path, statusCode, errorCode, errorName, message });
    await recordServerError({
      requestId,
      userId: req.user?.id,
      method: req.method,
      path: req.path,
      statusCode,
      errorCode,
      errorName,
      message,
    });
  }

  return res.status(err.status || 500).json({
    success: false,
    ...(err.code ? { error_code: err.code } : {}),
    ...(req.requestId ? { request_id: req.requestId } : {}),
    message: err.message || "Internal server error",
  });
}

module.exports = errorHandler;
