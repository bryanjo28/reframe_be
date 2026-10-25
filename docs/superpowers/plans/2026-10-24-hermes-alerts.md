# Hermes Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver sanitized backend error events to Hermes through a durable Supabase queue.

**Architecture:** A shared reporter writes an outbox; cron claims and sends bounded batches. SQL handles concurrent enqueue/claim, and HMAC authenticates exact request bytes.

**Tech Stack:** Existing Node.js CommonJS, node:crypto, fetch, Supabase PostgreSQL, PGlite tests; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-hermes-alerts-design.md`

## Global Constraints

User refinement approved at execution: keep the initial scope simple and critical. Capture API 5xx, Threads connection/reconnect and scheduled publish failures, and thrown cron failures. Defer generation summaries, reconciliation-specific reporting and process-global crash handling. Work stays in the existing feature checkout (`demo_flow_v2`) for direct IDE review; no commits, deployment or live migration.

- Delivery defaults to disabled until configured.
- No credentials, content text, request bodies, arbitrary metadata, or raw API responses are sent.
- Reporting must not change publishing outcomes or automatically retry uncertain Threads posts.
- No live migration, deployment, or Hermes/Telegram messages during implementation.

## Review Focus

- Overlapping cron workers must not complete another worker's claim.
- A worker dying after remote acceptance can cause redelivery with the same event ID.
- Database/receiver failure must preserve the original API/job result.
- Credentials embedded in error messages must be removed before persistence.
- Handled job failures must alert even when the job function does not throw.

### Task 1: Durable queue and reporter

**Files:** Create `supabase/hermes_alert_outbox.sql`, `src/services/errorAlertService.js`, `test/errorAlertQueue.test.js`, `test/errorAlertService.test.js`.

**Interfaces:** `reportError({source, error, context}, dependencies?)` returns a bounded promise and never throws to callers. `dispatchErrorAlerts(dependencies?)` drains a bounded batch. Dependencies support controlled DB, fetch, clock and configuration in tests.

- [ ] Write failing SQL tests for atomic deduplication, occurrence updates, lease ownership, stale recovery and service-role access restrictions.
- [ ] Run `node test/errorAlertQueue.test.js`; confirm missing migration fails.
- [ ] Implement table and enqueue/claim functions matching the design, with fixed search_path, explicit grants, RLS and indexes.
- [ ] Write failing service tests for disabled/misconfigured settings, secret redaction and context allowlisting, persistence errors, stable IDs, HTTP failures/timeouts, five-attempt limit and exact HMAC bytes.
- [ ] Run `node test/errorAlertService.test.js`; confirm missing service fails.
- [ ] Implement configuration, reporter and dispatcher. Reject redirects, bound HTTP/DB operations, and never log receiver bodies or credentials. Drain sequentially, using token-guarded acknowledgements and retry scheduling.
- [ ] Run both test files; all assertions must pass.

### Task 2: Failure capture and cron delivery

**Files:** Modify `src/middlewares/errorHandler.js`, `src/services/threadsPublishService.js`, `src/services/cronService.js`, `scripts/run-scheduled-jobs.js`; create `test/errorAlertIntegration.test.js`.

**Interfaces:** Call the reporter from Task 1 at existing failure boundaries. Call dispatcher independently of whether any content job is due; flush at cron completion using finally so early returns do not skip delivery.

- [ ] Write failing integration tests for 5xx reporting, ordinary 4xx exclusion, handled Threads failure/uncertainty, generation returned failures, cron query/reconciliation errors, empty cron runs and reporter rejection isolation.
- [ ] Confirm the integration test fails due to absent hooks.
- [ ] Add reporting without changing HTTP responses, job counters, cancellation semantics or retry behavior. Await bounded persistence at job boundaries and before short-lived cron process exit.
- [ ] Ensure cron entry-point errors are reported once and attempt bounded delivery before setting failure exit code; no recursive alerts for dispatcher errors.
- [ ] Run the integration test and existing Threads/cron/error-handler tests; confirm unchanged behavior.

### Task 3: Setup documentation and final verification

**Files:** Create `docs/hermes-alerts.md`; update existing environment example if present and `package.json` to include new tests.

- [ ] Document manual migration, opt-in settings, cron prerequisite, payload, raw-body HMAC verification, five-minute timestamp tolerance, receiver deduplication, retries and failed-row inspection.
- [ ] Leave real `.env` secrets and live database unchanged. Provide placeholders only.
- [ ] Run new tests, relevant existing tests and `npm test`. Record failures by name and cause.
- [ ] Review diff for unauthorized fields, network sends while disabled, response regressions and lease races. Run `git diff --check`.

## Execution

Approved execution: native implementation in this session. Implemented queue, signed sender and critical error hooks; migration and webhook activation remain manual. Test coverage includes SQL lease recovery/ownership and retry limits, reporter redaction and failure isolation, signed delivery, OAuth errors, API status exclusions and idle-cron delivery. Full npm test and focused tests passed before final review. Reviewer checks the whole diff.
