const assert = require("node:assert/strict");

const {
  buildTopicGenerationPrompt,
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

run("buildTopicGenerationPrompt tells the model to avoid recent pillar topics", () => {
  const prompt = buildTopicGenerationPrompt({
    contentPillar: { pillarName: "Personal Branding" },
    personaConfig: { targetAudience: "Content creator pemula" },
    jumlahTopics: 3,
    recentTopics: [
      "Cara membangun personal branding",
      "Kesalahan pemula saat membuat konten",
    ],
  });

  assert.match(prompt, /1\. Cara membangun personal branding/);
  assert.match(prompt, /2\. Kesalahan pemula saat membuat konten/);
  assert.match(prompt, /termasuk dengan sinonim/i);
  assert.match(prompt, /berbeda secara substansi/i);
});

run("buildTopicGenerationPrompt handles pillars without previous topics", () => {
  const prompt = buildTopicGenerationPrompt({
    contentPillar: { pillarName: "Personal Branding" },
    personaConfig: {},
    jumlahTopics: 3,
  });

  assert.match(prompt, /Belum ada topik sebelumnya/);
});
