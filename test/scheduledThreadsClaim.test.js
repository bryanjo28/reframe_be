const assert = require("node:assert/strict");

const {
  claimScheduledThreadsJob,
} = require("../src/services/threadsPublishService");

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function createClaimSupabase(resultData) {
  const state = { table: null, updatePayload: null, filters: [] };
  const query = {
    update(payload) {
      state.updatePayload = payload;
      return this;
    },
    eq(column, value) {
      state.filters.push([column, value]);
      return this;
    },
    select() {
      return this;
    },
    async maybeSingle() {
      return { data: resultData, error: null };
    },
  };

  return {
    state,
    client: {
      from(table) {
        state.table = table;
        return query;
      },
    },
  };
}

async function main() {
  await run("claimScheduledThreadsJob atomically changes only an active job to running", async () => {
    const row = {
      id: "job-1",
      user_id: "user-1",
      status: "running",
      target_count: 1,
    };
    const { client, state } = createClaimSupabase(row);

    const claimed = await claimScheduledThreadsJob({
      supabase: client,
      userId: "user-1",
      scheduledJobId: "job-1",
    });

    assert.equal(state.table, "scheduled_jobs");
    assert.deepEqual(state.updatePayload, { status: "running" });
    assert.deepEqual(state.filters, [
      ["id", "job-1"],
      ["user_id", "user-1"],
      ["status", "active"],
    ]);
    assert.equal(claimed.id, "job-1");
    assert.equal(claimed.status, "running");
  });

  await run("claimScheduledThreadsJob returns null when another run already claimed it", async () => {
    const { client } = createClaimSupabase(null);

    const claimed = await claimScheduledThreadsJob({
      supabase: client,
      userId: "user-1",
      scheduledJobId: "job-1",
    });

    assert.equal(claimed, null);
  });
}

main();
