const assert = require("node:assert/strict");
const {
  loadThreadPublishProgress,
  reserveThreadSequence,
  recordThreadContainer,
  markThreadSequenceSuccess,
  markThreadSequenceFailure,
  validateThreadResumeState,
} = require("../src/services/threadsPublishProgressService");

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

const parts = ["Root", "Reply one", "Reply two"];
const success = (sequenceNumber, platformPostId) => ({
  id: `row-${sequenceNumber}`,
  sequenceNumber,
  postContent: parts[sequenceNumber - 1],
  publishStatus: "success",
  platformPostId,
});

function fakeSupabase(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  const calls = [];
  let error = null;
  let emptyUpdate = false;
  const supabase = {
    rows,
    calls,
    failNext(message, code) { error = { message, code }; },
    emptyNextUpdate() { emptyUpdate = true; },
    from(table) {
      assert.equal(table, "published_posts");
      const query = {
        action: "read",
        filters: [],
        payload: null,
        select() { return this; },
        eq(key, value) { this.filters.push([key, value]); return this; },
        insert(payload) { this.action = "insert"; this.payload = payload; return this; },
        update(payload) { this.action = "update"; this.payload = payload; return this; },
        order(key, options) {
          calls.push({ action: this.action, filters: this.filters, order: [key, options] });
          const currentError = error;
          error = null;
          return Promise.resolve({
            data: currentError ? null : rows.filter((row) => this.matches(row))
              .sort((a, b) => a[key] - b[key]),
            error: currentError,
          });
        },
        matches(row) { return this.filters.every(([key, value]) => row[key] === value); },
        async maybeSingle() { return this.finish(); },
        async single() { return this.finish(); },
        finish() {
          calls.push({ action: this.action, filters: [...this.filters], payload: this.payload });
          const currentError = error;
          error = null;
          if (currentError) return { data: null, error: currentError };
          if (this.action === "insert") {
            const row = { id: `row-${rows.length + 1}`, ...this.payload };
            rows.push(row);
            return { data: row, error: null };
          }
          const row = rows.find((candidate) => this.matches(candidate));
          if (!row || (this.action === "update" && emptyUpdate)) {
            emptyUpdate = false;
            return { data: null, error: null };
          }
          if (this.action === "update") Object.assign(row, this.payload);
          return { data: row, error: null };
        },
      };
      return query;
    },
  };
  return supabase;
}

const identity = {
  userId: "user-1",
  account: { id: "account-1" },
  contentOutput: { id: "output-1" },
  sequenceNumber: 2,
  content: "Reply one",
  parentPublishedPostId: "row-1",
};

function persistedRow(overrides = {}) {
  return {
    id: "row-2",
    user_id: "user-1",
    social_account_id: "account-1",
    content_output_id: "output-1",
    platform: "threads",
    platform_post_id: null,
    post_url: null,
    posted_at: null,
    status: "processing",
    error_message: null,
    parent_published_post_id: "row-1",
    sequence_number: 2,
    post_content: "Reply one",
    created_at: "2026-09-29T08:00:00.000Z",
    creation_id: null,
    publish_status: "processing",
    publish_error_message: null,
    publish_started_at: "2026-09-29T08:00:00.000Z",
    publish_finished_at: null,
    ...overrides,
  };
}

