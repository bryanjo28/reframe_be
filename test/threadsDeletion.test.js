const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const threadsConfig = require("../src/config/threads");
const supabaseConfig = require("../src/config/supabase");

function signedRequest(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${crypto.createHmac("sha256", secret).update(encoded).digest("base64url")}.${encoded}`;
}

function createDatabase(rows, calls, failure = {}) {
  return {
    from(table) {
      let operation = "select";
      let payload;
      let bounds;
      const filters = [];
      const query = {
        select(columns) { calls.push([table, "select", columns]); return query; },
        delete() { operation = "delete"; calls.push([table, operation]); return query; },
        update(value) { operation = "update"; payload = value; calls.push([table, operation, value]); return query; },
        eq(key, value) { filters.push((row) => row[key] === value); calls.push([table, "eq", key, value]); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); calls.push([table, "in", key, values]); return query; },
        order() { return query; },
        range(start, end) { bounds = [start, end]; return query; },
        then(resolve) {
          if (failure.table === table && failure.operation === operation) {
            return Promise.resolve({ data: null, error: { message: "Database rejected cleanup" } }).then(resolve);
          }
          const matching = (rows[table] || []).filter((row) => filters.every((filter) => filter(row)));
          if (operation === "update") matching.forEach((row) => Object.assign(row, payload));
          if (operation === "delete") rows[table] = rows[table].filter((row) => !matching.includes(row));
          // Reproduce a Supabase row limit even when the query omits pagination.
          const data = operation === "select" ? matching.slice(bounds?.[0] || 0, bounds ? bounds[1] + 1 : 100) : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

async function main() {
  const originalSecret = threadsConfig.appSecret;
  const originalAdmin = supabaseConfig.supabaseAdmin;
  const originalBaseUrl = process.env.APP_BASE_URL;
  threadsConfig.appSecret = "test-deletion-secret";
  process.env.APP_BASE_URL = "https://reframe-be.onrender.com";
  const calls = [];
  const rows = {
    social_accounts: [
      { id: "account-1", user_id: "user-1", platform: "threads", platform_user_id: "123456789012345678", access_token: "secret" },
      { id: "account-other", user_id: "user-other", platform: "threads", platform_user_id: "other-id" },
    ],
    published_posts: Array.from({ length: 120 }, (_, index) => ({ id: `post-${index}`, social_account_id: "account-1", content_output_id: `output-${index}` })),
    content_outputs: Array.from({ length: 120 }, (_, index) => ({ id: `output-${index}`, external_post_id: `meta-post-${index}`, content: "Keep authored content" })),
    scheduled_jobs: [
      { id: "job-1", user_id: "user-1", job_type: "threads_auto_post", status: "active" },
      { id: "job-other", user_id: "user-other", job_type: "threads_auto_post", status: "active" },
      { id: "generation-job", user_id: "user-1", job_type: "generate_content_from_topics", status: "active" },
    ],
    scheduled_job_runs: [
      { id: "run-1", scheduled_job_id: "job-1", user_id: "user-1", result_payload: { postUrl: "https://threads.net/post/secret" }, error_message: "Meta error", success_count: 1 },
      { id: "run-other", scheduled_job_id: "job-other", user_id: "user-other", result_payload: { keep: true } },
    ],
  };
  supabaseConfig.supabaseAdmin = createDatabase(rows, calls);
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api/threads", require("../src/routes/threadsRoutes"));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const payload = { algorithm: "HMAC-SHA256", user_id: "123456789012345678" };
    const response = await fetch(`${baseUrl}/api/threads/delete`, {
      method: "POST",
      body: new URLSearchParams({ signed_request: signedRequest(payload, threadsConfig.appSecret) }),
    });
    assert.equal(response.status, 200, "Meta callback must work without an application bearer token");
    const receipt = await response.json();
    assert.deepEqual(Object.keys(receipt).sort(), ["confirmation_code", "url"]);
    assert.match(receipt.confirmation_code, /^[a-zA-Z0-9]+$/);
    assert.equal(receipt.url, `https://reframe-be.onrender.com/api/threads/delete/status/${receipt.confirmation_code}`);
    assert(calls.some((call) => call[0] === "social_accounts" && call[1] === "eq" && call[2] === "platform_user_id" && call[3] === payload.user_id));
    assert(calls.some((call) => call[0] === "published_posts" && call[1] === "delete"));
    assert(calls.some((call) => call[0] === "social_accounts" && call[1] === "delete"));
    assert(rows.content_outputs.every((row) => row.external_post_id === null), "Every external ID must be cleared, including rows beyond the database response limit");
    assert(rows.content_outputs.every((row) => row.content === "Keep authored content"));
    assert.equal(rows.scheduled_job_runs[0].result_payload, null, "Job results must not retain deleted Meta data");
    assert.equal(rows.scheduled_job_runs[0].error_message, null);
    assert.equal(rows.scheduled_job_runs[0].success_count, 1);
    assert.deepEqual(rows.scheduled_job_runs[1].result_payload, { keep: true });
    assert.equal(rows.scheduled_jobs[0].status, "paused");
    assert.equal(rows.scheduled_jobs[1].status, "active");
    assert.equal(rows.scheduled_jobs[2].status, "active");
    assert.deepEqual(rows.social_accounts.map((row) => row.id), ["account-other"]);
    const status = await fetch(`${baseUrl}${new URL(receipt.url).pathname}`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).status, "completed");
    const before = calls.length;
    for (const request of [undefined, signedRequest(payload, "wrong-secret"), signedRequest({ ...payload, algorithm: "SHA256" }, threadsConfig.appSecret), signedRequest({ algorithm: "HMAC-SHA256" }, threadsConfig.appSecret)]) {
      const rejected = await fetch(`${baseUrl}/api/threads/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signed_request: request }) });
      assert.equal(rejected.status, 400);
    }
    assert.equal(calls.length, before, "Invalid signatures must never reach the database");
    assert.equal((await fetch(`${baseUrl}/api/threads/delete/status/${"0".repeat(96)}`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/threads/delete`, { method: "DELETE" })).status, 401);
    supabaseConfig.supabaseAdmin = createDatabase({}, []);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const absent = await fetch(`${baseUrl}/api/threads/delete`, { method: "POST", body: new URLSearchParams({ signed_request: signedRequest(payload, threadsConfig.appSecret) }) });
      assert.equal(absent.status, 200, "Missing accounts and repeated callbacks are successful");
    }
    const retryRows = {
      social_accounts: [{ id: "retry-account", user_id: "retry-user", platform: "threads", platform_user_id: payload.user_id }],
      scheduled_jobs: [{ id: "retry-job", user_id: "retry-user", job_type: "threads_auto_post", status: "running" }],
      scheduled_job_runs: [{ id: "retry-run", user_id: "retry-user", scheduled_job_id: "retry-job", result_payload: { postUrl: "private-url" } }],
      published_posts: [{ id: "retry-post", social_account_id: "retry-account", content_output_id: "retry-output" }],
      content_outputs: [{ id: "retry-output", external_post_id: "meta-retry-post" }],
    };
    const postCallback = () => fetch(`${baseUrl}/api/threads/delete`, {
      method: "POST", body: new URLSearchParams({ signed_request: signedRequest(payload, threadsConfig.appSecret) }),
    });
    supabaseConfig.supabaseAdmin = createDatabase(retryRows, []);
    const busy = await postCallback();
    assert.equal(busy.status, 503, "Running publishers must finish before a completion receipt is issued");
    assert.equal(retryRows.social_accounts.length, 1);
    assert.deepEqual(retryRows.scheduled_job_runs[0].result_payload, { postUrl: "private-url" });
    retryRows.scheduled_jobs[0].status = "completed";
    supabaseConfig.supabaseAdmin = createDatabase(retryRows, [], { table: "scheduled_job_runs", operation: "update" });
    const failedCleanup = await postCallback();
    assert.equal(failedCleanup.status, 500);
    assert.equal((await failedCleanup.json()).confirmation_code, undefined);
    assert.equal(retryRows.social_accounts.length, 1, "Keep account scope available when cleanup fails");
    supabaseConfig.supabaseAdmin = createDatabase(retryRows, [], { table: "social_accounts", operation: "delete" });
    assert.equal((await postCallback()).status, 500);
    assert.equal(retryRows.published_posts.length, 0);
    assert.equal(retryRows.social_accounts.length, 1);
    supabaseConfig.supabaseAdmin = createDatabase(retryRows, []);
    assert.equal((await postCallback()).status, 200, "Retry after partial cleanup must finish successfully");
    assert.equal(retryRows.social_accounts.length, 0);
    supabaseConfig.supabaseAdmin = null;
    assert.equal((await fetch(`${baseUrl}/api/threads/delete`, { method: "POST", body: new URLSearchParams({ signed_request: signedRequest(payload, threadsConfig.appSecret) }) })).status, 500);
    supabaseConfig.supabaseAdmin = { from() { throw new Error("Database unavailable"); } };
    assert.equal((await fetch(`${baseUrl}/api/threads/delete`, { method: "POST", body: new URLSearchParams({ signed_request: signedRequest(payload, threadsConfig.appSecret) }) })).status, 500);
    console.log("ok - Threads deletion callback, signature validation, receipt status and failure handling");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    threadsConfig.appSecret = originalSecret;
    supabaseConfig.supabaseAdmin = originalAdmin;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
