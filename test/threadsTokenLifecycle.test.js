const assert = require("node:assert/strict");

require("dotenv").config();

const { publishSingleDraft } = require("../src/services/threadsPublishService");

function createSupabase(accountRow) {
  const savedPayloads = [];

  return {
    savedPayloads,
    from(table) {
      assert.equal(table, "social_accounts");

      const selectQuery = {
        select() {
          return selectQuery;
        },
        eq() {
          return selectQuery;
        },
        maybeSingle: async () => ({ data: accountRow, error: null }),
      };

      return {
        select() {
          return selectQuery;
        },
        update(payload) {
          savedPayloads.push(payload);
          const updateQuery = {
            eq() {
              return updateQuery;
            },
            select() {
              return updateQuery;
            },
            single: async () => ({
              data: { ...accountRow, ...payload },
              error: null,
            }),
            maybeSingle: async () => ({
              data: { ...accountRow, ...payload },
              error: null,
            }),
          };
          return updateQuery;
        },
      };
    },
  };
}

async function main() {
  const originalFetch = global.fetch;
  const refreshRequests = [];
  global.fetch = async (url) => {
    refreshRequests.push(String(url));
    return new Response(JSON.stringify({
      access_token: "refreshed-access-token",
      expires_in: 5184000,
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const supabase = createSupabase({
      id: "account-1",
      user_id: "user-1",
      platform: "threads",
      access_token: "expiring-long-lived-token",
      refresh_token: null,
      expires_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      platform_user_id: "threads-1",
      username: "testuser",
    });

    await assert.rejects(
      publishSingleDraft({
        supabase,
        userId: "user-1",
        contentOutput: { id: "output-1", content: "" },
      }),
      { message: "Content output content is empty" }
    );

    assert.equal(refreshRequests.length, 1);
    assert.match(refreshRequests[0], /refresh_access_token/);
    assert.match(refreshRequests[0], /access_token=expiring-long-lived-token/);
    assert.equal(supabase.savedPayloads[0].access_token, "refreshed-access-token");

    const missingExpirySupabase = createSupabase({
      id: "account-2",
      user_id: "user-1",
      platform: "threads",
      access_token: "token-without-expiry",
      refresh_token: null,
      expires_at: null,
      platform_user_id: "threads-1",
      username: "testuser",
    });

    await assert.rejects(
      publishSingleDraft({
        supabase: missingExpirySupabase,
        userId: "user-1",
        contentOutput: { id: "output-2", content: "" },
      }),
      {
        status: 401,
        code: "THREADS_RECONNECT_REQUIRED",
        message: "Threads connection must be renewed",
      }
    );

    global.fetch = async () => new Response(JSON.stringify({
      error: { message: "Invalid OAuth access token" },
    }), { status: 401, headers: { "content-type": "application/json" } });

    const rejectedRefreshSupabase = createSupabase({
      id: "account-3",
      user_id: "user-1",
      platform: "threads",
      access_token: "rejected-expiring-token",
      refresh_token: null,
      expires_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      platform_user_id: "threads-1",
      username: "testuser",
    });

    await assert.rejects(
      publishSingleDraft({
        supabase: rejectedRefreshSupabase,
        userId: "user-1",
        contentOutput: { id: "output-3", content: "" },
      }),
      {
        status: 401,
        code: "THREADS_RECONNECT_REQUIRED",
        message: "Threads connection must be renewed",
      }
    );
  } finally {
    global.fetch = originalFetch;
  }

  console.log("ok - expiring Threads token refreshes without a separate refresh token");
}

main().catch((error) => {
  console.error("not ok - expiring Threads token refreshes without a separate refresh token");
  console.error(error);
  process.exitCode = 1;
});
