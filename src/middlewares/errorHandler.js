function errorHandler(err, req, res, next) {
  console.error(err);

  const details =
    err.details === undefined || err.details === null
      ? undefined
      : typeof err.details === "string"
        ? err.details
        : err.details;

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    details,
  });
}

module.exports = errorHandler;
