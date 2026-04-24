const assert = require("node:assert/strict");

const {
  normalizeContentPillarPayload,
} = require("../src/services/contentPillarsService");
const {
  validateCreateContentPillarRequest,
  validateEnhanceContentPillarRequest,
  validateUpdateContentPillarRequest,
  validateContentPillarIdParam,
} = require("../src/middlewares/contentPillarsValidationMiddleware");

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

run("normalizeContentPillarPayload maps schema fields", () => {
  const payload = normalizeContentPillarPayload({
    persona_config_id: "persona-id",
    name: "  Growth ",
    template_content: "  Template  ",
    is_active: "false",
    sort_order: "3",
  });

  assert.equal(payload.personaConfigId, "persona-id");
  assert.equal(payload.pillarName, "Growth");
  assert.equal(payload.templateContent, "Template");
  assert.equal(payload.isActive, false);
  assert.equal(payload.sortOrder, 3);
});

run("validateEnhanceContentPillarRequest accepts FE payload shape", () => {
  const req = {
    body: {
      personaConfigId: "persona-id",
      name: "Growth",
      templateContent: "Template",
      targetObjective: "Objective",
      audienceSegment: "Audience",
      keyMessage: "Key message",
      ctaDirection: "CTA",
      affiliateLink: "https://example.com",
    },
  };
  let receivedError = null;

  validateEnhanceContentPillarRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.equal(receivedError, undefined);
  assert.equal(req.contentPillarInput.pillarName, "Growth");
  assert.equal(req.contentPillarInput.personaConfigId, "persona-id");
});

run("normalizeContentPillarPayload keeps null for explicit empty booleans", () => {
  const payload = normalizeContentPillarPayload({
    personaConfigId: "persona-id",
    pillarName: "Growth",
    isActive: null,
    sortOrder: null,
  });

  assert.equal(payload.isActive, null);
  assert.equal(payload.sortOrder, null);
});

run("validateCreateContentPillarRequest rejects empty pillarName", () => {
  const req = { body: { personaConfigId: "persona-id", pillarName: "   " } };
  let receivedError = null;

  validateCreateContentPillarRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.message, "Missing required field: pillarName");
});

run("validateContentPillarIdParam rejects invalid uuid", () => {
  const req = { params: { id: "not-a-uuid" } };
  let receivedError = null;

  validateContentPillarIdParam(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.message, "Invalid content pillar id");
});

run("validateUpdateContentPillarRequest rejects empty name when provided", () => {
  const req = { body: { name: "   " } };
  let receivedError = null;

  validateUpdateContentPillarRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.message, "Missing required field: name");
});
