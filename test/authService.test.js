const assert = require("node:assert/strict");

const authService = require("../src/services/authService");

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

function createSupabaseMock({ profileRow, socialAccountRow }) {
  return {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          if (table === "profiles" && column === "id") {
            query._profileUserId = value;
          }

          if (table === "social_accounts") {
            if (column === "user_id") {
              query._socialUserId = value;
            }

            if (column === "platform") {
              query._platform = value;
            }
          }

          return query;
        },
        single: async () => {
          if (table === "profiles") {
            return { data: profileRow, error: null };
          }

          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (table === "profiles") {
            return { data: profileRow, error: null };
          }

          if (table === "social_accounts") {
            return { data: socialAccountRow, error: null };
          }

          return { data: null, error: null };
        },
      };

      return query;
    },
  };
}

async function main() {
  await run("getCurrentUserProfile includes threads social account status", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-1",
        account_name: "alpha",
        full_name: "Alpha User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: {
        access_token: "valid_access_token",
        username: "alpha_threads",
        platform_user_id: "threads_123",
        expires_at: "2099-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-1", email: "alpha@example.com" },
      supabase,
    });

    assert.equal(result.user.id, "user-1");
    assert.equal(result.profile.accountName, "alpha");
    assert.equal(result.socialAccounts.threads.connected, true);
    assert.equal(result.socialAccounts.threads.needsReconnect, false);
    assert.equal(result.socialAccounts.threads.accountId, "alpha_threads");
    assert.equal(result.socialAccounts.threads.threadsId, "threads_123");
  });

  await run("getCurrentUserProfile marks threads connection missing when record absent", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-2",
        account_name: "beta",
        full_name: "Beta User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: null,
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-2", email: "beta@example.com" },
      supabase,
    });

    assert.equal(result.socialAccounts.threads.connected, false);
    assert.equal(result.socialAccounts.threads.accountId, null);
    assert.equal(result.socialAccounts.threads.threadsId, null);
  });

  await run("getCurrentUserProfile tolerates missing profile row", async () => {
    const supabase = createSupabaseMock({
      profileRow: null,
      socialAccountRow: {
        access_token: "valid_access_token",
        username: "missing_profile_threads",
        platform_user_id: "threads_000",
        expires_at: "2099-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-2b", email: "missing@example.com" },
      supabase,
    });

    assert.equal(result.profile, null);
    assert.equal(result.socialAccounts.threads.connected, true);
  });

  await run("getCurrentUserProfile marks threads connection needs reconnect when token expired", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-3",
        account_name: "gamma",
        full_name: "Gamma User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: {
        access_token: "expired_access_token",
        username: "gamma_threads",
        platform_user_id: "threads_456",
        expires_at: "2020-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-3", email: "gamma@example.com" },
      supabase,
    });

    assert.equal(result.socialAccounts.threads.connected, false);
    assert.equal(result.socialAccounts.threads.canUseToken, false);
    assert.equal(result.socialAccounts.threads.needsReconnect, true);
    assert.equal(result.socialAccounts.threads.status, "needs_reconnect");
  });

  await run("getCurrentUserProfile marks threads connection disconnected when expiry metadata is missing", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-4",
        account_name: "delta",
        full_name: "Delta User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: {
        access_token: "token_without_expiry",
        username: "delta_threads",
        platform_user_id: "threads_789",
        expires_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserProfile({
      user: { id: "user-4", email: "delta@example.com" },
      supabase,
    });

    assert.equal(result.socialAccounts.threads.connected, false);
    assert.equal(result.socialAccounts.threads.canUseToken, false);
    assert.equal(result.socialAccounts.threads.needsReconnect, true);
    assert.equal(result.socialAccounts.threads.reason, "Saved token has no expiry metadata.");
  });

  await run("getCurrentUserThreadsConnection returns threads status only", async () => {
    const supabase = createSupabaseMock({
      profileRow: {
        id: "user-5",
        account_name: "echo",
        full_name: "Echo User",
        created_at: "2026-01-01T00:00:00.000Z",
        role: "user",
      },
      socialAccountRow: {
        access_token: "valid_access_token",
        username: "echo_threads",
        platform_user_id: "threads_999",
        expires_at: "2099-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await authService.getCurrentUserThreadsConnection({
      user: { id: "user-5", email: "echo@example.com" },
      supabase,
    });

    assert.equal(result.connected, true);
    assert.equal(result.status, "connected");
    assert.equal(result.accountId, "echo_threads");
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
