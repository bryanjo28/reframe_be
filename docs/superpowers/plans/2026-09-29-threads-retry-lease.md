# Threads Partial Retry and Job Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Threads auto-post resume safely after partial long-thread failure, block ambiguous duplicate publishes, and recover scheduled jobs that become stale while running.

**Architecture:** Split persistence concerns into a sequence-progress service and a scheduled-job lease service, while retaining orchestration in `threadsPublishService.js`. Persist a sequence reservation before the first external call, expose publish lifecycle callbacks, resume only from a validated successful prefix, and use token-owned heartbeats/finalization for every claimed job.

**Tech Stack:** Node.js CommonJS, Supabase/PostgreSQL, Threads Graph API, Node built-in test assertions, `node-cron`.

**Spec:** `docs/superpowers/specs/2026-09-29-threads-retry-lease-design.md`

## Global Constraints

- Keep long-thread publication strictly sequential.
- Keep `POST /api/threads/auto-post/retry` and its request payload unchanged.
- Never log access tokens or full post content.
- Use `THREADS_JOB_HEARTBEAT_INTERVAL_MS=15000` and `THREADS_JOB_STALE_AFTER_MS=300000` as defaults.
- Never automatically republish a sequence whose remote outcome is uncertain.
- A content output becomes `posted` only when every expected sequence is confirmed successful.
- Do not change content generation, thread splitting rules, or cron frequency.

## Review Focus

- A timeout immediately after `threads_publish` may mean the post is live; test that it becomes `uncertain` and is never automatically retried.
- An existing successful prefix may contain content from an older edit; test that exact `post_content` mismatch returns conflict before any Threads call.
- A worker may lose its lease between two sequence publishes; test that the next ownership check stops the chain before another external call.
- A user may delete content while cron is polling Threads; test that scheduled, claimed, and progress-linked content return HTTP `409`.
- A database finalization update may return no row without an explicit error; test that this is treated as lost ownership/failure rather than success.

---

### Task 1: Persisted Schema Contract and Row Mapping

**Files:**
- Create: `supabase/threads_publish_reliability.sql`
- Modify: `src/services/threadsPublishService.js`
- Test: `test/threadsPublishChain.test.js`

**Interfaces:**
- Produces: `mapPublishedPostRow(row)` fields `creationId`, `publishStatus`, `publishErrorMessage`, `publishStartedAt`, and `publishFinishedAt`.
- Produces: repository migration matching the schema already deployed by the user.

- [ ] **Step 1: Write failing mapping tests**

Add a test that maps a complete `published_posts` fixture and asserts the five new camelCase fields with literal values.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node test/threadsPublishChain.test.js`

Expected: FAIL because the new mapped fields are undefined.

- [ ] **Step 3: Add the idempotent migration**

Create `supabase/threads_publish_reliability.sql` with the approved `published_posts` progress columns/check/index and `scheduled_jobs` lock columns/partial index. Do not drop or rewrite existing data.

- [ ] **Step 4: Extend `mapPublishedPostRow(row)`**

Map the exact snake_case fields introduced by the migration without changing existing mapped properties.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node test/threadsPublishChain.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/threads_publish_reliability.sql src/services/threadsPublishService.js test/threadsPublishChain.test.js
git commit -m "feat: map Threads publish progress state"
```

### Task 2: Sequence Progress Persistence and Resume Validation

**Files:**
- Create: `src/services/threadsPublishProgressService.js`
- Create: `test/threadsPublishProgress.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Produces: `loadThreadPublishProgress({ supabase, userId, contentOutputId }) -> PublishedPost[]`, ordered by `sequence_number`.
- Produces: `validateThreadResumeState({ rows, parts }) -> { completedRows, nextSequenceNumber, previousPlatformPostId, rootPlatformPostId, complete }` or HTTP `409`.
- Produces: `reserveThreadSequence({ supabase, userId, account, contentOutput, sequenceNumber, content, parentPublishedPostId }) -> PublishedPost`, inserting a missing row or safely resetting a known pre-publish `failed` row.
- Produces: `recordThreadContainer({ supabase, userId, publishedPostId, creationId }) -> PublishedPost`.
- Produces: `markThreadSequenceSuccess({ supabase, userId, publishedPostId, platformPostId, postUrl }) -> PublishedPost`.
- Produces: `markThreadSequenceFailure({ supabase, userId, publishedPostId, status, errorMessage }) -> PublishedPost`, where status is `failed` or `uncertain`.

- [ ] **Step 1: Write failing validation tests**

Test literal fixtures for: empty progress starts at 1; sequences 1–2 successful resume at 3 with sequence 2 platform ID; all sequences successful report complete; a gap fails `409`; missing successful platform ID fails `409`; content mismatch fails `409`; any `uncertain` row fails `409`.

- [ ] **Step 2: Run the new test and verify RED**

Run: `node test/threadsPublishProgress.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure resume validation**

