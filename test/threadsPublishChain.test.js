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

  await run("publishAndPersistThreadChain links database rows and returns root id", async () => {
    const insertedRows = [];
    const supabase = {
      from() {
        return {
          insert(payload) {
            this.payload = payload;
            return this;
          },
          select() {
            return this;
          },
          async single() {
            const row = {
              id: `published-${insertedRows.length + 1}`,
              ...this.payload,
            };
            insertedRows.push(row);
            return { data: row, error: null };
          },
        };
      },
    };
    const publishChain = async ({ onPartPublished }) => {
      const parts = [
        { sequenceNumber: 1, content: "Root", platformPostId: "root-id" },
        { sequenceNumber: 2, content: "Reply", platformPostId: "reply-id" },
      ];
      for (const part of parts) await onPartPublished(part);
      return { rootPlatformPostId: "root-id", parts };
    };

    const result = await publishAndPersistThreadChain({
      supabase,
      userId: "user-1",
      account: {
        id: "account-1",
        accessToken: "token",
        threadsId: "threads-user",
        accountId: "username",
      },
      contentOutput: {
        id: "output-1",
        content: "Root---THREAD_SPLIT---Reply",
        thread_type: "long",
      },
      publishChain,
    });

    assert.equal(insertedRows[0].parent_published_post_id, null);
    assert.equal(insertedRows[1].parent_published_post_id, "published-1");
    assert.equal(result.rootPlatformPostId, "root-id");
    assert.equal(result.publishedPosts.length, 2);
  });
}

main();
