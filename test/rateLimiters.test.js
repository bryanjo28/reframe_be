const assert = require("node:assert/strict");
const express = require("express");
const {
  LIMITS,
  aiGenerationLimiter,
  loginLimiter,
  metaDeletionLimiter,
  resendVerificationLimiter,
} = require("../src/middlewares/rateLimiters");

async function withServer(configure, test) {
  const app = express();
  configure(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await test(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  assert.deepEqual(LIMITS.global, { windowMs: 15 * 60 * 1000, limit: 300 });
  assert.deepEqual(LIMITS.login, { windowMs: 15 * 60 * 1000, limit: 10 });
  assert.deepEqual(LIMITS.register, { windowMs: 60 * 60 * 1000, limit: 5 });
  assert.deepEqual(LIMITS.forgotPassword, { windowMs: 60 * 60 * 1000, limit: 5 });
  assert.deepEqual(LIMITS.resendVerification, { windowMs: 60 * 60 * 1000, limit: 5 });
  assert.deepEqual(LIMITS.aiGeneration, { windowMs: 15 * 60 * 1000, limit: 20 });
  assert.deepEqual(LIMITS.threadsPublish, { windowMs: 15 * 60 * 1000, limit: 20 });
  assert.deepEqual(LIMITS.metaDeletion, { windowMs: 60 * 60 * 1000, limit: 20 });

  await withServer((app) => {
    let controllerCalls = 0;
    app.post("/login", loginLimiter, (req, res) => res.json({ calls: ++controllerCalls }));
  }, async (baseUrl) => {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${baseUrl}/login`, { method: "POST" });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("ratelimit"));
      assert.ok(response.headers.get("ratelimit-policy"));
    }
    const blocked = await fetch(`${baseUrl}/login`, { method: "POST" });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), {
      success: false,
      error_code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests. Please try again later.",
    });
  });

  await withServer((app) => {
    app.use((req, res, next) => {
      req.user = { id: req.headers["x-test-user"] };
      next();
    });
    app.post("/generate", aiGenerationLimiter, (req, res) => res.sendStatus(200));
  }, async (baseUrl) => {
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await fetch(`${baseUrl}/generate`, { method: "POST", headers: { "x-test-user": "user-a" } })).status, 200);
    }
    assert.equal((await fetch(`${baseUrl}/generate`, { method: "POST", headers: { "x-test-user": "user-a" } })).status, 429);
    assert.equal((await fetch(`${baseUrl}/generate`, { method: "POST", headers: { "x-test-user": "user-b" } })).status, 200);
  });

  await withServer((app) => {
    app.post("/delete", metaDeletionLimiter, (req, res) => res.sendStatus(200));
  }, async (baseUrl) => {
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await fetch(`${baseUrl}/delete`, { method: "POST" })).status, 200);
    }
    assert.equal((await fetch(`${baseUrl}/delete`, { method: "POST" })).status, 429);
  });

  await withServer((app) => {
    app.post('/resend', resendVerificationLimiter, (_req, res) => res.sendStatus(200));
  }, async (baseUrl) => {
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await fetch(`${baseUrl}/resend`, { method: 'POST' })).status, 200);
    }
    const blocked = await fetch(`${baseUrl}/resend`, { method: 'POST' });
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error_code, 'RATE_LIMIT_EXCEEDED');
  });

  console.log("ok - sensitive endpoint rate limiters enforce IP and user buckets");
}

main().catch((error) => {
  console.error("not ok - sensitive endpoint rate limiters enforce IP and user buckets");
  console.error(error);
  process.exitCode = 1;
});
