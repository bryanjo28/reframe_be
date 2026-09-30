const assert = require("node:assert/strict");

const errorHandler = require("../src/middlewares/errorHandler");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("errorHandler exposes the API error contract", () => {
  const error = new Error("Daily generation limit exceeded");
  error.status = 429;
  error.code = "DAILY_GENERATION_LIMIT_EXCEEDED";

  let receivedStatus = null;
  let receivedBody = null;
  const response = {
    status(status) {
      receivedStatus = status;
      return this;
    },
    json(body) {
      receivedBody = body;
      return this;
    },
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    errorHandler(error, {}, response, () => {});
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(receivedStatus, 429);
  assert.deepEqual(receivedBody, {
    success: false,
    error_code: "DAILY_GENERATION_LIMIT_EXCEEDED",
    message: "Daily generation limit exceeded",
  });
});
