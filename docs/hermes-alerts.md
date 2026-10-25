# Critical backend alerts to Hermes

Initial scope: unexpected API server errors (5xx), Threads OAuth connection failures after a valid callback attempt, reconnect-required errors, scheduled Threads publish failures (including uncertain results), and thrown cron failures. User cancellation, ordinary validation errors and successful jobs do not alert. A handled cron failure has an error severity, not a claim that the whole service is down.

## Setup

1. Apply `supabase/hermes_alert_outbox.sql` using the Supabase SQL editor before enabling alerts. This adds a service-role-only outbox and enqueue/claim/finish functions. It does not change publishing tables.
2. Configure these values in the backend environment and in the `.env` read by cron:

```dotenv
HERMES_ALERT_ENABLED=false
HERMES_ALERT_URL=https://your-hermes-endpoint.example/errors
HERMES_ALERT_SECRET=replace-with-a-long-random-shared-secret
```

3. When the receiver is ready, set `HERMES_ALERT_ENABLED=true` and restart the backend. To collect errors before the receiver exists, enable with URL/secret unset: events persist but no delivery occurs. With enabled false (the default), nothing is collected or sent.
4. Keep the existing cron running every minute. It drains up to ten queued events even if no publishing jobs are due. No new worker process is required.

Identical pending errors within a five-minute bucket merge and increment occurrences. Sends have a three-second timeout and do not follow redirects. Each event gets up to five claimed attempts, with exponential delays starting at one minute. Expired two-minute leases are recoverable. Delivery is at least once: a receiver accepting a message followed by a sender crash can cause redelivery.

## Receiver contract

POST body:

```json
{
  "event_id": "uuid",
  "event_type": "production_error",
  "service": "griv-backend",
  "environment": "production",
  "timestamp": "2026-10-24T14:48:07.556Z",
  "severity": "error",
  "source": "threads_connection",
  "error": { "code": "THREADS_RECONNECT_REQUIRED", "message": "Threads connection must be renewed" },
  "context": {},
  "occurrences": 1
}
```

Verify `X-Griv-Signature` equals `sha256=` plus the hex HMAC-SHA256 of `X-Griv-Timestamp + '.' + rawBody`, using the shared secret and a constant-time comparison. Require a Unix timestamp within five minutes. Verify the signature before parsing/processing. Deduplicate by event_id. Return 2xx only after durable acceptance, including for previously accepted IDs. A retry uses the same event ID and body with a fresh signature timestamp. Sender request timeout includes delivery; keep receiver acknowledgement fast and analyze asynchronously.

Only allowlisted identifiers/status/sequence values are included in context. Raw HTTP bodies, OAuth codes/state, access tokens, content text and raw provider responses are excluded. Messages are redacted and capped; do not add arbitrary context fields without reviewing them. No Telegram messages or automated remediation are performed by this backend.

## Operations

Inspect status, attempts, next_attempt_at, created_at and finished_at in `error_alert_outbox`. Final failures stay as failed for manual investigation. This initial version has no retention cleanup; periodically delete old sent/failed rows according to your retention needs. If Supabase is unavailable, persistence cannot work and a fixed local diagnostic is logged. Reporting never changes the original API response or Threads retry policy.

No live migration or real webhook delivery is performed by the tests. Run `npm run test:hermes`.
