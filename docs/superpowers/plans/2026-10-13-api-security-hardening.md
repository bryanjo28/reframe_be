# API Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Threads credentials behind the backend service role, rate-limit sensitive endpoints, and reject request bodies larger than 100kb.

**Architecture:** Keep user-readable Threads account metadata in `social_accounts` and store provider secrets in an RLS-locked `social_account_credentials` table accessed only through `supabaseAdmin`. Add focused Express limiter middleware at the app and route layers, while retaining database-backed subscription quota as the AI entitlement authority. Configure both Express body parsers explicitly and normalize parser errors in the central error handler.

**Tech Stack:** Node.js CommonJS, Express 5, Supabase/PostgreSQL RLS, `express-rate-limit`, Node assertion-based tests.

**Spec:** `docs/superpowers/specs/2026-10-13-api-security-hardening-design.md`

## Global Constraints

- Frontend API response and request contracts must remain unchanged.
- Credentials must never appear in API responses or logs.
- `social_account_credentials` must be inaccessible to `anon` and `authenticated` roles.
- Global limit: 300 requests per 15 minutes per IP.
- Login: 10 requests per 15 minutes per IP.
- Register and forgot password: 5 requests per hour per IP.
- AI generation and Threads publish: 20 requests per 15 minutes per authenticated user.
- Meta deletion callback: 20 requests per hour per IP.
- JSON and URL-encoded request limit: 100kb.
- Existing subscription usage remains the source of truth for AI entitlement.
- Preserve all unrelated uncommitted work in the existing working tree.

## Review Focus

- Existing connected accounts retain working credentials after migration; Task 1 tests migration ordering and legacy-column removal.
- A user cannot make the admin credential lookup return another user's token; Task 2 tests ownership lookup before credential access.
- OAuth callback and scheduled publishing still work without request-scoped access to token columns; Task 2 tests save/read/refresh flows.
- Different authenticated users do not share a rate-limit bucket; Task 3 tests distinct `req.user.id` keys.
- Malformed and oversized bodies produce stable API errors rather than HTML; Task 4 tests JSON and URL-encoded failures.

---

### Task 1: Private credential schema and migration

**Files:**
- Create: `supabase/separate_social_account_credentials.sql`
- Modify: `supabase/full_schema.sql`
- Create: `test/socialAccountCredentialsMigration.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Produces: `public.social_account_credentials(social_account_id, access_token, refresh_token, created_at, updated_at)`.
- Produces: final `social_accounts` schema without `access_token` and `refresh_token`.

- [ ] **Step 1: Write the failing migration contract test**

Assert that the migration creates the private table and FK cascade, enables RLS, revokes `anon`/`authenticated`, copies legacy credentials before dropping either legacy column, and aborts on a source/destination count mismatch.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `node test/socialAccountCredentialsMigration.test.js`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Add the transactional migration**

Create `supabase/separate_social_account_credentials.sql` with an idempotent table creation, upsert-based credential copy, a PL/pgSQL verification block, privilege revocation, and final legacy-column drops inside one transaction.

- [ ] **Step 4: Update the canonical schema**

Change `supabase/full_schema.sql` to define the final metadata and credential tables, FK cascade, RLS, and grants without any credential columns on `social_accounts`.

- [ ] **Step 5: Run the migration contract test**

Run: `node test/socialAccountCredentialsMigration.test.js`

Expected: PASS.

- [ ] **Step 6: Commit Task 1 files only**

Commit message: `feat: separate Threads credentials schema`

### Task 2: Backend-only Threads credential repository

**Files:**
- Create: `src/repositories/socialAccountCredentialsRepository.js`
- Modify: `src/services/threadsAccountsService.js`
- Modify: `src/services/threadsAuthService.js`
- Modify: `src/services/threadsPublishService.js`
- Modify: `src/services/threadsDeletionService.js`
- Modify: `src/services/authService.js`
- Modify: `test/threadsAccountsService.test.js`
- Modify: `test/threadsAuthService.test.js`
- Modify: `test/threadsTokenLifecycle.test.js`
- Modify: `test/threadsDeletion.test.js`
- Modify: `test/authService.test.js`

**Interfaces:**
- Consumes: private table from Task 1 and `supabaseAdmin` from `src/config/supabase.js`.
- Produces: `getBySocialAccountId(socialAccountId)`, `upsert({ socialAccountId, accessToken, refreshToken })`, and `deleteBySocialAccountId(socialAccountId)`.
- Produces: `getThreadsAccount({ supabase, credentialSupabase, userId, includeCredentials })` and `saveThreadsAccount({ supabase, credentialSupabase, userId, payload, includeCredentials })`, where credential access fails closed unless the metadata row belongs to `userId`.

- [ ] **Step 1: Add failing repository and ownership tests**

Test admin-only credential CRUD, absence of credentials in default account mapping, ownership verification before private reads, and a configuration error when no service-role client is available.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node test/threadsAccountsService.test.js`

