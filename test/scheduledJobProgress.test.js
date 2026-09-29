const assert = require("node:assert/strict");

require("dotenv").config();

const {
  buildScheduledJobProgress,
  getScheduledJobById,
} = require("../src/services/scheduledJobsService");
const {
  buildScheduledAutoGenerateResponse,
} = require("../src/controllers/contentOutputsController");

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

function createProgressDatabase({ job, run: latestRun }) {
  return {
    from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          if (table === "scheduled_jobs") {
            assert.deepEqual(filters, [["id", job.id], ["user_id", job.user_id]]);
            return { data: job, error: null };
          }

          assert.equal(table, "scheduled_job_runs");
          assert.deepEqual(filters, [
            ["scheduled_job_id", job.id],
            ["user_id", job.user_id],
          ]);
          return { data: latestRun, error: null };
        },
      };
    },
  };
}

run("scheduled job progress calculates a bounded percentage", () => {
  assert.deepEqual(
    buildScheduledJobProgress({
      status: "running",
      target_count: 5,
      fetched_count: 5,
      processed_count: 2,
      success_count: 1,
      failed_count: 1,
      started_at: "2026-09-29T10:00:00.000Z",
      finished_at: null,
    }),
    {
      status: "running",
      targetCount: 5,
      fetchedCount: 5,
      processedCount: 2,
      successCount: 1,
      failedCount: 1,
      percentage: 40,
      startedAt: "2026-09-29T10:00:00.000Z",
      finishedAt: null,
    }
  );
});

run("scheduled content generation response exposes its job id", () => {
  assert.deepEqual(
    buildScheduledAutoGenerateResponse({
      scheduledJob: { id: "job-1", status: "active" },
      summary: { targetCount: 5 },
    }),
    {
      success: true,
      contents: [],
      data: {
        id: "job-1",
        scheduledJob: { id: "job-1", status: "active" },
        summary: { targetCount: 5 },
      },
    }
  );
});

run("get scheduled job includes progress from its latest run", async () => {
  const job = {
    id: "job-1",
    user_id: "user-1",
    persona_config_id: "persona-1",
    job_type: "content_auto_generate",
    target_count: 5,
    status: "active",
  };
  const latestRun = {
    status: "running",
    target_count: 5,
    fetched_count: 5,
    processed_count: 3,
    success_count: 3,
    failed_count: 0,
    started_at: "2026-09-29T10:00:00.000Z",
    finished_at: null,
  };

  const result = await getScheduledJobById({
    supabase: createProgressDatabase({ job, run: latestRun }),
    userId: "user-1",
    id: "job-1",
  });

  assert.equal(result.status, "active");
  assert.deepEqual(result.progress, {
    status: "running",
    targetCount: 5,
    fetchedCount: 5,
    processedCount: 3,
    successCount: 3,
    failedCount: 0,
    percentage: 60,
    startedAt: "2026-09-29T10:00:00.000Z",
    finishedAt: null,
  });
});
