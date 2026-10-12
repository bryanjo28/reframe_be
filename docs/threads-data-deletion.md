# Threads Data Deletion Callback

Register `https://reframe-be.onrender.com/api/threads/delete` as the Meta data deletion callback URL.

Required backend environment variables:

- `THREADS_APP_SECRET`: secret of the Meta app that signs the callback.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: admin database access.
- `APP_BASE_URL=https://reframe-be.onrender.com`: public backend origin for status URLs.

Meta calls `POST /api/threads/delete` with `signed_request` in a form-urlencoded or JSON body. Application bearer authentication is not required. The backend verifies HMAC-SHA256 before accessing the database and matches the signed `user_id` against `social_accounts.platform_user_id` with `platform=threads`.

Deletion removes the matching social accounts (including tokens, username and platform ID), their `published_posts`, corresponding `content_outputs.external_post_id`, and matching in-memory OAuth tokens. Application profiles, subscriptions and authored content remain. It does not delete posts on Threads itself. An already absent account is a successful deletion.

The backend also clears `scheduled_job_runs.result_payload` and `error_message` for the matched users' Threads publishing jobs, plus `scheduled_jobs.last_run_error` and `error_message`. These fields can contain copies of Meta IDs, URLs or API errors. Run counters are preserved. Active Threads publishing jobs are paused; generation jobs and other users' jobs are unaffected. Reads use pagination and ID filters are batched so cleanup includes data beyond the Supabase response limit.

If a Threads job is still `running`, deletion returns HTTP 503 without a completion receipt. Retry once the publisher finishes, so it cannot rewrite job results after cleanup. A stuck running job must be recovered before deletion can complete. Concurrent account reconnection or unscheduled publishing is not serialized by this callback; a database transaction/coordination with those flows would be needed to guarantee that case.

The backend returns HTTP 200 only after cleanup succeeds:

```json
{
  "url": "https://reframe-be.onrender.com/api/threads/delete/status/<confirmation_code>",
  "confirmation_code": "<confirmation_code>"
}
```

`GET /api/threads/delete/status/:code` publicly returns `status=completed` for a valid signed receipt. Receipts contain no user identifiers and survive server restarts while `THREADS_APP_SECRET` remains unchanged. Rotating that secret invalidates previous receipts. No database migration is required.

Invalid signed requests return HTTP 400 without deleting data. Database/configuration failures return HTTP 500; Meta may retry. Cleanup steps are idempotent, but are not a single database transaction. No completion receipt is issued on failure.

`DELETE /api/threads/delete` retains the authenticated application disconnect behavior. Frontends that previously disconnected via POST must use DELETE instead.

Run `npm test` to verify the callback and existing suite. Deployment to Render is required before the registered public URL serves this implementation.
