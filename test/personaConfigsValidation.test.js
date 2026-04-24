const assert = require("node:assert/strict");

const {
  normalizePersonaConfigPayload,
} = require("../src/services/personaConfigsService");
const {
  validateCreatePersonaConfigRequest,
  validatePersonaConfigIdParam,
} = require("../src/middlewares/personaConfigsValidationMiddleware");

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

run("normalizePersonaConfigPayload maps schema fields", () => {
  const payload = normalizePersonaConfigPayload({
    persona: "  Creator  ",
    target_audience: "  founders  ",
    niche_topic_focus: "  growth  ",
    platform: " Threads ",
    is_active: "false",
  });

  assert.equal(payload.persona, "Creator");
  assert.equal(payload.targetAudience, "founders");
  assert.equal(payload.nicheTopicFocus, "growth");
  assert.equal(payload.platform, "Threads");
  assert.equal(payload.isActive, false);
});

run("validateCreatePersonaConfigRequest rejects empty persona", () => {
  const req = { body: { persona: "   " } };
  let receivedError = null;

  validateCreatePersonaConfigRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.message, "Missing required field: persona");
});

run("validatePersonaConfigIdParam rejects invalid uuid", () => {
  const req = { params: { id: "not-a-uuid" } };
  let receivedError = null;

  validatePersonaConfigIdParam(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.message, "Invalid persona config id");
});
