const assert = require("node:assert/strict");

const {
  releaseFailedTopicsForRetry,
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

function createReleaseSupabase(rows) {
  const state = { table: null, updatePayload: null, topicIds: null, userId: null };
  const query = {
    update(payload) {
      state.updatePayload = payload;
      return this;
    },
    in(column, values) {
      assert.equal(column, "id");
      state.topicIds = values;
      return this;
    },
    eq(column, value) {
      assert.equal(column, "user_id");
      state.userId = value;
      return this;
    },
    select() {
      return Promise.resolve({ data: rows, error: null });
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

run("failed scheduled topics are released so they can be generated again", async () => {
  const { client, state } = createReleaseSupabase([{ id: "topic-failed" }]);

  const releasedTopicIds = await releaseFailedTopicsForRetry({
    supabase: client,
    userId: "user-1",
    results: [
      { topicId: "topic-success", status: "success" },
      { topicId: "topic-failed", status: "failed", error: "Daily generation limit exceeded" },
    ],
  });

  assert.equal(state.table, "content_topics");
  assert.deepEqual(state.updatePayload, { used_at: null });
  assert.deepEqual(state.topicIds, ["topic-failed"]);
  assert.equal(state.userId, "user-1");
  assert.deepEqual(releasedTopicIds, ["topic-failed"]);
});

run("successful scheduled topics stay reserved", async () => {
  let databaseCalls = 0;

  const releasedTopicIds = await releaseFailedTopicsForRetry({
    supabase: {
      from() {
        databaseCalls += 1;
      },
    },
    userId: "user-1",
    results: [{ topicId: "topic-success", status: "success" }],
  });

  assert.equal(databaseCalls, 0);
  assert.deepEqual(releasedTopicIds, []);
});

