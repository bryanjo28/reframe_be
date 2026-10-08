const assert = require("node:assert/strict");

const {
  buildAutoGenerationOutcome,
} = require("../src/services/contentOutputsService");

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

run("auto generation outcome reports a successful run without an error", () => {
  assert.deepEqual(
    buildAutoGenerationOutcome({
      successCount: 1,
      failedCount: 0,
      results: [{ status: "success", topicId: "topic-1" }],
    }),
    {
      success: true,
      status: "completed",
      errorMessage: null,
      errors: [],
    }
  );
});

run("auto generation outcome exposes the original generation error", () => {
  assert.deepEqual(
    buildAutoGenerationOutcome({
      successCount: 0,
      failedCount: 1,
      results: [
        {
          status: "failed",
          topicId: "topic-1",
          error: "Daily generation limit exceeded",
        },
      ],
    }),
    {
      success: false,
      status: "completed_with_errors",
      errorMessage: "Daily generation limit exceeded",
      errors: ["Daily generation limit exceeded"],
    }
  );
});