async function main() {
  await run("empty progress starts at sequence 1", () => {
    assert.deepEqual(validateThreadResumeState({ rows: [], parts }), {
      completedRows: [],
      nextSequenceNumber: 1,
      previousPlatformPostId: null,
      rootPlatformPostId: null,
      complete: false,
    });
  });

  await run("successful prefix resumes with the last platform id", () => {
    const rows = [success(1, "root-id"), success(2, "reply-id")];
    assert.deepEqual(validateThreadResumeState({ rows, parts }), {
      completedRows: rows,
      nextSequenceNumber: 3,
      previousPlatformPostId: "reply-id",
      rootPlatformPostId: "root-id",
      complete: false,
    });
  });

  await run("all successful sequences are complete", () => {
    const rows = [success(1, "root-id"), success(2, "reply-id"), success(3, "last-id")];
    assert.deepEqual(validateThreadResumeState({ rows, parts }), {
      completedRows: rows,
      nextSequenceNumber: 4,
      previousPlatformPostId: "last-id",
      rootPlatformPostId: "root-id",
      complete: true,
    });
  });

  for (const [name, rows] of [
    ["sequence gap", [success(1, "root-id"), success(3, "last-id")]],
    ["successful row missing platform id", [success(1, null)]],
    ["content mismatch", [{ ...success(1, "root-id"), postContent: "Root " }]],
    ["uncertain row", [{ ...success(1, null), publishStatus: "uncertain" }]],
    ["duplicate sequence", [success(1, "root-id"), success(1, "duplicate-id")]],
    ["out of range sequence", [success(4, "extra-id")]],
    ["success after unfinished row", [
      { ...success(1, null), publishStatus: "failed" },
      success(2, "reply-id"),
    ]],
  ]) {
    await run(`${name} conflicts`, () => {
      assert.throws(() => validateThreadResumeState({ rows, parts }), { status: 409 });
    });
  }

  await run("progress loading filters ownership and returns ordered mapped rows", async () => {
    const supabase = fakeSupabase([
      persistedRow({ id: "row-3", sequence_number: 3, post_content: "Reply two" }),
      persistedRow({ id: "row-2" }),
      persistedRow({ id: "other", user_id: "other-user" }),
    ]);
    const rows = await loadThreadPublishProgress({ supabase, userId: "user-1", contentOutputId: "output-1" });
    assert.deepEqual(rows.map((row) => row.sequenceNumber), [2, 3]);
    assert.equal(rows[0].creationId, null);
    assert.deepEqual(supabase.calls[0], {
      action: "read",
      filters: [["user_id", "user-1"], ["content_output_id", "output-1"]],
      order: ["sequence_number", { ascending: true }],
    });
  });

  await run("reservation inserts processing progress before publishing", async () => {
    const supabase = fakeSupabase();
    const row = await reserveThreadSequence({ supabase, ...identity });
    assert.equal(row.publishStatus, "processing");
    assert.equal(row.postContent, "Reply one");
    assert.equal(row.parentPublishedPostId, "row-1");
    assert.deepEqual(supabase.rows[0].platform_post_id, null);
    assert.deepEqual(supabase.rows[0].creation_id, null);
    assert.ok(!Number.isNaN(Date.parse(supabase.rows[0].publish_started_at)));
    assert.equal(supabase.calls[1].payload.user_id, "user-1");
    assert.equal(supabase.calls[1].payload.social_account_id, "account-1");
    assert.equal(supabase.calls[1].payload.content_output_id, "output-1");
    assert.equal(supabase.calls[1].payload.sequence_number, 2);
  });

  await run("reservation treats a concurrent sequence insert as a conflict", async () => {
    const supabase = fakeSupabase();
    const originalFrom = supabase.from;
    supabase.from = function (table) {
      const query = originalFrom.call(this, table);
      const insert = query.insert;
      query.insert = function (payload) {
        supabase.failNext("duplicate sequence", "23505");
        return insert.call(this, payload);
      };
      return query;
    };
    await assert.rejects(reserveThreadSequence({ supabase, ...identity }), { status: 409 });
  });

  await run("reservation resets a known failed row even with a container id", async () => {
    const supabase = fakeSupabase([persistedRow({
      publish_status: "failed", status: "failed", creation_id: "old-container",
      publish_error_message: "container processing failed",
    })]);
    const row = await reserveThreadSequence({ supabase, ...identity });
    assert.equal(row.publishStatus, "processing");
    assert.equal(row.creationId, null);
    assert.equal(row.publishErrorMessage, null);
    assert.equal(row.publishFinishedAt, null);
    assert.deepEqual(supabase.calls[1].filters, [
      ["id", "row-2"], ["user_id", "user-1"], ["publish_status", "failed"],
    ]);
  });

  await run("reservation reuses matching processing progress without resetting its container", async () => {
    const supabase = fakeSupabase([persistedRow({ creation_id: "existing-container" })]);
    const row = await reserveThreadSequence({ supabase, ...identity });
    assert.equal(row.id, "row-2");
    assert.equal(row.creationId, "existing-container");
    assert.equal(row.publishStatus, "processing");
    assert.equal(supabase.calls.length, 1);
  });

  for (const [name, overrides] of [
    ["uncertain progress", { publish_status: "uncertain" }],
    ["failed row with platform id", { publish_status: "failed", platform_post_id: "remote-id" }],
    ["mismatched content", { publish_status: "failed", post_content: "Changed" }],
  ]) {
    await run(`reservation refuses ${name}`, async () => {
      const supabase = fakeSupabase([persistedRow(overrides)]);
      await assert.rejects(reserveThreadSequence({ supabase, ...identity }), { status: 409 });
      assert.equal(supabase.calls.length, 1);
    });
  }

  await run("container creation id is persisted on the owned row", async () => {
    const supabase = fakeSupabase([persistedRow()]);
    const row = await recordThreadContainer({ supabase, userId: "user-1", publishedPostId: "row-2", creationId: "container-2" });
    assert.equal(row.creationId, "container-2");
    assert.deepEqual(supabase.calls[0].filters, [["id", "row-2"], ["user_id", "user-1"]]);
  });

  await run("success records platform id and finish times", async () => {
    const supabase = fakeSupabase([persistedRow()]);
    const row = await markThreadSequenceSuccess({
      supabase, userId: "user-1", publishedPostId: "row-2",
      platformPostId: "remote-2", postUrl: "https://threads.net/post/2",
    });
    assert.equal(row.publishStatus, "success");
    assert.equal(row.platformPostId, "remote-2");
    assert.equal(row.postUrl, "https://threads.net/post/2");
    assert.ok(!Number.isNaN(Date.parse(row.publishFinishedAt)));
    assert.equal(row.postedAt, row.publishFinishedAt);
    assert.equal(row.publishErrorMessage, null);
  });

  await run("success cannot be recorded without a confirmed platform id", async () => {
    const supabase = fakeSupabase([persistedRow()]);
    await assert.rejects(markThreadSequenceSuccess({
      supabase, userId: "user-1", publishedPostId: "row-2", platformPostId: null, postUrl: null,
    }), { status: 409 });
    assert.equal(supabase.calls.length, 0);
  });

  for (const status of ["failed", "uncertain"]) {
    await run(`${status} failure records explicit status and error`, async () => {
      const supabase = fakeSupabase([persistedRow()]);
      const row = await markThreadSequenceFailure({
        supabase, userId: "user-1", publishedPostId: "row-2",
        status, errorMessage: "publish rejected",
      });
      assert.equal(row.publishStatus, status);
      assert.equal(row.publishErrorMessage, "publish rejected");
      assert.ok(!Number.isNaN(Date.parse(row.publishFinishedAt)));
    });
  }

  await run("database errors propagate from loading and updates", async () => {
    const supabase = fakeSupabase([persistedRow()]);
    supabase.failNext("database unavailable");
    await assert.rejects(loadThreadPublishProgress({
      supabase, userId: "user-1", contentOutputId: "output-1",
    }), /database unavailable/);
    supabase.failNext("update rejected");
    await assert.rejects(recordThreadContainer({
      supabase, userId: "user-1", publishedPostId: "row-2", creationId: "container-2",
    }), /update rejected/);
  });

  await run("missing updated row is rejected", async () => {
    const supabase = fakeSupabase([persistedRow()]);
    supabase.emptyNextUpdate();
    await assert.rejects(markThreadSequenceSuccess({
      supabase, userId: "user-1", publishedPostId: "row-2",
      platformPostId: "remote-2", postUrl: null,
    }), { status: 409 });
  });
}

main();
