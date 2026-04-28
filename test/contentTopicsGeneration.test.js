const assert = require("node:assert/strict");

const {
  normalizeGenerateContentTopicsPayload,
} = require("../src/services/contentTopicsGenerationService");
const {
  validateGenerateContentTopicsRequest,
} = require("../src/middlewares/contentTopicsValidationMiddleware");

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

run("normalizeGenerateContentTopicsPayload supports snake_case fields", () => {
  const payload = normalizeGenerateContentTopicsPayload({
    content_pillar_id: "cp_123",
    template_id: "tmpl_123",
    template_text: "  Generate 10 topics  ",
    jumlah_topics: "5",
  });

  assert.deepEqual(payload, {
    contentPillarId: "cp_123",
    templateId: "tmpl_123",
    templateText: "Generate 10 topics",
    jumlahTopics: 5,
  });
});

run("validateGenerateContentTopicsRequest rejects jumlahTopics outside range", () => {
  const req = {
    body: {
      content_pillar_id: "cp_123",
      template_text: "Generate topic",
      jumlah_topics: 11,
    },
  };

  let receivedError = null;
  validateGenerateContentTopicsRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.message, "jumlahTopics must be between 1 and 10");
});
