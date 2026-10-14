const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-key";
process.env.THREADS_POST_INTERVAL_MS = "0";

const { runScheduledThreadsJob } = require("../src/services/threadsPublishService");

function database(rows, onWrite = () => {}) {
  return {
    from(table) {
      const filters = [];
      let action = "read";
      let payload;
      let maximum = Infinity;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        is(key, value) { filters.push((row) => (row[key] ?? null) === value); return query; },
        ilike(key, value) { filters.push((row) => row[key]?.toLowerCase() === value.toLowerCase()); return query; },
        lte() { return query; },
        order() { return query; },
        limit(value) { maximum = value; return query; },
        update(value) { action = "update"; payload = value; return query; },
        insert(value) { action = "insert"; payload = value; return query; },
        async execute(single) {
          let matching = (rows[table] || []).filter((row) => filters.every((filter) => filter(row))).slice(0, maximum);
          if (action !== "read") onWrite(table, payload);
          if (action === "insert") {
            const row = { id: `${table}-${(rows[table] || []).length + 1}`, ...payload };
            (rows[table] ||= []).push(row);
            matching = [row];
          }
          if (action === "update") matching.forEach((row) => Object.assign(row, payload));
          const copied = matching.map((row) => ({ ...row }));
          return { data: single ? copied[0] || null : copied, error: null };
        },
        maybeSingle() { return query.execute(true); },
        single() { return query.execute(true); },
        then(resolve, reject) { return query.execute(false).then(resolve, reject); },
      };
      return query;
    },
  };
}

async function runScenario(cancellationStage) {
  const rows = {
    scheduled_jobs: [{ id: "job-1", user_id: "user-1", status: "active", job_type: "threads_auto_post", target_count: 2 }],
    content_outputs: [1, 2].map((index) => ({ id: `output-${index}`, user_id: "user-1", status: "approved", platform: "threads", content: `Post ${index}`, thread_type: "short", publish_scheduled_job_id: "job-1", publish_scheduled_job_run_id: null })),
    social_accounts: [{ id: "account-1", user_id: "user-1", platform: "threads", platform_user_id: "threads-1", username: "user", expires_at: "2099-01-01T00:00:00Z" }],
    social_account_credentials: [{ social_account_id: "account-1", access_token: "test-token", refresh_token: null }],
    published_posts: [],
    scheduled_job_runs: [],
  };
  const originalFetch = global.fetch;
  const apiCalls = [];
  global.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    apiCalls.push(pathname);
    if (pathname.endsWith("/threads")) {
      if (cancellationStage === "container") rows.scheduled_jobs[0].status = "cancelling";
      return new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
    }
    if (pathname.endsWith("/container-1")) {
      return new Response(JSON.stringify({ status: "FINISHED" }), { status: 200 });
    }
    if (pathname.endsWith("/threads_publish")) {
      if (cancellationStage === "publish") rows.scheduled_jobs[0].status = "cancelling";
      return new Response(JSON.stringify({ id: "meta-post-1" }), { status: 200 });
    }
    throw new Error(`Unexpected API call: ${pathname}`);
  };
  try {
    const userSupabase = database(rows, (table, payload) => {
        if (cancellationStage && ((table === "scheduled_job_runs" && payload.finished_at) || (table === "content_outputs" && payload.external_post_id))) {
          assert.equal(rows.scheduled_jobs[0].status, "cancelling", "Deletion barrier must remain until worker results have been written");
        }
      });
    const result = await runScheduledThreadsJob({
      supabase: userSupabase,
      credentialSupabase: database(rows),
      userId: "user-1", scheduledJobId: "job-1", force: true,
      assertScheduleAccessFn: async () => ({ canSchedule: true }),
    });
    const cancelled = cancellationStage !== null;
    const expectedPublishes = cancellationStage === "container" ? 0 : cancelled ? 1 : 2;
    assert.equal(apiCalls.filter((path) => path.endsWith("/threads_publish")).length, expectedPublishes);
    assert.equal(apiCalls.filter((path) => path.endsWith("/threads")).length, cancelled ? 1 : 2, "Do not start the next content output after cancellation");
    assert.equal(rows.scheduled_jobs[0].status, cancelled ? "cancelled" : "completed", "Only mark the worker stopped after all writes are complete");
    assert.equal(rows.scheduled_job_runs[0].status, cancelled ? "cancelled" : "completed");
    if (cancelled) assert.equal(rows.content_outputs[1].publish_scheduled_job_run_id, null);
    assert.equal(result.results[0].status, cancelled ? "cancelled" : "completed");
    if (cancellationStage === "publish") {
      assert.equal(rows.published_posts[0].platform_post_id, "meta-post-1", "Record the result of an already dispatched request before releasing the worker");
    }
    console.log(`ok - scheduled Threads worker: ${cancellationStage || "normal completion"}`);
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  await runScenario("container");
  await runScenario("publish");
  await runScenario(null);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
