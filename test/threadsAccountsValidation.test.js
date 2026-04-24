const assert = require("node:assert/strict");

const {
  normalizeThreadsAccountPayload,
} = require("../src/services/threadsAccountsService");
const {
  validateThreadsAccountRequest,
} = require("../src/middlewares/threadsAccountsValidationMiddleware");

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

run("normalizeThreadsAccountPayload maps manual token fields", () => {
  const payload = normalizeThreadsAccountPayload({
    access_token: "token-123",
    account_id: "steven_osena",
    threads_id: "1789",
    expires_at: "2026-01-01T00:00:00Z",
  });

  assert.equal(payload.accessToken, "token-123");
  assert.equal(payload.accountId, "steven_osena");
  assert.equal(payload.threadsId, "1789");
  assert.equal(payload.expiresAt, "2026-01-01T00:00:00Z");
});

run("validateThreadsAccountRequest rejects missing accessToken", () => {
  const req = {
    body: {
      accountId: "steven_osena",
      threadsId: "1789",
    },
  };

  let receivedError = null;
  validateThreadsAccountRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.message, "Missing required field: accessToken");
});
