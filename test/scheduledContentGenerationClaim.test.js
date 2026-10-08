const assert = require("node:assert/strict");

const {
  claimScheduledContentGenerationJob,
} = require("../src/services/contentOutputsService");

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
  await run("content generation atomically claims only an active scheduled job", async () => {
    const row = {
      id: "job-1",
      user_id: "user-1",
      job_type: "content_auto_generate",
      status: "running",
      target_count: 1,
    };
    const { client, state } = createClaimSupabase(row);

    const claimed = await claimScheduledContentGenerationJob({
      supabase: client,
      userId: "user-1",
      scheduledJobId: "job-1",
    });

    assert.equal(state.table, "scheduled_jobs");
    assert.deepEqual(state.updatePayload, { status: "running" });
    assert.deepEqual(state.filters, [
      ["id", "job-1"],
      ["user_id", "user-1"],
      ["job_type", "content_auto_generate"],
      ["status", "active"],
    ]);
    assert.equal(claimed.id, "job-1");
    assert.equal(claimed.status, "running");
  });

  await run("content generation skips a scheduled job claimed by another worker", async () => {
    const { client } = createClaimSupabase(null);

    const claimed = await claimScheduledContentGenerationJob({
      supabase: client,
      userId: "user-1",
      scheduledJobId: "job-1",
    });

    assert.equal(claimed, null);
  });
}

main();
