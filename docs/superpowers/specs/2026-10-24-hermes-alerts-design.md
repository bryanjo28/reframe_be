# Hermes error alerts

## Intent

Notify Hermes about backend failures through a durable Supabase outbox. Hermes analyzes events and handles Telegram notifications. Reporting must not change publishing outcomes or automatically retry uncertain Threads posts.

## Agreed direction

Use a Supabase queue rather than direct delivery so alerts survive process exit and receiver downtime. Use the JSON payload and timestamped HMAC proposed in chat. The receiver is not available yet; delivery defaults to disabled until configured.

## Contract

POST JSON containing `event_id`, `event_type: production_error`, `service: griv-backend`, `environment`, ISO `timestamp`, `severity`, `source`, `error: {code, message}`, an allowlisted `context`, and `occurrences`.

Headers: `X-Griv-Timestamp` (Unix seconds) and `X-Griv-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + '.' + rawBody)>`. Event ID and body remain stable across delivery retries; the timestamp and signature are regenerated for each attempt. Receiver must verify the raw body, accept timestamps within five minutes, and deduplicate by event ID. A 2xx acknowledges durable acceptance. No credentials, content text, request bodies, arbitrary metadata, or raw API responses are sent.

## Implementation choices

- Environment: `HERMES_ALERT_ENABLED=false`, `HERMES_ALERT_URL`, `HERMES_ALERT_SECRET`. Enabling requires a valid HTTPS URL and secret. Disabled reporting performs no database writes or network requests.
- One service-role-only `error_alert_outbox` table; RLS enabled, no client policies. SQL functions restricted to service_role atomically enqueue/deduplicate and claim deliveries.
- Deduplicate matching source, error code, sanitized message and job/content/sequence context within five-minute buckets. Increment occurrences only while pending; do not mutate a claimed payload. New errors after delivery create another event.
- Bound database operations and HTTP sends to three seconds each. Reporting failures only log a fixed local diagnostic and never recursively report themselves.
- Cron drains up to ten due alerts per invocation. Claims use `FOR UPDATE SKIP LOCKED`, ownership tokens and a lease longer than a bounded batch. Completion updates require the current token; expired claims become retryable.
- Five delivery attempts, exponential retry delays starting at one minute, then a terminal failed state. Retain failed events for inspection. Delivery is at least once, so receiver deduplication is required.
- API middleware reports unexpected 5xx errors. Threads reports handled publish failures with job/content IDs and a distinct uncertain code; cancellation is excluded. Generation jobs report returned failures; cron reports reconciliation/query/job failures and entry-point failures. Avoid duplicate reporting at overlapping boundaries.
- Use existing message redaction plus replacement of known configured credential values. Allowlist context identifiers, numeric sequence/status values and method/route information; do not include query strings.

## Scope and limits

No Hermes receiver, Telegram integration, deployment, live migration, or changes to Threads retry behavior. The existing cron must run for delivery to progress. If Supabase itself is unavailable, the outbox cannot persist an alert; local logs remain the fallback. Outbox retention cleanup can be configured separately.

## Validation

Exercise actual queue SQL with PGlite and backend service logic with controlled DB/HTTP transports. Verify deduplication, ownership and stale-claim recovery, delivery retries and terminal failures, stable event IDs, exact signature verification, sanitization, disabled behavior, and caller outcomes when reporting fails. Run existing Threads, API error and cron checks plus the project test suite.
