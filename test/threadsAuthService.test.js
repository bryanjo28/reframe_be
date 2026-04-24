const assert = require("node:assert/strict");
const crypto = require("crypto");

require("dotenv").config();

const threadsAuthService = require("../src/services/threadsAuthService");

function run(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

async function main() {
  await run("createAuthorizationRequest returns a connect URL with state", () => {
    const result = threadsAuthService.createAuthorizationRequest({
      userId: crypto.randomUUID(),
    });

    assert.ok(result.state);
    assert.ok(result.authorizationUrl.includes("https://threads.net/oauth/authorize?"));
    assert.ok(result.authorizationUrl.includes(`state=${result.state}`));
  });

  await run("handleCallback resolves state and stores token", async () => {
    const userId = crypto.randomUUID();
    const connect = threadsAuthService.createAuthorizationRequest({ userId });

    const result = await threadsAuthService.handleCallback({
      code: "test_code_123",
      state: connect.state,
    });

    assert.equal(result.userId, userId);
    assert.equal(result.provider, "threads");
    assert.equal(result.accessTokenStored, true);
    assert.ok(result.tokenRecord);
    assert.equal(result.tokenRecord.userId, userId);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
