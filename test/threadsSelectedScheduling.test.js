const assert = require("node:assert/strict");

const {
  scheduleSelectedContentOutputs,
} = require("../src/services/threadsPublishService");

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("scheduleSelectedContentOutputs creates one schedule per selected content", async () => {
  const calls = [];
  const scheduleContent = async (input) => {
    calls.push(input);
    return {
      scheduledJob: { id: `job-${input.contentOutputId}` },
      scheduledCount: 1,
      availableCount: 1,
      results: [{ id: input.contentOutputId, scheduledAt: input.scheduledAt }],
    };
  };

  const result = await scheduleSelectedContentOutputs({
    supabase: {},
    userId: "user-1",
    contentOutputIds: ["content-1", "content-2"],
    scheduledAt: "2026-10-12T11:00:00.000Z",
    scheduleContent,
  });

  assert.deepEqual(calls.map((call) => call.contentOutputId), ["content-1", "content-2"]);
  assert.deepEqual(calls.map((call) => call.limit), [1, 1]);
  assert.deepEqual(result.summary, {
    requestedCount: 2,
    scheduledCount: 2,
    failedCount: 0,
  });
  assert.deepEqual(result.results.map((item) => item.scheduledJobId), [
    "job-content-1",
    "job-content-2",
  ]);
});

run("scheduleSelectedContentOutputs reports one failed selection and continues", async () => {
  const scheduleContent = async ({ contentOutputId, scheduledAt }) => {
    if (contentOutputId === "content-1") {
      const error = new Error("Content output not eligible for scheduling");
      error.status = 404;
      throw error;
    }

    return {
      scheduledJob: { id: "job-content-2" },
      results: [{ id: contentOutputId, scheduledAt }],
    };
  };

  const result = await scheduleSelectedContentOutputs({
    supabase: {},
    userId: "user-1",
    contentOutputIds: ["content-1", "content-2"],
    scheduledAt: "2026-10-12T11:00:00.000Z",
    scheduleContent,
  });

  assert.deepEqual(result.summary, {
    requestedCount: 2,
    scheduledCount: 1,
    failedCount: 1,
  });
  assert.deepEqual(result.results.map((item) => item.status), ["failed", "scheduled"]);
  assert.equal(result.results[0].error, "Content output not eligible for scheduling");
});
