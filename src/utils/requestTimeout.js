// Includes reading the response body, not only waiting for response headers.
async function withRequestTimeout(operation, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await operation(controller.signal);
    // Some response parsers catch body-read errors; a timed-out request still fails.
    if (controller.signal.aborted) throw new Error("Request aborted");
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("External service request timed out"), {
        status: 504,
        code: "EXTERNAL_REQUEST_TIMEOUT",
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { withRequestTimeout };
