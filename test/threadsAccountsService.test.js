const assert = require("node:assert/strict");

require("dotenv").config();

const {
  disconnectThreadsAccount,
  getThreadsAccount,
} = require("../src/services/threadsAccountsService");
const credentialsRepository = require("../src/repositories/socialAccountCredentialsRepository");

function run(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function createSupabase({ existingRow = null, updateError = null }) {
  return {
    from(table) {
      assert.equal(table, "social_accounts");

      const selectQuery = {
        select() {
          return selectQuery;
        },
        eq() {
          return selectQuery;
        },
        maybeSingle: async () => ({ data: existingRow, error: null }),
      };

      return {
        select() {
          return selectQuery;
        },
        update() {
          const updateQuery = {
            eq() {
              return updateQuery;
            },
            select() {
              return updateQuery;
            },
            maybeSingle: async () => ({ data: null, error: updateError }),
          };
          return updateQuery;
        },
      };
    },
  };
}

run("disconnectThreadsAccount returns a stable code when account is missing", async () => {
  await assert.rejects(
    disconnectThreadsAccount({
      supabase: createSupabase({ existingRow: null }),
      userId: "user-1",
    }),
    {
      status: 404,
      code: "THREADS_ACCOUNT_NOT_FOUND",
      message: "Threads account not found",
    }
  );
});

run("disconnectThreadsAccount returns a stable code when token cleanup fails", async () => {
  await assert.rejects(
    disconnectThreadsAccount({
      supabase: createSupabase({
        existingRow: {
          id: "account-1",
          user_id: "user-1",
          platform: "threads",
          access_token: "token",
        },
        updateError: { message: "database update failed" },
      }),
      userId: "user-1",
    }),
    {
      status: 400,
      code: "THREADS_DISCONNECT_FAILED",
      message: "Failed to disconnect Threads account",
    }
  );
});

run("disconnectThreadsAccount returns a stable code when the service is unavailable", async () => {
  await assert.rejects(
    disconnectThreadsAccount({ supabase: null, userId: "user-1" }),
    {
      status: 500,
      code: "THREADS_SERVICE_ERROR",
      message: "Threads service is not configured",
    }
  );
});

run("getThreadsAccount does not expose provider credentials by default", async () => {
  const account = await getThreadsAccount({
    supabase: createSupabase({
      existingRow: {
        id: "account-1",
        user_id: "user-1",
        platform: "threads",
        access_token: "secret-access-token",
        refresh_token: "secret-refresh-token",
        expires_at: "2026-12-01T00:00:00.000Z",
        platform_user_id: "threads-1",
        username: "testuser",
      },
    }),
    userId: "user-1",
  });

  assert.equal(account.id, "account-1");
  assert.equal(account.threadsId, "threads-1");
  assert.equal(Object.hasOwn(account, "accessToken"), false);
  assert.equal(Object.hasOwn(account, "refreshToken"), false);
});

run("credential repository reads only the private table through the supplied admin client", async () => {
  const calls = [];
  const credentialSupabase = {
    from(table) {
      calls.push(table);
      assert.equal(table, "social_account_credentials");
      const query = {
        select(columns) {
          assert.equal(columns, "access_token, refresh_token");
          return query;
        },
        eq(column, value) {
          assert.equal(column, "social_account_id");
          assert.equal(value, "account-1");
          return query;
        },
        maybeSingle: async () => ({
          data: { access_token: "private-token", refresh_token: "private-refresh" },
          error: null,
        }),
      };
      return query;
    },
  };

  const credentials = await credentialsRepository.getBySocialAccountId({
    supabase: credentialSupabase,
    socialAccountId: "account-1",
  });

  assert.deepEqual(credentials, {
    accessToken: "private-token",
    refreshToken: "private-refresh",
  });
  assert.deepEqual(calls, ["social_account_credentials"]);
});

run("internal credential reads verify account ownership first", async () => {
  let credentialReads = 0;
  const credentialSupabase = {
    from() {
      credentialReads += 1;
      throw new Error("credential lookup must not run");
    },
  };

  const account = await getThreadsAccount({
    supabase: createSupabase({ existingRow: null }),
    credentialSupabase,
    userId: "user-1",
    includeCredentials: true,
  });

  assert.equal(account, null);
  assert.equal(credentialReads, 0);
});

run("internal credential reads fail closed without a service-role client", async () => {
  await assert.rejects(
    getThreadsAccount({
      supabase: createSupabase({
        existingRow: {
          id: "account-1",
          user_id: "user-1",
          platform: "threads",
          expires_at: "2026-12-01T00:00:00.000Z",
        },
      }),
      credentialSupabase: null,
      userId: "user-1",
      includeCredentials: true,
    }),
    {
      status: 500,
      code: "THREADS_CREDENTIALS_UNAVAILABLE",
    }
  );
});
