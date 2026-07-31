const assert = require("assert");

const {
  validateAutoGenerateContentOutputsRequest,
  validateScheduleAutoGenerateContentOutputsRequest,
} = require("../src/middlewares/contentOutputsValidationMiddleware");

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

run("validateAutoGenerateContentOutputsRequest accepts schedule-less generate payload", () => {
  const req = {
    body: {
      contentPillarId: "pillar-123",
      targetCount: 10,
    },
  };
  let nextCalled = false;

  validateAutoGenerateContentOutputsRequest(req, {}, (error) => {
    assert.equal(error, undefined);
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.contentOutputAutoGenerateInput.contentPillarId, "pillar-123");
  assert.equal(req.contentOutputAutoGenerateInput.targetCount, 10);
});

run("validateScheduleAutoGenerateContentOutputsRequest rejects missing scheduledAt", () => {
  const req = {
    body: {
      contentPillarId: "pillar-123",
      targetCount: 10,
    },
  };
  let errorMessage = "";

  validateScheduleAutoGenerateContentOutputsRequest(req, {}, (error) => {
    errorMessage = error.message;
  });

  assert.equal(errorMessage, "Missing required field: scheduledAt");
});
