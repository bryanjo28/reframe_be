const assert = require("assert");

const {
  normalizeAutoPostThreadsPayload,
  validateAutoPostThreadsRequest,
} = require("../src/middlewares/threadsPublishValidationMiddleware");

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

run("normalizeAutoPostThreadsPayload maps camelCase and snake_case", () => {
  const payload = normalizeAutoPostThreadsPayload({
    content_output_id: "uuid-123",
    limit: "5",
  });

  assert.equal(payload.contentOutputId, "uuid-123");
  assert.equal(payload.limit, 5);
});

run("validateAutoPostThreadsRequest rejects missing scheduledAt", () => {
  const req = { body: {} };
  let errorMessage = "";

  validateAutoPostThreadsRequest(req, {}, (error) => {
    errorMessage = error.message;
  });

  assert.equal(errorMessage, "Missing required field: scheduledAt");
});
