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

run("validateAutoPostThreadsRequest accepts empty body", () => {
  const req = { body: {} };
  let nextCalled = false;
  validateAutoPostThreadsRequest(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.threadsAutoPostInput, {
    contentOutputId: undefined,
    limit: undefined,
  });
});
