const assert = require("node:assert/strict");

const {
  normalizeContentTopicPayload,
} = require("../src/services/contentTopicsService");

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

run("topic-only updates keep omitted UUID fields undefined after repeated normalization", () => {
  const middlewareInput = normalizeContentTopicPayload({ topic: "test" });
  const serviceInput = normalizeContentTopicPayload(middlewareInput);

  assert.equal(serviceInput.topic, "test");
  assert.equal(serviceInput.personaConfigId, undefined);
  assert.equal(serviceInput.contentPillarId, undefined);
});
