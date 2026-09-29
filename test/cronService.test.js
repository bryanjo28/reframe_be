const assert = require("node:assert/strict");

const {
  isCronJobEnabled,
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
