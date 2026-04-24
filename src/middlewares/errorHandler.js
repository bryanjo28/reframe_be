function errorHandler(err, req, res, next) {
  console.error(err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    details: err.details?.message || undefined,
  });
}

module.exports = errorHandler;
