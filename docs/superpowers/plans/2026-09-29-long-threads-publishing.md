# Long Threads Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement long Threads generation and sequential reply-chain publishing through step 4, without partial-retry support.

**Architecture:** Snapshot the pillar's `thread_type` onto each content output, parse generated long content into delimiter-separated parts, and publish those parts sequentially using the prior platform post ID as `reply_to_id`. Persist every successful root/reply in `published_posts`, while keeping the root Threads ID in `content_outputs.external_post_id`.

**Tech Stack:** Node.js CommonJS, Supabase/PostgreSQL, Threads Graph API, Node assert tests.

**Spec:** Conversation-approved design from 2026-09-29; implementation is explicitly limited to steps 1-4 and excludes partial retry/resume.

## Global Constraints

- AI target is 450 characters per post; hard validation limit is 500 characters per post.
- Long output parts use the exact delimiter `---THREAD_SPLIT---`.
- Root posts omit `reply_to_id`; each later post replies to the immediately previous Threads platform post ID.
- `content_outputs.external_post_id` stores only the root Threads post ID.
- Preserve all pre-existing user changes in the dirty worktree.
- Do not implement partial retry/resume in this scope.

## Review Focus

- Empty long-thread segments are removed without changing sequence numbering.
- Any part above 500 characters fails before making a Threads API request.
- Short content containing no delimiter remains one post.
- Reply publication is sequential and never uses `Promise.all`.
- Database rows use internal `published_posts.id` for `parent_published_post_id`, not the Threads platform ID.

---

### Task 1: Content-output thread type snapshot

**Files:**
- Modify: `src/services/contentOutputsService.js`
- Modify: `supabase/full_schema.sql`
- Modify: `supabase/content_pillars_thread_type.sql`
- Test: `test/contentOutputsPrompt.test.js`

**Interfaces:**
- Consumes: `contentPillar.threadType` from `contentPillarsService`.
- Produces: `contentOutput.threadType` mapped from `content_outputs.thread_type` and persisted at generation time.

- [ ] Add failing tests proving content-output mapping/building carries `threadType` and defaults to `short` when the pillar value is absent.
- [ ] Run `node test/contentOutputsPrompt.test.js` and confirm failure because snapshot mapping is missing.
- [ ] Add `thread_type` schema documentation/migration support and minimal mapper/insert changes in `contentOutputsService.js`.
- [ ] Run `node test/contentOutputsPrompt.test.js` and confirm all tests pass.

### Task 2: Parse and validate thread parts

**Files:**
- Modify: `src/services/contentOutputsService.js`
- Test: `test/contentOutputsPrompt.test.js`

**Interfaces:**
- Produces: `parseThreadParts(content, threadType) -> string[]`.
- Consumed by: Task 3 reply-chain publisher.

- [ ] Add failing tests for short content, delimiter-separated long content, empty segments, and a part exceeding 500 characters.
- [ ] Run `node test/contentOutputsPrompt.test.js` and confirm the parser tests fail because the function is missing.
- [ ] Implement and export `parseThreadParts`, trimming parts and rejecting empty output or any part over 500 characters.
- [ ] Run `node test/contentOutputsPrompt.test.js` and confirm all tests pass.

### Task 3: Sequential Threads reply-chain publisher

**Files:**
- Modify: `src/services/threadsPublishService.js`
- Create: `test/threadsPublishChain.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Consumes: `parseThreadParts(content, threadType) -> string[]` from Task 2.
- Produces: `publishThreadChain({ accessToken, threadsId, content, threadType, onPartPublished })` and `publishTextThread({ ..., replyToId })`.

- [ ] Add failing tests proving root omits `reply_to_id`, replies use the immediately previous platform ID, requests are sequential, and over-limit content performs no API request.
- [ ] Run `node test/threadsPublishChain.test.js` and confirm failure because reply-chain publishing is missing.
- [ ] Extend `publishTextThread` with optional `replyToId`, remove silent `.slice(0, 500)`, and implement sequential `publishThreadChain`.
- [ ] Run `node test/threadsPublishChain.test.js` and confirm all tests pass.

### Task 4: Persist root and reply publication rows

**Files:**
- Modify: `src/services/threadsPublishService.js`
- Modify: `supabase/full_schema.sql`
- Modify: `supabase/content_pillars_thread_type.sql`
- Test: `test/threadsPublishChain.test.js`

**Interfaces:**
- Consumes: ordered part results from Task 3.
- Produces: one `published_posts` row per part with `sequence_number`, `post_content`, and internal parent row ID; returns the root platform post ID for `content_outputs.external_post_id`.

- [ ] Add failing tests proving row 1 has no parent, each later row references the prior database row ID, and the content output receives the root platform ID.
- [ ] Run `node test/threadsPublishChain.test.js` and confirm persistence assertions fail.
- [ ] Extend `savePublishedPost`, its mapper, and both manual/scheduled publishing flows to persist every part and mark the content output with the root ID.
- [ ] Run `node test/threadsPublishChain.test.js` and confirm all tests pass.
- [ ] Run `npm.cmd test`, `node --check` on modified service files, and `git diff --check`; all must exit 0.
