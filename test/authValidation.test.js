const assert = require("node:assert/strict");

const {
  assertRequiredAuthFields,
  normalizeAuthPayload,
} = require("../src/services/authService");
const {
  validateLoginRequest,
  validateRegisterRequest,
} = require("../src/middlewares/authValidationMiddleware");

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

run("normalizeAuthPayload supports snake_case and trims text fields", () => {
  const payload = normalizeAuthPayload({
    email: "  USER@Example.com  ",
    password: "  secret  ",
    account_name: "  alpha  ",
    full_name: "  Alpha User  ",
  });

  assert.equal(payload.email, "user@example.com");
  assert.equal(payload.password, "  secret  ");
  assert.equal(payload.accountName, "alpha");
  assert.equal(payload.fullName, "Alpha User");
});

run("assertRequiredAuthFields rejects blank strings", () => {
  assert.throws(
    () => {
      assertRequiredAuthFields(
        { email: "  ", password: "secret", accountName: "alpha" },
        ["email", "password", "accountName"]
      );
    },
    {
      message: "Missing required fields: email",
      status: 400,
    }
  );
});

run("validateRegisterRequest normalizes request body and allows snake_case input", () => {
  const req = {
    body: {
      email: "  Register@Example.com  ",
      password: "  secret  ",
      account_name: "  alpha  ",
      full_name: "  Alpha User  ",
    },
  };

  let nextCalled = false;
  validateRegisterRequest(req, {}, (error) => {
    assert.equal(error, undefined);
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.authInput, {
    email: "register@example.com",
    password: "  secret  ",
    accountName: "alpha",
    fullName: "Alpha User",
  });
});

run("validateLoginRequest rejects empty credentials", () => {
  const req = {
    body: {
      email: "   ",
      password: "   ",
    },
  };

  let receivedError = null;
  validateLoginRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.message, "Missing required fields: email, password");
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
