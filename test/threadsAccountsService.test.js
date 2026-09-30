const assert = require("node:assert/strict");

require("dotenv").config();

const {
  disconnectThreadsAccount,
} = require("../src/services/threadsAccountsService");

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
