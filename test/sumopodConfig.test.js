const assert = require("node:assert/strict");

const { getSumoPodConfigStatus } = require("../src/services/sumopodService");

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

run("SumoPod model is configured centrally from SUMO_MODEL", () => {
  const previousModel = process.env.SUMO_MODEL;
  process.env.SUMO_MODEL = "central-test-model";

  try {
    const config = getSumoPodConfigStatus();
    assert.equal(config.model, "central-test-model");
  } finally {
    if (previousModel === undefined) {
      delete process.env.SUMO_MODEL;
    } else {
      process.env.SUMO_MODEL = previousModel;
    }
  }
});

run("SumoPod configuration is incomplete when SUMO_MODEL is missing", () => {
  const previousApiKey = process.env.SUMO_API_KEY;
  const previousBaseUrl = process.env.SUMO_BASE_URL;
  const previousModel = process.env.SUMO_MODEL;
  process.env.SUMO_API_KEY = "test-key";
  process.env.SUMO_BASE_URL = "https://example.com";
  delete process.env.SUMO_MODEL;

  try {
    const config = getSumoPodConfigStatus();
    assert.equal(config.configured, false);
    assert.equal(config.model, "");
  } finally {
    if (previousApiKey === undefined) delete process.env.SUMO_API_KEY;
    else process.env.SUMO_API_KEY = previousApiKey;
    if (previousBaseUrl === undefined) delete process.env.SUMO_BASE_URL;
    else process.env.SUMO_BASE_URL = previousBaseUrl;
    if (previousModel === undefined) delete process.env.SUMO_MODEL;
    else process.env.SUMO_MODEL = previousModel;
  }
});

