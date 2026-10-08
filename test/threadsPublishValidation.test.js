const assert = require("assert");

const {
  normalizeAutoPostThreadsPayload,
  validateAutoPostThreadsRequest,
  validateRescheduleContentRequest,
  validateScheduledContentParam,
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

run("validateScheduledContentParam accepts an individual content UUID", () => {
  const req = { params: { contentOutputId: "123e4567-e89b-42d3-a456-426614174000" } };
  let error;

  validateScheduledContentParam(req, {}, (value) => { error = value; });

  assert.equal(error, undefined);
});

run("validateRescheduleContentRequest normalizes scheduledAt", () => {
  const req = { body: { scheduled_at: "2026-10-12T11:00:00.000Z" } };
  let error;

  validateRescheduleContentRequest(req, {}, (value) => { error = value; });

  assert.equal(error, undefined);
  assert.deepEqual(req.threadsRescheduleInput, { scheduledAt: "2026-10-12T11:00:00.000Z" });
});
