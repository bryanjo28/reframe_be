const assert = require("node:assert/strict");

const {
  buildContentOutputInsertPayload,
  buildContentOutputUserPrompt,
  mapContentOutputRow,
  parseThreadParts,
  resolveContentOutputThreadType,
} = require("../src/services/contentOutputsService");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function buildPrompt(threadType) {
  return buildContentOutputUserPrompt({
    persona: {},
    topic: {},
    contentPillar: { threadType },
    promptTemplate: null,
    promptContext: {},
    sourceContentOutput: null,
  });
}

run("short thread prompt limits the complete output to 450 characters", () => {
  const prompt = buildPrompt("short");

  assert.match(prompt, /satu short thread/i);
  assert.match(prompt, /maksimal 450 karakter/i);
  assert.match(prompt, /jangan membuat reply lanjutan/i);
});

run("long thread prompt limits every post in the reply chain to 450 characters", () => {
  const prompt = buildPrompt("long");

  assert.match(prompt, /post utama dan beberapa reply/i);
  assert.match(prompt, /setiap bagian maksimal 450 karakter/i);
  assert.match(prompt, /---THREAD_SPLIT---/);
});

run("content output mapping exposes the persisted thread type", () => {
  const result = mapContentOutputRow({
    id: "output-1",
    thread_type: "long",
  });

  assert.equal(result.threadType, "long");
});

run("content output insert snapshots thread type with a short default", () => {
  const longPayload = buildContentOutputInsertPayload({
    userId: "user-1",
    input: {
      personaConfigId: "persona-1",
      content: "content",
      threadType: "long",
    },
  });
  const defaultPayload = buildContentOutputInsertPayload({
    userId: "user-1",
    input: {
      personaConfigId: "persona-1",
      content: "content",
    },
  });

  assert.equal(longPayload.thread_type, "long");
  assert.equal(defaultPayload.thread_type, "short");
});

run("content pillar thread type wins when snapshotting a content output", () => {
  assert.equal(
    resolveContentOutputThreadType(
      { threadType: "long" },
      { threadType: "short" }
    ),
    "long"
  );
  assert.equal(resolveContentOutputThreadType(null, {}), "short");
});

run("parseThreadParts keeps short content as one post", () => {
  assert.deepEqual(parseThreadParts("  One short post  ", "short"), [
    "One short post",
  ]);
});

run("parseThreadParts splits long content and removes empty segments", () => {
  assert.deepEqual(
    parseThreadParts(
      "Root post\n---THREAD_SPLIT---\n\n---THREAD_SPLIT---\nReply post",
      "long"
    ),
    ["Root post", "Reply post"]
  );
});

run("parseThreadParts rejects content exceeding the Threads hard limit", () => {
  assert.throws(() => parseThreadParts("x".repeat(501), "short"), {
    status: 400,
    message: "Each Threads post must not exceed 500 characters",
  });
});

run("parseThreadParts rejects empty content", () => {
  assert.throws(() => parseThreadParts(" ---THREAD_SPLIT--- ", "long"), {
    status: 400,
    message: "Thread content is empty",
  });
});
