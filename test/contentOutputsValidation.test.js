const assert = require("assert");

const {
  validateAutoGenerateContentOutputsRequest,
  validateGenerateContentOutputRequest,
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
      threadType: "long",
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
      threadType: "short",
    },
  };
  let errorMessage = "";

  validateScheduleAutoGenerateContentOutputsRequest(req, {}, (error) => {
    errorMessage = error.message;
  });

  assert.equal(errorMessage, "Missing required field: scheduledAt");
});

run("validateGenerateContentOutputRequest accepts 1-5 variants for one topic", () => {
  const req = {
    body: {
      topicId: "topic-123",
      variantCount: 5,
      threadType: "long",
      additionalPrompt: "Gunakan sudut pandang founder",
    },
  };
  let nextError;

  validateGenerateContentOutputRequest(req, {}, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.equal(req.contentOutputInput.variantCount, 5);
  assert.equal(req.contentOutputInput.threadType, "long");
  assert.equal(req.contentOutputInput.additionalPrompt, "Gunakan sudut pandang founder");
});

run("validateGenerateContentOutputRequest rejects more than 5 variants", () => {
  const req = { body: { topicId: "topic-123", variantCount: 6, threadType: "short" } };
  let errorMessage = "";

  validateGenerateContentOutputRequest(req, {}, (error) => {
    errorMessage = error.message;
  });

  assert.equal(errorMessage, "variantCount must be between 1 and 5");
});

run("validateGenerateContentOutputRequest requires threadType", () => {
  const req = { body: { topicId: "topic-123", variantCount: 1 } };
  let errorMessage = "";

  validateGenerateContentOutputRequest(req, {}, (error) => {
    errorMessage = error.message;
  });

  assert.equal(errorMessage, "Missing required field: threadType");
});

run("validateGenerateContentOutputRequest rejects invalid threadType", () => {
  const req = { body: { topicId: "topic-123", threadType: "medium" } };
  let errorMessage = "";

  validateGenerateContentOutputRequest(req, {}, (error) => {
    errorMessage = error.message;
  });

  assert.equal(errorMessage, "threadType must be either short or long");
});

run("validateScheduleAutoGenerateContentOutputsRequest requires threadType", () => {
  const req = {
    body: {
      contentPillarId: "pillar-123",
      targetCount: 10,
      scheduledAt: "2026-12-01T00:00:00.000Z",
    },
  };
  let errorMessage = "";

  validateScheduleAutoGenerateContentOutputsRequest(req, {}, (error) => {
    errorMessage = error?.message || "";
  });

  assert.equal(errorMessage, "Missing required field: threadType");
});