Expected: FAIL because the private repository/interface does not exist.

- [ ] **Step 3: Implement the credential repository**

Add the three repository functions using an explicitly supplied admin Supabase client and select only required credential columns.

- [ ] **Step 4: Refactor account save/read/disconnect**

Keep metadata operations on the authenticated client, move credential upsert/read/delete to the repository, ensure compensation removes newly created metadata if its initial credential write fails, and never include credentials unless an internal caller explicitly requests them.

- [ ] **Step 5: Refactor all internal credential consumers**

Pass `supabaseAdmin` only within service code for OAuth persistence, profile connection status, refresh/publish, disconnect, and Meta deletion. Remove all selects/updates of legacy token columns.

- [ ] **Step 6: Run focused lifecycle tests**

Run: `node test/threadsAccountsService.test.js && node test/threadsAuthService.test.js && node test/threadsTokenLifecycle.test.js && node test/threadsDeletion.test.js && node test/authService.test.js`

Expected: PASS with no credential values in response assertions or logs.

- [ ] **Step 7: Commit Task 2 files only**

Commit message: `feat: isolate Threads credentials behind service role`

### Task 3: Global and endpoint-specific rate limiting

**Files:**
- Create: `src/middlewares/rateLimiters.js`
- Modify: `src/app.js`
- Modify: `src/routes/authRoutes.js`
- Modify: `src/routes/contentTopicsRoutes.js`
- Modify: `src/routes/contentOutputsRoutes.js`
- Modify: `src/routes/contentPillarsRoutes.js`
- Modify: `src/routes/threadsRoutes.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/rateLimiters.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Produces: `globalApiLimiter`, `loginLimiter`, `registerLimiter`, `forgotPasswordLimiter`, `aiGenerationLimiter`, `threadsPublishLimiter`, and `metaDeletionLimiter` Express middleware.
- Produces: uniform `429` body with `error_code: "RATE_LIMIT_EXCEEDED"`.

- [ ] **Step 1: Add failing limiter behavior tests**

Assert exact windows/limits, standard headers, uniform error bodies, separate authenticated-user buckets, controller bypass after rejection, and IPv6-safe IP keys.

- [ ] **Step 2: Run limiter tests and verify RED**

Run: `node test/rateLimiters.test.js`

Expected: FAIL because `rateLimiters.js` and `express-rate-limit` do not exist.

- [ ] **Step 3: Install `express-rate-limit`**

Run: `npm install express-rate-limit`

Expected: dependency and lockfile update without audit vulnerabilities.

- [ ] **Step 4: Implement focused limiter factories and instances**

Use the library IPv6-safe helper for IP keys and `req.user.id` after authentication for user keys. Export fixed instances using the spec values and the common JSON handler.

- [ ] **Step 5: Mount the limiters in correct order**

Mount global limiting under `/api`; mount auth and Meta callback limiters before validation/controllers; mount AI and publish limiters after `authMiddleware`. Set one trusted proxy hop only when `NODE_ENV === "production"`.

- [ ] **Step 6: Run limiter tests**

Run: `node test/rateLimiters.test.js`

Expected: PASS.

- [ ] **Step 7: Commit Task 3 files only**

Commit message: `feat: rate limit sensitive API endpoints`

### Task 4: Explicit request-body limits and final verification

**Files:**
- Modify: `src/app.js`
- Modify: `src/middlewares/errorHandler.js`
- Create: `test/requestSizeLimit.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Produces: HTTP `413` with `error_code: "PAYLOAD_TOO_LARGE"` for JSON and URL-encoded bodies over 100kb.

- [ ] **Step 1: Add failing HTTP body-size tests**

Start the real app on an ephemeral port; assert a normal body reaches routing, oversized JSON returns the uniform `413`, oversized form data returns the uniform `413`, and malformed JSON retains a stable JSON `400` response.

- [ ] **Step 2: Run request-size tests and verify RED**

Run: `node test/requestSizeLimit.test.js`

Expected: FAIL because parsers have no explicit limit/error normalization.

- [ ] **Step 3: Configure parser limits and error mapping**

Set both parser limits to `100kb`; map `entity.too.large` to the specified `413` response and malformed JSON parser errors to a stable `400` JSON response.

- [ ] **Step 4: Run focused request tests**

Run: `node test/requestSizeLimit.test.js`

Expected: PASS.

- [ ] **Step 5: Run complete verification**

Run: `npm test`

Expected: all suites pass with exit code 0.

Run: `npm audit`

Expected: `found 0 vulnerabilities`.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Review credential leakage and legacy references**

Run a repository search for `social_accounts` queries selecting or updating `access_token`/`refresh_token`, and for response/log serialization of credential values. Expected: only migration compatibility SQL and provider request construction contain those field names.

- [ ] **Step 7: Commit Task 4 files only**

Commit message: `feat: enforce API request size limits`
