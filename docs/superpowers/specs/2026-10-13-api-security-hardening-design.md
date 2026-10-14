# API Security Hardening Design

Date: 2026-10-13

## Goal

Protect Threads credentials from direct user access, limit abusive traffic on sensitive and expensive endpoints, and reject unexpectedly large request bodies without changing the existing frontend API contract.

## Scope

This change covers:

- moving Threads access and refresh tokens out of `public.social_accounts`;
- global and endpoint-specific HTTP rate limiting;
- explicit JSON and URL-encoded body-size limits;
- regression and integration tests for these controls.

It does not change authentication response shapes, content-generation payloads, Threads connection metadata returned to the frontend, or subscription entitlements.

## Credential Storage

### Public account metadata

`public.social_accounts` remains the user-readable metadata table. It retains the account ID, owner ID, platform, platform user ID, username, expiry metadata, and timestamps. The existing owner-scoped RLS policies remain in place.

### Private credential table

Create `public.social_account_credentials` with:

- `social_account_id uuid primary key` referencing `social_accounts(id)` with `on delete cascade`;
- `access_token text not null`;
- `refresh_token text null`;
- `created_at timestamptz not null default now()`;
- `updated_at timestamptz not null default now()`.

RLS is enabled with no policies for `anon` or `authenticated`. Access is performed only by the backend Supabase service-role client. Table and column grants to `anon` and `authenticated` are explicitly revoked as defense in depth.

The API must never serialize either credential field to frontend responses or logs.

### Service boundary

`threadsAccountsService` continues to expose account metadata to controllers. Credential operations are isolated behind a backend-only repository using `supabaseAdmin`. Publishing, token refresh, OAuth callback persistence, disconnect, and Meta deletion use that repository.

Requests are still authorized with the user's Supabase client for user-owned resources. Before returning or using credentials, the backend verifies that the requested `social_accounts.user_id` matches the authenticated user. The service-role client is never attached to the request object or exposed outside the credential boundary.

### Database migration and rollout

The migration is safe for existing installations:

1. Create the private credential table and security rules.
2. Copy every non-null token from `social_accounts` into the private table.
3. Verify copied credentials before removing old columns.
4. Drop `access_token` and `refresh_token` from `social_accounts` in the same migration transaction.
5. Update `full_schema.sql` to represent the final schema.

Backend and database migration must be deployed together because the final backend reads only the private table. The SQL migration is idempotent where practical, but a failed verification aborts the transaction rather than deleting source credentials.

## Rate Limiting

Use `express-rate-limit` with standard `RateLimit-*` headers and consistent JSON errors:

```json
{
  "success": false,
  "error_code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please try again later."
}
```

Limits:

| Scope | Limit | Key |
| --- | ---: | --- |
| Global API | 300 per 15 minutes | Client IP |
| Login | 10 per 15 minutes | Client IP |
| Register | 5 per hour | Client IP |
| Forgot password | 5 per hour | Client IP |
| AI generation | 20 per 15 minutes | Authenticated user ID |
| Threads publish/run/retry | 20 per 15 minutes | Authenticated user ID |
| Meta deletion callback | 20 per hour | Client IP |

The AI limiter is a burst/abuse guard. Existing database-backed daily and monthly subscription usage checks remain the source of truth for user entitlement, so restarting or scaling an application instance cannot grant extra subscription quota.

Authenticated rate limiters run after `authMiddleware`, allowing stable `req.user.id` keys. Unauthenticated limiters use the library's IPv6-safe IP key helper.

Production enables one trusted proxy hop for Render so the client IP is derived correctly without blindly trusting arbitrary forwarded headers. Tests and local development do not require proxy headers.

The initial limiter store is in-memory. This is sufficient for one Render instance; if the service scales horizontally, the store must be replaced with a shared Redis-compatible store so limits are consistent across instances.

## Request Size Limits

Configure both parsers explicitly:

- `express.json({ limit: "100kb" })`
- `express.urlencoded({ extended: true, limit: "100kb" })`

The central error handler maps parser size failures to HTTP `413` with:

```json
{
  "success": false,
  "error_code": "PAYLOAD_TOO_LARGE",
  "message": "Request body is too large."
}
```

The Meta deletion callback remains compatible because its URL-encoded `signed_request` is far below this limit.

## Failure Handling

- Missing service-role configuration fails credential operations closed with a server configuration error.
- Missing credential rows are treated as a disconnected Threads account.
- A partial credential update must not return token values or corrupt public metadata.
- Rate-limited requests must not reach controllers or consume AI/subscription usage.
- Oversized bodies must be rejected before route validation and controller execution.

## Testing

Implementation follows test-first development. Tests cover:

- account API responses never include credentials;
- credential reads and writes use the private table/admin client;
- user ownership is checked before private credentials are used;
- disconnect and Meta deletion remove private credentials;
- legacy tokens are copied by the migration before legacy columns are dropped;
- each endpoint class returns `429` after its configured threshold;
- authenticated limiters isolate different user IDs;
- normal request bodies work and oversized JSON/form bodies return `413`;
- the existing complete test suite remains green.

## Deployment Checklist

1. Confirm `SUPABASE_SERVICE_ROLE_KEY` exists in Render.
2. Put the API into a controlled deployment window.
3. Apply the supplied Supabase migration.
4. Deploy the matching backend revision immediately.
5. Verify connect status, OAuth connection, manual publish, scheduled publish, disconnect, and Meta deletion callback.
6. Remove any obsolete token-column assumptions from Supabase views or external queries, if present.
