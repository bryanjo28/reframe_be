const assert = require("node:assert/strict");

const {
  assertRequiredAuthFields,
  normalizeAuthPayload,
} = require("../src/services/authService");
const {
  validateLoginRequest,
  validateRegisterRequest,
  validateRegistrationEnabled,
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
      password: "  Secret123  ",
      account_name: "  alpha  ",
      full_name: "  Alpha User  ",
      acceptedTermsVersion: "2026-10-20",
      acceptedPrivacyNoticeVersion: "2026-10-20",
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
    password: "  Secret123  ",
    accountName: "alpha",
    fullName: "Alpha User",
    acceptedTermsVersion: "2026-10-20",
    acceptedPrivacyNoticeVersion: "2026-10-20",
    referralToken: "",
  });
});

run("validateRegisterRequest rejects disposable email domains", () => {
  const req = {
    body: {
      email: "user@mailinator.com",
      password: "secret123",
      accountName: "alpha",
    },
  };
  let receivedError = null;

  validateRegisterRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.status, 400);
  assert.equal(receivedError.code, "DISPOSABLE_EMAIL_NOT_ALLOWED");
});

run("validateRegisterRequest allows permanent Yahoo email", () => {
  const req = {
    body: {
      email: "user@yahoo.com",
      password: "Secret123",
      accountName: "alpha",
      acceptedTermsVersion: "2026-10-20",
      acceptedPrivacyNoticeVersion: "2026-10-20",
    },
  };
  let receivedError = null;

  validateRegisterRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.equal(receivedError, undefined);
  assert.equal(req.authInput.email, "user@yahoo.com");
});

for (const [description, password] of [
  ["fewer than 8 characters", "Sec123"],
  ["no uppercase letter", "secret123"],
  ["no lowercase letter", "SECRET123"],
  ["no number", "SecretPass"],
]) {
  run(`validateRegisterRequest rejects a password with ${description}`, () => {
    const req = {
      body: {
        email: "user@example.com",
        password,
        accountName: "alpha",
      },
    };
    let receivedError = null;

    validateRegisterRequest(req, {}, (error) => {
      receivedError = error;
    });

    assert.ok(receivedError);
    assert.equal(receivedError.status, 400);
    assert.equal(receivedError.code, "WEAK_PASSWORD");
    assert.equal(
      receivedError.message,
      "Password must be at least 8 characters and include uppercase, lowercase, and number"
    );
  });
}

run("validateRegisterRequest accepts a password meeting every requirement", () => {
  const req = {
    body: {
      email: "user@example.com",
      password: "Secret123",
      accountName: "alpha",
      acceptedTermsVersion: "2026-10-20",
      acceptedPrivacyNoticeVersion: "2026-10-20",
    },
  };
  let receivedError = null;

  validateRegisterRequest(req, {}, (error) => {
    receivedError = error;
  });

  assert.equal(receivedError, undefined);
  assert.equal(req.authInput.password, "Secret123");
});

run("validateRegisterRequest rejects domains configured through env", () => {
  const previousValue = process.env.BLOCKED_EMAIL_DOMAINS;
  process.env.BLOCKED_EMAIL_DOMAINS = "blocked.example";
  const req = {
    body: {
      email: "user@sub.blocked.example",
      password: "secret123",
      accountName: "alpha",
    },
  };
  let receivedError = null;

  try {
    validateRegisterRequest(req, {}, (error) => {
      receivedError = error;
    });
  } finally {
    if (previousValue === undefined) delete process.env.BLOCKED_EMAIL_DOMAINS;
    else process.env.BLOCKED_EMAIL_DOMAINS = previousValue;
  }

  assert.ok(receivedError);
  assert.equal(receivedError.code, "DISPOSABLE_EMAIL_NOT_ALLOWED");
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
  assert.equal(receivedError.code, "VALIDATION_ERROR");
  assert.equal(receivedError.message, "Missing required fields: email, password");
});

run("validateRegistrationEnabled returns the standard disabled response", () => {
  const previousValue = process.env.AUTH_ENABLE_REGISTRATION;
  process.env.AUTH_ENABLE_REGISTRATION = "false";

  let statusCode = null;
  let responseBody = null;
  const response = {
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };

  try {
    validateRegistrationEnabled({}, response, () => {
      throw new Error("next must not be called");
    });
  } finally {
    if (previousValue === undefined) {
      delete process.env.AUTH_ENABLE_REGISTRATION;
    } else {
      process.env.AUTH_ENABLE_REGISTRATION = previousValue;
    }
  }

  assert.equal(statusCode, 403);
  assert.deepEqual(responseBody, {
    success: false,
    error_code: "REGISTRATION_DISABLED",
    message: "Registration is disabled",
  });
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
