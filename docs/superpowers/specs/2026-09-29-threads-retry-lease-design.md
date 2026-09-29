# Threads Partial Retry and Job Lease Design

## Objective

Make Threads auto-post retries safe for partially published long threads and prevent scheduled jobs from remaining permanently locked after a worker crash.

The frontend continues using the existing retry endpoint. Thread parts remain strictly sequential because each reply needs the previous published Threads post ID.

## Scope

This change covers:

- persisted publishing progress for every Threads sequence;
- resume-from-last-success behavior for long-thread retries;
- explicit handling of ambiguous remote publish results;
- ownership and heartbeat for a running scheduled job;
- stale-job detection and safe failure;
- stricter error handling during job finalization.

It does not change content generation, thread splitting rules, scheduler frequency, or the public retry endpoint.

## Existing Schema Additions

The deployed database contains these additions:

### `published_posts`

- `creation_id text`
- `publish_status text not null default 'success'`
- `publish_error_message text`
- `publish_started_at timestamptz`
- `publish_finished_at timestamptz`

Allowed `publish_status` values are `processing`, `success`, `failed`, and `uncertain`.

### `scheduled_jobs`

- `locked_at timestamptz`
- `lock_token uuid`
- `heartbeat_at timestamptz`

The repository will include an idempotent migration matching the deployed schema.

## Sequence State Model

Each `(content_output_id, sequence_number)` remains unique.

Before creating a Threads container, the backend reserves the sequence by inserting or loading its `published_posts` row:

```text
publish_status = processing
platform_post_id = null
creation_id = null
publish_started_at = now
```

After container creation, `creation_id` is written before calling `threads_publish`.

After a confirmed publish response, the same row is updated:

```text
publish_status = success
platform_post_id = Threads post ID
publish_finished_at = now
```

If Threads explicitly rejects container processing or publishing, the row becomes `failed` with `publish_error_message`.

If the publish request may have reached Threads but the backend cannot determine whether it succeeded, the row becomes `uncertain`. An uncertain sequence must never be automatically republished.

## Retry Behavior

The existing endpoint remains:

```http
POST /api/threads/auto-post/retry
```

When retrying, the backend loads all `published_posts` rows for the content output in ascending sequence order.

It validates that:

1. successful rows form a contiguous prefix starting at sequence 1;
2. every successful row has a `platform_post_id`;
3. persisted `post_content` exactly matches the current parsed sequence content;
4. there are no duplicate or out-of-range sequence numbers.

If validation succeeds, publishing resumes from the first unfinished sequence. The last successful `platform_post_id` becomes the next sequence's `reply_to_id`.

If every sequence is already successful, no Threads API publish call is made. The content output is reconciled to `posted` using the root sequence's platform post ID.

If a row is `uncertain`, has mismatched content, or the successful rows contain a gap, automatic retry stops with a conflict error. This favors avoiding duplicate public posts over automatic recovery.

A `failed` row may be reset to `processing` and reused only when the previous failure is known to have occurred before a publish request could succeed remotely. Otherwise it is promoted to `uncertain`.

## Publish Boundary and Ambiguous Errors

The code must distinguish these phases:

1. sequence reserved;
2. container created and `creation_id` persisted;
3. container ready;
4. publish request started;
5. publish response confirmed;
6. platform post ID persisted.

Errors before phase 4 are retryable. Errors during or after phase 4 are ambiguous unless Threads returns an explicit rejection. Ambiguous errors set `publish_status = uncertain` and prevent automatic republishing.

The code must no longer fall back from a missing publish response ID to `creation_id`. A successful publish response without a post ID is treated as ambiguous.

## Scheduled Job Lease

Claiming a Threads scheduled job atomically changes it from `active` to `running` and writes:

```text
lock_token = newly generated UUID
locked_at = now
heartbeat_at = now
```

Only the worker holding the matching `lock_token` may:

- update heartbeat;
- finalize the scheduled job;
- mark the job failed.

The heartbeat runs while the claimed job is active and is always stopped in `finally`.

Configuration:

```env
THREADS_JOB_HEARTBEAT_INTERVAL_MS=15000
THREADS_JOB_STALE_AFTER_MS=300000
```

Invalid or non-positive values fall back to the defaults.

## Stale Job Recovery

Before fetching due jobs, cron checks `running` Threads jobs whose latest `heartbeat_at` is older than the stale threshold.

A stale job is not automatically republished. It is transitioned to `failed`, retaining its lock metadata for diagnostics. Any running `scheduled_job_runs` record is also finalized as failed when identifiable.

Its claimed content output is marked `failed` so the existing frontend retry action can be used. Retry then applies the persisted sequence rules above:

- confirmed successful parts are reused;
- safely retryable parts continue;
- uncertain parts require reconciliation instead of automatic duplication.

This recovery policy deliberately chooses a visible failed state instead of silently taking over work that may still be completing remotely.

## Completion and Failure

A content output becomes `posted` only after all expected sequence rows have `publish_status = success`.

A scheduled job run becomes `completed` only after all selected content outputs finish successfully. Partial failure produces `completed_with_errors`.

All database writes that finalize content outputs, scheduled job runs, or scheduled jobs must inspect and propagate database errors. The service must not report success when final persistence failed.

The final scheduled-job update includes its `lock_token` predicate. If no row is returned, ownership was lost and the worker must not report completion.

## Logging

Logs include identifiers and state transitions but never access tokens or full content:

```text
[Threads Job] claimed
[Threads Job] heartbeat
[Threads Job] stale
[Threads Job] ownership lost
[Threads Chain] resumed
[Threads Chain] sequence reserved
[Threads Chain] container persisted
[Threads Chain] sequence published
[Threads Chain] sequence persisted
[Threads Chain] uncertain
[Threads Chain] completed
```

## Compatibility

- The frontend retry endpoint and payload do not change.
- Existing successful `published_posts` rows remain valid because `publish_status` defaults to `success`.
- Existing short-thread posts use the same mechanism with one sequence.
- Existing rows without `creation_id` remain valid when they already have a `platform_post_id` and successful status.
- Long-thread publication remains sequential.

## Testing

Tests must cover:

- retry resumes after a contiguous successful prefix;
- already-successful sequences are never published again;
- all-successful rows reconcile without an API call;
- mismatched content, sequence gaps, and uncertain rows block retry;
- missing publish post ID never falls back to container ID;
- explicit pre-publish failure is retryable;
- ambiguous publish failure becomes uncertain;
- only one worker can claim an active job;
- heartbeat updates require the correct lock token;
- completion requires the correct lock token;
- stale jobs become failed rather than automatically republished;
- timers are stopped on success and failure;
- final database update errors are surfaced;
- short and long thread success paths remain sequential.