Implement `validateThreadResumeState` without database access. Require a contiguous prefix, exact content equality, valid sequence range, and confirmed platform IDs.

- [ ] **Step 4: Run validation tests and verify GREEN**

Run: `node test/threadsPublishProgress.test.js`

Expected: validation cases pass.

- [ ] **Step 5: Write failing persistence tests**

Using focused Supabase query doubles, assert ordered loading, reservation values, container persistence, success timestamps/status, explicit failure, ambiguous failure, and propagation of database errors or empty update results.

- [ ] **Step 6: Run persistence tests and verify RED**

Run: `node test/threadsPublishProgress.test.js`

Expected: FAIL on the first unimplemented persistence operation.

- [ ] **Step 7: Implement progress persistence functions**

Use the existing `(content_output_id, sequence_number)` unique index as the reservation boundary. Every update must filter by `user_id`, return the updated row, and reject missing rows.

- [ ] **Step 8: Run progress tests and verify GREEN**

Run: `node test/threadsPublishProgress.test.js`

Expected: all progress tests pass.

- [ ] **Step 9: Register the test and commit**

```bash
git add src/services/threadsPublishProgressService.js test/threadsPublishProgress.test.js test/run-tests.js
git commit -m "feat: persist and validate Threads sequence progress"
```

### Task 3: Publish Lifecycle and Strict Platform IDs

**Files:**
- Modify: `src/services/threadsPublishService.js`
- Modify: `test/threadsContainerPolling.test.js`
- Modify: `test/threadsPublishChain.test.js`

**Interfaces:**
- Produces: `publishTextThread({ ..., onContainerCreated, onPublishStarted })` lifecycle callbacks.
- Consumes: callback implementations may persist state and may reject; rejection stops before the next external phase.
- Produces: a confirmed `platformPostId`; absence is an ambiguous HTTP `502` error and never falls back to `creationId`.

- [ ] **Step 1: Write failing lifecycle tests**

Assert ordering with literal events: container API response, awaited `onContainerCreated`, polling, awaited `onPublishStarted`, publish API request, confirmed post ID. Assert that callback rejection prevents the next API request.

- [ ] **Step 2: Write the missing-ID regression test**

Return a successful publish response without `id`, `post_id`, or `creation_id` and assert rejection instead of a container-ID fallback.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node test/threadsPublishChain.test.js`

Expected: FAIL because callbacks are absent and missing ID still falls back.

- [ ] **Step 4: Implement the lifecycle callbacks and strict response validation**

Invoke and await `onContainerCreated({ creationId, rawCreationResponse })` immediately after creation validation. Invoke and await `onPublishStarted({ creationId })` immediately before `threads_publish`. Require an actual post ID from the publish response.

- [ ] **Step 5: Run Threads publish tests and verify GREEN**

Run: `node test/threadsPublishChain.test.js`

Run: `node test/threadsContainerPolling.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/threadsPublishService.js test/threadsPublishChain.test.js test/threadsContainerPolling.test.js
git commit -m "feat: expose reliable Threads publish lifecycle"
```

### Task 4: Resume-Aware Sequential Chain

**Files:**
- Modify: `src/services/threadsPublishService.js`
- Modify: `test/threadsPublishChain.test.js`

**Interfaces:**
- Consumes: progress functions from Task 2 and lifecycle callbacks from Task 3.
- Produces: `publishAndPersistThreadChain` that resumes from a validated prefix and returns the complete persisted chain, including previously successful rows.
- Produces: optional `assertLeaseOwnership()` callback invoked before every new external publish.

- [ ] **Step 1: Write failing partial-resume tests**

Test a three-part chain with persisted successful sequences 1–2. Assert only sequence 3 reaches `publishTextThread`, its `replyToId` is sequence 2's platform ID, and the returned root ID comes from sequence 1.

- [ ] **Step 2: Write failing no-op reconciliation test**

With all three rows successful, assert zero Threads API calls and a complete result containing all persisted rows.

- [ ] **Step 3: Write failing failure-classification tests**

Assert explicit errors before `onPublishStarted` mark `failed`; errors after `onPublishStarted`, missing publish IDs, and transport failures mark `uncertain`; uncertain state stops later sequence calls.

- [ ] **Step 4: Write failing ownership test**

Make `assertLeaseOwnership` reject before sequence 2 and assert sequence 2 never calls the Threads API.

- [ ] **Step 5: Run focused tests and verify RED**

Run: `node test/threadsPublishChain.test.js`

Expected: FAIL because existing orchestration always starts at sequence 1.

- [ ] **Step 6: Implement resume-aware orchestration**

Parse all parts first, load and validate progress, preload successful rows, and loop sequentially from `nextSequenceNumber`. Reserve before container creation, persist container through `onContainerCreated`, flag ambiguity through `onPublishStarted`, and update the same reserved row after confirmed publish.

- [ ] **Step 7: Preserve logging and completion semantics**

Add `[Threads Chain] resumed`, `sequence reserved`, `container persisted`, and `uncertain` logs. Emit `completed` only after every expected persisted row is successful.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run: `node test/threadsPublishChain.test.js`

Expected: all chain tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/services/threadsPublishService.js test/threadsPublishChain.test.js
git commit -m "feat: resume partial Threads reply chains"
```

