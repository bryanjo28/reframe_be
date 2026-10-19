const assert = require("node:assert/strict");

const {
  isCronJobEnabled,
  runDueScheduledJobs,
  startCronJobs,
} = require("../src/services/cronService");

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

run("cron is enabled only by an explicit true value", () => {
  assert.equal(isCronJobEnabled("TRUE"), true);
  assert.equal(isCronJobEnabled("true"), true);
  assert.equal(isCronJobEnabled(" true "), true);
  assert.equal(isCronJobEnabled("FALSE"), false);
  assert.equal(isCronJobEnabled("1"), false);
  assert.equal(isCronJobEnabled("yes"), false);
  assert.equal(isCronJobEnabled(""), false);
  assert.equal(isCronJobEnabled(null), false);
});

run("disabled cron does not register a scheduled task", () => {
  let scheduleCalls = 0;
  const task = startCronJobs({
    enabled: false,
    schedule() {
      scheduleCalls += 1;
    },
  });

  assert.equal(scheduleCalls, 0);
  assert.equal(task, null);
});

run("enabled cron registers the minute scheduler", () => {
  const scheduledTask = { stop() {} };
  let receivedExpression = null;
  let receivedHandler = null;

  const task = startCronJobs({
    enabled: true,
    schedule(expression, handler) {
      receivedExpression = expression;
      receivedHandler = handler;
      return scheduledTask;
    },
  });

  assert.equal(receivedExpression, "* * * * *");
  assert.equal(typeof receivedHandler, "function");
  assert.equal(task, scheduledTask);
});

run("content generation cron skips a job already claimed by another worker", async () => {
  let claimCalls = 0;
  let generationCalls = 0;
  const dueJob = {
    id: "job-1",
    user_id: "user-1",
    job_type: "content_auto_generate",
    config: { contentPillarId: "pillar-1", topicIds: ["topic-1"] },
    target_count: 1,
    schedule_value: "2026-10-08T08:00:00.000Z",
  };
  const query = {
    select() { return this; },
    eq() { return this; },
    lte() { return Promise.resolve({ data: [dueJob], error: null }); },
  };
  const supabase = {
    from(table) {
      assert.equal(table, "scheduled_jobs");
      return query;
    },
  };

  await runDueScheduledJobs({
    isConfigured: true,
    supabase,
    reconcileSubscriptions: async () => {},
    reconcilePayments: async () => {},
    claimContentGenerationJob: async () => {
      claimCalls += 1;
      return null;
    },
    generateContentOutputs: async () => {
      generationCalls += 1;
    },
  });

  assert.equal(claimCalls, 1);
  assert.equal(generationCalls, 0);
});
