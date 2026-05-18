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

function mockFetch() {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl.includes("/oauth/access_token")) {
      return new Response(
        JSON.stringify({
          access_token: "short_lived_test_token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (requestUrl.includes("/access_token")) {
      return new Response(
        JSON.stringify({
          access_token: "long_lived_test_token",
          expires_in: 5184000,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (requestUrl.includes("/refresh_access_token")) {
      return new Response(
        JSON.stringify({
          access_token: "refreshed_long_lived_test_token",
          expires_in: 5184000,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (requestUrl.includes("/v1.0/me")) {
      return new Response(
        JSON.stringify({
          id: "threads_user_123",
          username: "testuser",
          name: "Test User",
          threads_profile_picture_url: "https://example.com/profile.jpg",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "unexpected" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  };

  return () => {
    global.fetch = originalFetch;
  };
}

async function main() {
  await run("createAuthorizationRequest returns a connect URL with state", () => {
    const result = threadsAuthService.createAuthorizationRequest({
      userId: crypto.randomUUID(),
    });

    assert.ok(result.state);
    assert.ok(result.authorizationUrl.includes("https://threads.net/oauth/authorize?"));
    assert.ok(result.authorizationUrl.includes(`state=${result.state}`));
    assert.ok(result.authorizationUrl.includes("redirect_uri="));
  });

  await run("handleCallback exchanges tokens and stores account data", async () => {
    const restoreFetch = mockFetch();

    try {
      const userId = crypto.randomUUID();
      const connect = threadsAuthService.createAuthorizationRequest({ userId });

      const result = await threadsAuthService.handleCallback({
        code: "test_code_123",
        state: connect.state,
      });

      assert.equal(result.userId, userId);
      assert.equal(result.provider, "threads");
      assert.equal(result.accessTokenStored, true);
      assert.equal(result.threadsUserId, "threads_user_123");
      assert.equal(result.threadsUsername, "testuser");
      assert.ok(result.tokenRecord);
      assert.equal(result.storage, "memory");
      assert.equal(result.tokenRecord.userId, userId);
      assert.equal(result.tokenRecord.provider, "threads");
      assert.equal(result.tokenRecord.accessToken, "long_lived_test_token");
      assert.equal(result.tokenRecord.threadsUserId, "threads_user_123");
    } finally {
      restoreFetch();
    }
  });

  await run("refreshLongLivedToken normalizes refresh response", async () => {
    const restoreFetch = mockFetch();

    try {
      const result = await threadsAuthService.refreshLongLivedToken({
        accessToken: "existing_long_lived_token",
      });

      assert.equal(result.accessToken, "refreshed_long_lived_test_token");
      assert.equal(result.expiresIn, 5184000);
      assert.equal(result.tokenType, "Bearer");
    } finally {
      restoreFetch();
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
