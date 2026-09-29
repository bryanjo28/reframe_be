const assert = require("node:assert/strict");

const {
  publishAndPersistThreadChain,
  publishTextThread,
  publishThreadChain,
  savePublishedPost,
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

const chainParts = ["Root", "Reply one", "Reply two"];
function progressRow(sequence, overrides = {}) {
  return {
    id: `published-${sequence}`, user_id: "user-1", social_account_id: "account-1",
    content_output_id: "output-1", platform: "threads", sequence_number: sequence,
    post_content: chainParts[sequence - 1], platform_post_id: `post-${sequence}`,
    parent_published_post_id: sequence === 1 ? null : `published-${sequence - 1}`,
    publish_status: "success", status: "success", creation_id: `container-${sequence}`,
    ...overrides,
  };
}

// Keep the real progress service; replace only its database transport.
function progressDatabase(initialRows = [], beforeWrite = async () => {}) {
  const rows = initialRows.map((row) => ({ ...row }));
  return {
    rows,
    from(table) {
      assert.equal(table, "published_posts");
      let action = "read";
      let payload;
      const filters = [];
      const matches = (row) => filters.every(([key, value]) => row[key] === value);
      return {
        select() { return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        insert(value) { action = "insert"; payload = value; return this; },
        update(value) { action = "update"; payload = value; return this; },
        async order() {
          return { data: rows.filter(matches).map((row) => ({ ...row })), error: null };
        },
        async single() { return this.maybeSingle(); },
        async maybeSingle() {
          if (action !== "read") {
            const error = await beforeWrite(payload);
            if (error) return { data: null, error };
          }
          let row = rows.find(matches);
          if (action === "insert") {
            row = { id: `published-${rows.length + 1}`, ...payload };
            rows.push(row);
          } else if (action === "update" && row) Object.assign(row, payload);
          return { data: row ? { ...row } : null, error: null };
        },
      };
    },
  };
}

function chainInput(supabase, requestApi, extra = {}) {
  const publishPart = (input) => publishTextThread({ ...input, requestApi });
  return {
    supabase, userId: "user-1",
    account: { id: "account-1", accessToken: "secret-token", threadsId: "threads-user", accountId: "username" },
    contentOutput: { id: "output-1", content: chainParts.join("---THREAD_SPLIT---"), thread_type: "long" },
    publishPart,
    // Exercise either orchestration version without any live API requests.
    publishChain: (input) => publishThreadChain({ ...input, publishPart }),
    ...extra,
  };
}

function successfulApi(calls) {
  let sequence = 0;
  return async (path, options) => {
    calls.push({ path, options });
    if (path === "threads-user/threads") {
      sequence = chainParts.indexOf(options.params.text) + 1;
      return { id: `container-${sequence}` };
    }
    if (path === "threads-user/threads_publish") return { id: `post-${sequence}` };
    sequence = Number(path.split("-").at(-1));
    return { id: path, status: "FINISHED" };
  };
}

async function main() {
  await run("publishThreadChain publishes root and replies sequentially", async () => {
    const calls = [];
    const logs = [];
    const originalLog = console.log;
    let inFlight = 0;
    let maxInFlight = 0;
    const platformIds = ["root-id", "reply-1-id", "reply-2-id"];

    console.log = (message, details) => logs.push({ message, details });
    let result;
    try {
      result = await publishThreadChain({
        accessToken: "token",
        threadsId: "threads-user",
        content:
          "Root---THREAD_SPLIT---Reply one---THREAD_SPLIT---Reply two",
        threadType: "long",
        publishPart: async (input) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          calls.push(input);
          await Promise.resolve();
          inFlight -= 1;
          return { platformPostId: platformIds[calls.length - 1] };
        },
      });
    } finally {
      console.log = originalLog;
    }

    assert.equal(maxInFlight, 1);
    assert.deepEqual(
      calls.map((call) => call.replyToId),
      [null, "root-id", "reply-1-id"]
    );
    assert.equal(result.rootPlatformPostId, "root-id");
    assert.equal(result.parts.length, 3);
    assert.deepEqual(
      logs
        .filter(({ message }) => message === "[Threads Chain] sequence published")
        .map(({ details }) => details.sequenceNumber),
      [1, 2, 3]
    );
    assert.equal(logs.at(-1).message, "[Threads Chain] completed");
    assert.equal(logs.at(-1).details.publishedCount, 3);
  });

  await run("publishThreadChain validates every part before API calls", async () => {
    let publishCalls = 0;

    await assert.rejects(
      publishThreadChain({
        accessToken: "token",
        threadsId: "threads-user",
        content: `Root---THREAD_SPLIT---${"x".repeat(501)}`,
        threadType: "long",
        publishPart: async () => {
          publishCalls += 1;
          return { platformPostId: "unexpected" };
        },
      }),
      { status: 400, message: "Each Threads post must not exceed 500 characters" }
    );

    assert.equal(publishCalls, 0);
  });

  await run("publishTextThread sends reply_to_id when publishing a reply", async () => {
    const requests = [];
    const responses = [
      { id: "container-id" },
      { id: "container-id", status: "FINISHED" },
      { id: "reply-id" },
    ];
    const result = await publishTextThread({
      accessToken: "token",
      threadsId: "threads-user",
      content: "Reply text",
      replyToId: "parent-platform-id",
      requestApi: async (path, options) => {
        requests.push({ path, options });
        return responses.shift();
      },
    });

    assert.equal(requests[0].options.params.reply_to_id, "parent-platform-id");
    assert.deepEqual(
      requests.map((request) => request.path),
      [
        "threads-user/threads",
        "container-id",
        "threads-user/threads_publish",
      ]
    );
    assert.equal(requests[1].options.params.fields, "id,status,error_message");
    assert.equal(requests[2].options.params.creation_id, "container-id");
    assert.equal(result.platformPostId, "reply-id");
  });

  await run("publishTextThread awaits lifecycle callbacks at the API boundaries", async () => {
    const events = [];
    const creationResponse = { id: "container-1" };
    const result = await publishTextThread({
      accessToken: "token",
      threadsId: "threads-user",
      content: "Post text",
      onContainerCreated: async (event) => {
        assert.deepEqual(event, {
          creationId: "container-1",
          rawCreationResponse: creationResponse,
        });
        await Promise.resolve();
        events.push("container persisted");
      },
      onPublishStarted: async (event) => {
        assert.deepEqual(event, { creationId: "container-1" });
        await Promise.resolve();
        events.push("publish started persisted");
      },
      requestApi: async (path) => {
        if (path === "threads-user/threads") {
          events.push("container API response");
          return creationResponse;
        }
        if (path === "container-1") {
          events.push("polling");
          return { id: "container-1", status: "FINISHED" };
        }
        assert.equal(path, "threads-user/threads_publish");
        events.push("publish API request");
        return { id: "post-1" };
      },
    });

    events.push("confirmed post ID");
    assert.deepEqual(events, [
      "container API response",
      "container persisted",
      "polling",
      "publish started persisted",
      "publish API request",
      "confirmed post ID",
    ]);
    assert.equal(result.platformPostId, "post-1");
  });

  await run("publishTextThread stops before polling when container callback rejects", async () => {
    const paths = [];
    await assert.rejects(
      publishTextThread({
        accessToken: "token",
        threadsId: "threads-user",
        content: "Post text",
        onContainerCreated: async () => {
          throw new Error("container persistence failed");
        },
        requestApi: async (path) => {
          paths.push(path);
          return path === "container-1"
            ? { id: "container-1", status: "FINISHED" }
            : { id: "container-1" };
        },
      }),
      { message: "container persistence failed" }
    );
    assert.deepEqual(paths, ["threads-user/threads"]);
  });

  await run("publishTextThread stops before publishing when publish callback rejects", async () => {
    const paths = [];
    await assert.rejects(
      publishTextThread({
        accessToken: "token",
        threadsId: "threads-user",
        content: "Post text",
        onPublishStarted: async () => {
          throw new Error("publish state persistence failed");
        },
        requestApi: async (path) => {
          paths.push(path);
          return path === "container-1"
            ? { id: "container-1", status: "FINISHED" }
            : { id: "container-1" };
        },
      }),
      { message: "publish state persistence failed" }
    );
    assert.deepEqual(paths, ["threads-user/threads", "container-1"]);
  });

  await run("publishTextThread rejects publish responses without a platform post ID", async () => {
    const responses = [
      { id: "container-1" },
      { id: "container-1", status: "FINISHED" },
      { success: true },
    ];
    await assert.rejects(
      publishTextThread({
        accessToken: "token",
        threadsId: "threads-user",
        content: "Post text",
        requestApi: async () => responses.shift(),
      }),
      (error) => {
        assert.equal(error.status, 502);
        assert.match(error.message, /post id/i);
        return true;
      }
    );
  });

  await run("savePublishedPost persists sequence, content, and internal parent id", async () => {
    let insertedPayload = null;
    const supabase = {
      from(table) {
        assert.equal(table, "published_posts");
        return {
          insert(payload) {
            insertedPayload = payload;
            return this;
          },
          select() {
            return this;
          },
          async single() {
            return { data: { id: "published-2", ...insertedPayload }, error: null };
          },
        };
      },
    };

    const result = await savePublishedPost({
      supabase,
      userId: "user-1",
      socialAccountId: "account-1",
      contentOutputId: "output-1",
      platformPostId: "reply-platform-id",
      postUrl: "https://threads.net/reply",
      parentPublishedPostId: "published-1",
      sequenceNumber: 2,
      postContent: "Reply content",
    });

    assert.equal(insertedPayload.parent_published_post_id, "published-1");
    assert.equal(insertedPayload.sequence_number, 2);
    assert.equal(insertedPayload.post_content, "Reply content");
    assert.equal(result.parentPublishedPostId, "published-1");
    assert.equal(result.sequenceNumber, 2);
  });

  await run("savePublishedPost maps persisted publish progress fields", async () => {
    const row = {
      id: "published-2",
      user_id: "user-1",
      social_account_id: "account-1",
      content_output_id: "output-1",
      platform: "threads",
      platform_post_id: "reply-platform-id",
      post_url: "https://threads.net/reply",
      posted_at: "2026-09-29T08:01:00.000Z",
      status: "success",
      error_message: null,
      parent_published_post_id: "published-1",
      sequence_number: 2,
      post_content: "Reply content",
      created_at: "2026-09-29T08:00:00.000Z",
      creation_id: "container-2",
      publish_status: "success",
      publish_error_message: null,
      publish_started_at: "2026-09-29T08:00:30.000Z",
      publish_finished_at: "2026-09-29T08:01:00.000Z",
    };
    const supabase = {
      from(table) {
        assert.equal(table, "published_posts");
        return {
          insert() { return this; },
          select() { return this; },
          async single() { return { data: row, error: null }; },
        };
      },
    };

    const result = await savePublishedPost({
      supabase,
      userId: "user-1",
      socialAccountId: "account-1",
      contentOutputId: "output-1",
      platformPostId: "reply-platform-id",
      postUrl: "https://threads.net/reply",
    });

    assert.equal(result.creationId, "container-2");
    assert.equal(result.publishStatus, "success");
    assert.equal(result.publishErrorMessage, null);
    assert.equal(result.publishStartedAt, "2026-09-29T08:00:30.000Z");
    assert.equal(result.publishFinishedAt, "2026-09-29T08:01:00.000Z");
  });

  await run("persisted successful prefix resumes only sequence 3 and returns the complete chain", async () => {
    const db = progressDatabase([progressRow(1), progressRow(2)]);
    const calls = [];
    const result = await publishAndPersistThreadChain(chainInput(db, successfulApi(calls)));
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.params.text, "Reply two");
    assert.equal(calls[0].options.params.reply_to_id, "post-2");
    assert.equal(result.rootPlatformPostId, "post-1");
    assert.equal(result.rootPublishedPost.id, "published-1");
    assert.deepEqual(result.publishedPosts.map((row) => row.id), ["published-1", "published-2", "published-3"]);
    assert.deepEqual(result.parts.map((part) => part.platformPostId), ["post-1", "post-2", "post-3"]);
    assert.equal(db.rows[2].parent_published_post_id, "published-2");
    assert.equal(db.rows[2].publish_status, "success");
  });

  await run("all-success reconciliation makes zero API calls", async () => {
    const db = progressDatabase([progressRow(1), progressRow(2), progressRow(3)]);
    const calls = [];
    const result = await publishAndPersistThreadChain(chainInput(db, successfulApi(calls)));
    assert.equal(calls.length, 0);
    assert.equal(result.publishedPosts.length, 3);
    assert.equal(result.parts.length, 3);
    assert.equal(result.rootPlatformPostId, "post-1");
  });

  for (const creationId of [null, "container-1"]) {
    await run(`processing sequence safely resumes with container ${creationId}`, async () => {
      const db = progressDatabase([progressRow(1, { publish_status: "processing", status: "processing", platform_post_id: null, creation_id: creationId })]);
      const calls = [];
      await publishAndPersistThreadChain(chainInput(db, successfulApi(calls)));
      assert.equal(calls.filter((call) => call.path === "threads-user/threads").length, creationId ? 2 : 3);
      assert.equal(db.rows.length, 3);
      assert.equal(db.rows[0].id, "published-1");
      assert.equal(db.rows[0].creation_id, "container-1");
      assert.equal(db.rows[0].publish_status, "success");
    });
  }

  await run("failed sequence with a container and no platform ID is reused", async () => {
    const db = progressDatabase([progressRow(1, { publish_status: "failed", status: "failed", platform_post_id: null })]);
    await publishAndPersistThreadChain(chainInput(db, successfulApi([])));
    assert.equal(db.rows.length, 3);
    assert.equal(db.rows[0].id, "published-1");
    assert.equal(db.rows[0].publish_status, "success");
  });

  for (const scenario of [
    { name: "explicit pre-publish rejection", phase: "poll", response: { status: "ERROR" }, status: "failed" },
    { name: "publish rejection", phase: "publish", error: new Error("rejected"), status: "uncertain" },
    { name: "publish transport failure", phase: "publish", error: new TypeError("fetch failed"), status: "uncertain" },
    { name: "missing publish ID", phase: "publish", response: { success: true }, status: "uncertain" },
    { name: "container ID only publish response", phase: "publish", response: { creation_id: "container-1" }, status: "uncertain" },
  ]) {
    await run(`${scenario.name} persists ${scenario.status} and stops the chain`, async () => {
      const db = progressDatabase();
      const calls = [];
      await assert.rejects(publishAndPersistThreadChain(chainInput(db, async (path) => {
        calls.push(path);
        if (path === "threads-user/threads") return { id: "container-1" };
        if (path === "container-1" && scenario.phase !== "poll") return { status: "FINISHED" };
        if (scenario.error) throw scenario.error;
        return scenario.response;
      })));
      assert.equal(db.rows.length, 1);
      assert.equal(db.rows[0].publish_status, scenario.status);
      assert.equal(calls.filter((path) => path === "threads-user/threads").length, 1);
    });
  }

  await run("uncertain and invalid persisted progress stop before external calls", async () => {
    for (const rows of [
      [progressRow(1, { publish_status: "uncertain" })],
      [progressRow(1, { post_content: "changed" })],
      [progressRow(2)],
      [progressRow(1, { publish_status: "failed" })],
    ]) {
      const calls = [];
      await assert.rejects(publishAndPersistThreadChain(chainInput(progressDatabase(rows), successfulApi(calls))), { status: 409 });
      assert.equal(calls.length, 0);
    }
  });

  await run("lease loss before sequence 2 prevents any sequence 2 API calls", async () => {
    const db = progressDatabase();
    const calls = [];
    await assert.rejects(publishAndPersistThreadChain(chainInput(db, successfulApi(calls), {
      assertLeaseOwnership: async () => {
        if (db.rows[0]?.publish_status === "success") throw new Error("lease lost");
      },
    })), { message: "lease lost" });
    assert.equal(calls.length, 3);
    assert.equal(db.rows[0].publish_status, "success");
  });

  await run("lease loss during polling prevents threads_publish", async () => {
    const db = progressDatabase();
    const calls = [];
    let leaseLost = false;
    const api = successfulApi(calls);
    await assert.rejects(publishAndPersistThreadChain(chainInput(db, async (...args) => {
      const result = await api(...args);
      if (args[0] === "container-1") leaseLost = true;
      return result;
    }, {
      assertLeaseOwnership: async () => { if (leaseLost) throw new Error("lease lost"); },
    })), { message: "lease lost" });
    assert.equal(calls.length, 2);
    assert.equal(db.rows[0].publish_status, "failed");
  });

  await run("reservation, container, uncertainty and success are persisted before their dependent external calls", async () => {
    const db = progressDatabase([], async () => { await new Promise((resolve) => setImmediate(resolve)); });
    const calls = [];
    const api = successfulApi(calls);
    await publishAndPersistThreadChain(chainInput(db, async (path, options) => {
      const row = db.rows.at(-1);
      if (path === "threads-user/threads") {
        assert.equal(row.publish_status, "processing");
        assert.ok(db.rows.slice(0, -1).every((previous) => previous.publish_status === "success"));
      } else if (path === "threads-user/threads_publish") {
        assert.equal(row.publish_status, "uncertain");
        assert.equal(row.creation_id, options.params.creation_id);
      } else assert.equal(row.creation_id, path);
      return api(path, options);
    }));
    assert.equal(db.rows.length, 3);
    assert.ok(db.rows.every((row) => row.publish_status === "success"));
  });

  await run("failed success persistence leaves uncertainty and stops later posts without completion logging", async () => {
    const db = progressDatabase([], async (payload) => payload.publish_status === "success" ? { message: "database write failed" } : null);
    const calls = [];
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args);
    try {
      await assert.rejects(publishAndPersistThreadChain(chainInput(db, successfulApi(calls))), { message: "database write failed" });
    } finally { console.log = originalLog; }
    assert.equal(calls.length, 3);
    assert.equal(db.rows[0].publish_status, "uncertain");
    assert.ok(!logs.some(([message]) => message === "[Threads Chain] completed"));
  });
}

main();