### Task 5: Delete Protection During Scheduling and Publishing

**Files:**
- Modify: `src/services/contentOutputsService.js`
- Create: `test/contentOutputsDeletion.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Produces: `deleteContentOutput` returning HTTP `409` when the row has `publish_scheduled_job_id`, `publish_scheduled_job_run_id`, or any associated publish-progress row.

- [ ] **Step 1: Write failing delete-protection tests**

Test scheduled-only, claimed, processing, successful, and uncertain fixtures. Each must reject with `409`. Preserve deletion for an unscheduled draft with no progress rows.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node test/contentOutputsDeletion.test.js`

Expected: FAIL because scheduled and claimed outputs are currently deletable.

- [ ] **Step 3: Extend deletion preflight and selection**

Select the two publish scheduling IDs with the existing row. Reject immediately when either is set, then query `published_posts` for existence before deletion and reject when any row exists.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node test/contentOutputsDeletion.test.js`

Expected: all delete tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/contentOutputsService.js test/contentOutputsDeletion.test.js test/run-tests.js
git commit -m "fix: protect content while Threads publish is active"
```

### Task 6: Token-Owned Job Lease and Heartbeat

**Files:**
- Create: `src/services/threadsJobLeaseService.js`
- Create: `test/threadsJobLease.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Produces: `claimThreadsJob({ supabase, userId, scheduledJobId, now }) -> { job, lockToken } | null`.
- Produces: `heartbeatThreadsJob({ supabase, userId, scheduledJobId, lockToken, now }) -> job`, rejecting lost ownership.
- Produces: `assertThreadsJobOwnership({ supabase, userId, scheduledJobId, lockToken }) -> job`, rejecting lost ownership.
- Produces: `finalizeThreadsJob({ supabase, userId, scheduledJobId, lockToken, payload }) -> job`, clearing lock fields and rejecting errors/empty results.
- Produces: `startThreadsJobHeartbeat({ ..., intervalMs }) -> { stop(): Promise<void>, getFailure(): Error | null }` so the runner can observe asynchronous ownership loss.

- [ ] **Step 1: Write failing atomic-claim tests**

Assert claim writes `running`, UUID token, and identical ISO timestamps for `locked_at`/`heartbeat_at`, with an `active` status predicate. Assert an already-claimed result returns null.

- [ ] **Step 2: Write failing ownership/finalization tests**

Assert heartbeat and finalization include the exact lock token predicate. Database errors and empty rows must reject. Finalization clears `lock_token`, `locked_at`, and `heartbeat_at`.

- [ ] **Step 3: Write failing heartbeat lifecycle tests**

Using injected timer functions, assert periodic heartbeat, idempotent stop, timer cleanup, and propagation of ownership loss to the job runner.

- [ ] **Step 4: Run lease tests and verify RED**

Run: `node test/threadsJobLease.test.js`

Expected: FAIL because the lease module does not exist.

- [ ] **Step 5: Implement lease functions**

Use `crypto.randomUUID()` for tokens. Validate positive interval configuration and keep timer injection test-only through function parameters.

- [ ] **Step 6: Run lease tests and verify GREEN**

Run: `node test/threadsJobLease.test.js`

Expected: all lease tests pass.

- [ ] **Step 7: Register the test and commit**

```bash
git add src/services/threadsJobLeaseService.js test/threadsJobLease.test.js test/run-tests.js
git commit -m "feat: add token-owned Threads job leases"
```

### Task 7: Stale Recovery and Reliable Job Finalization

**Files:**
- Modify: `src/services/threadsPublishService.js`
- Modify: `src/services/cronService.js`
- Create: `test/threadsScheduledJobReliability.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Consumes: all lease functions from Task 6.
- Produces: `recoverStaleThreadsJobs({ supabase, staleBefore }) -> RecoverySummary`.
- Produces: `runScheduledThreadsJob` that stops its heartbeat in `finally`, verifies ownership before each sequence, and finalizes through `finalizeThreadsJob`.

