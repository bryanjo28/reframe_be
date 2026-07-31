const assert = require("assert");

const { validateCreateScheduledJobRequest } = require("../src/middlewares/scheduledJobsValidationMiddleware");
const { normalizeScheduledJobPayload } = require("../src/services/scheduledJobsService");

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

run("normalizeScheduledJobPayload maps camelCase and snake_case", () => {
  const payload = normalizeScheduledJobPayload({
    persona_config_id: "persona-123",
    schedule_type: "daily",
    schedule_value: "08:00",
    target_count: "5",
  });

  assert.equal(payload.personaConfigId, "persona-123");
  assert.equal(payload.scheduleType, "daily");
  assert.equal(payload.scheduleValue, "08:00");
  assert.equal(payload.targetCount, 5);
});

run("validateCreateScheduledJobRequest rejects missing required fields", () => {
  const req = { body: { personaConfigId: "persona-123" } };
  let errorMessage = "";

  validateCreateScheduledJobRequest(req, {}, (error) => {
    errorMessage = error.message;
  });

  assert.equal(errorMessage, "Missing required field: scheduleType");
});
