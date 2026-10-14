const assert = require("node:assert/strict");

require("dotenv").config();

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

function createDatabase(rows, error = null) {
  return {
    from(table) {
      assert.equal(table, "published_posts");
      let selected = [...rows];
      let bounds;
      const ordering = [];
      return {
        select() { return this; },
        eq(key, value) {
          selected = selected.filter((row) => row[key] === value);
          return this;
        },
        ilike(key, value) {
          selected = selected.filter((row) => row[key]?.toLowerCase() === value.toLowerCase());
          return this;
        },
        not(key, operator, value) {
          assert.equal(operator, "is");
          assert.equal(value, null);
          selected = selected.filter((row) => row[key] != null);
          return this;
        },
        order(key, { ascending }) {
          ordering.push([key, ascending]);
          selected.sort((a, b) => {
            for (const [column, asc] of ordering) {
              const comparison = String(a[column]).localeCompare(String(b[column])) * (asc ? 1 : -1);
              if (comparison) return comparison;
            }
            return 0;
          });
          return this;
        },
        range(from, to) { bounds = [from, to]; return this; },
        then(resolve, reject) {
          return Promise.resolve({
            data: selected.slice(bounds[0], bounds[1] + 1),
            count: selected.length,
            error,
          }).then(resolve, reject);
        },
      };
    },
  };
}

const successfulPost = {
  id: "post-1",
  user_id: "user-1",
  content_output_id: "123e4567-e89b-42d3-a456-426614174000",
  platform: "Threads",
  status: "success",
  publish_status: "success",
  platform_post_id: "threads-1",
  post_url: "https://www.threads.net/@demo/post/one",
  posted_at: "2026-10-12T10:00:00.000Z",
  sequence_number: 1,
};

run("published posts list returns only owned successful Threads posts with URLs", async () => {
  const { listPublishedPosts } = require("../src/services/publishedPostsService");
  const result = await listPublishedPosts({
    supabase: createDatabase([
      successfulPost,
      { ...successfulPost, id: "other-user", user_id: "user-2" },
      { ...successfulPost, id: "failed", status: "failed", publish_status: "failed" },
      { ...successfulPost, id: "uncertain", publish_status: "uncertain" },
      { ...successfulPost, id: "no-url", post_url: null },
      { ...successfulPost, id: "no-platform-id", platform_post_id: null },
      { ...successfulPost, id: "other-platform", platform: "instagram" },
    ]),
    userId: "user-1",
  });
  assert.deepEqual(result.data.map((row) => row.id), ["post-1"]);
  assert.equal(result.data[0].postUrl, "https://www.threads.net/@demo/post/one");
  assert.equal(result.data[0].contentOutputId, successfulPost.content_output_id);
  assert.equal(result.pagination.total, 1);
});

for (const key of ["contentOutputId", "content_output_id"]) {
  run(`published posts filters by ${key} with correct pagination`, async () => {
    const { listPublishedPosts } = require("../src/services/publishedPostsService");
    const result = await listPublishedPosts({
      supabase: createDatabase([
        successfulPost,
        { ...successfulPost, id: "reply", sequence_number: 2, posted_at: "2026-10-12T10:01:00.000Z" },
        { ...successfulPost, id: "other-output", content_output_id: "123e4567-e89b-42d3-a456-426614174001" },
      ]),
      userId: "user-1",
      query: { [key]: successfulPost.content_output_id, page: "2", limit: "1" },
    });
    assert.deepEqual(result.data.map((row) => row.id), ["post-1"]);
    assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 2, totalPages: 2, hasNextPage: false });
  });
}

run("published posts propagates database errors", async () => {
  const { listPublishedPosts } = require("../src/services/publishedPostsService");
  await assert.rejects(
    listPublishedPosts({ supabase: createDatabase([], { message: "database unavailable" }), userId: "user-1" }),
    { message: "database unavailable", status: 500 }
  );
});
