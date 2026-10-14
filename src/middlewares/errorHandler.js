function errorHandler(err, req, res, next) {
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

  if (!err.status || err.status >= 500) console.error(err);

  return res.status(err.status || 500).json({
    success: false,
    ...(err.code ? { error_code: err.code } : {}),
    message: err.message || "Internal server error",
  });
}

module.exports = errorHandler;