- [ ] **Step 1: Write failing stale-recovery tests**

Test that only `threads_auto_post` jobs with `status=running` and heartbeat older than the literal cutoff become `failed`. Assert linked running job runs and claimed content outputs become failed, while fresh jobs remain untouched and no publish function is called.

- [ ] **Step 2: Write failing runner cleanup tests**

Assert heartbeat stops after success, publish failure, run-creation failure, and finalization failure. Assert direct API invocation and cron invocation use identical cleanup semantics.

- [ ] **Step 3: Write failing finalization-error tests**

Assert scheduled-job update errors, empty ownership-matched updates, content claim errors, and content status update errors appear in result/failure state and are never reported as successful completion.

- [ ] **Step 4: Run reliability tests and verify RED**

Run: `node test/threadsScheduledJobReliability.test.js`

Expected: FAIL because recovery and lease-driven runner behavior are absent.

- [ ] **Step 5: Integrate lease ownership into the job runner**

Replace the local claim helper with Task 6's claim, start heartbeat after claim, pass ownership assertion into sequence orchestration, finalize with the token, and stop heartbeat in `finally`.

- [ ] **Step 6: Implement stale recovery before cron due-job fetch**

Use the configured stale cutoff, finalize stale state as failed, and never automatically change stale jobs back to active. Log identifiers and state only.

- [ ] **Step 7: Make finalization failures observable**

Check every Supabase result involved in content/job/run terminal status. Preserve original errors while reporting secondary cleanup failures in logs and run result details.

- [ ] **Step 8: Run reliability tests and verify GREEN**

Run: `node test/threadsScheduledJobReliability.test.js`

Expected: all reliability tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/services/threadsPublishService.js src/services/cronService.js test/threadsScheduledJobReliability.test.js test/run-tests.js
git commit -m "fix: recover stale Threads jobs safely"
```

### Task 8: Full Regression Verification

**Files:**
- Modify only if a verified regression requires a scoped correction.

**Interfaces:**
- Consumes: completed implementation from Tasks 1–7.
- Produces: verified short-thread, long-thread, retry, polling, deletion, and lease behavior.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check src/services/threadsPublishService.js
node --check src/services/threadsPublishProgressService.js
node --check src/services/threadsJobLeaseService.js
node --check src/services/cronService.js
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run the full test suite**

Run: `npm.cmd test`

Expected: exit `0` with no failed tests.

- [ ] **Step 3: Inspect repository integrity**

Run: `git diff --check` and inspect `git status --short`.

Expected: no whitespace errors and only intended files changed.

- [ ] **Step 4: Review mutation cases**

Confirm tests fail if any of these are intentionally removed: successful-prefix skip, uncertain-state block, strict platform ID, lock-token predicate, heartbeat cleanup, stale cutoff, delete guard, or final update error check.

- [ ] **Step 5: Request whole-branch code review**

Provide the reviewer the spec, plan, base SHA, and head SHA. Resolve all Critical and Important findings.

- [ ] **Step 6: Final verification commit**

```bash
git add src test supabase docs/superpowers/plans/2026-09-29-threads-retry-lease.md
git commit -m "test: verify reliable Threads retry workflow"
```

