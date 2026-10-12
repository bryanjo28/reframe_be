const assert = require("node:assert/strict");

require("dotenv").config();

const { listContentOutputs } = require("../src/services/contentOutputsService");
const { listContentTopics } = require("../src/services/contentTopicsService");

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

function createListDatabase({ tableName, rows, total, expectedRange, expectedFilters = [] }) {
  const observed = {
    count: null,
    filters: [],
    range: null,
  };

  return {
    observed,
    from(actualTableName) {
      assert.equal(actualTableName, tableName);

      const query = {
        select(_columns, options) {
          observed.count = options?.count || null;
          return this;
        },
        eq(key, value) {
          assert.equal(observed.range, null, "filters must be applied before pagination");
          observed.filters.push([key, value]);
          return this;
        },
        ilike(key, value) {
          assert.equal(observed.range, null, "filters must be applied before pagination");
          observed.filters.push([key, value]);
          return this;
        },
        order() {
          return this;
        },
        range(from, to) {
          observed.range = [from, to];
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, count: total, error: null }).then(
            resolve,
            reject
          );
        },
      };

      return query;
    },
    assertRequest(userId) {
      assert.equal(observed.count, "exact");
      assert.deepEqual(observed.filters, [["user_id", userId], ...expectedFilters]);
      assert.deepEqual(observed.range, expectedRange);
    },
  };
}

run("content outputs list returns page metadata and only requests that page", async () => {
  const database = createListDatabase({
    tableName: "content_outputs",
    rows: [{ id: "output-21", user_id: "user-1", content: "Draft" }],
    total: 42,
    expectedRange: [20, 39],
  });

  const result = await listContentOutputs({
    supabase: database,
    userId: "user-1",
    query: { page: "2", limit: "20" },
  });

  database.assertRequest("user-1");
  assert.equal(result.data[0].id, "output-21");
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 20,
    total: 42,
    totalPages: 3,
    hasNextPage: true,
  });
});

for (const jobIdKey of ["publishScheduledJobId", "publish_scheduled_job_id"]) {
  run(`content outputs filters failed Threads posts by ${jobIdKey} before pagination`, async () => {
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const database = createListDatabase({
      tableName: "content_outputs",
      rows: [{ id: "failed-output", status: "failed", platform: "Threads", publish_scheduled_job_id: jobId }],
      total: 3,
      expectedRange: [2, 3],
      expectedFilters: [["status", "failed"], ["platform", "threads"], ["publish_scheduled_job_id", jobId]],
    });

    const result = await listContentOutputs({
      supabase: database,
      userId: "user-1",
      query: { status: " failed ", platform: "threads", [jobIdKey]: jobId, page: "2", limit: "2" },
    });

    database.assertRequest("user-1");
    assert.equal(result.data[0].publishScheduledJobId, jobId);
    assert.deepEqual(result.pagination, { page: 2, limit: 2, total: 3, totalPages: 2, hasNextPage: false });
  });
}

run("content topics list returns page metadata and only requests that page", async () => {
  const database = createListDatabase({
    tableName: "content_topics",
    rows: [{ id: "topic-1", user_id: "user-2", topic: "Testing" }],
    total: 1,
    expectedRange: [0, 19],
  });

  const result = await listContentTopics({
    supabase: database,
    userId: "user-2",
    query: {},
  });

  database.assertRequest("user-2");
  assert.equal(result.data[0].id, "topic-1");
  assert.deepEqual(result.pagination, {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
  });
});
