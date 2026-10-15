# Alurin Admin Control Center audit

Audit baseline: 15 October 2026, branches `demo_flow_v2` (backend) and `demo_jeremy` (frontend).

## Existing architecture

- Frontend: React 19, TypeScript, Vite. `src/App.tsx` owns authentication and dashboard routing through pathname checks and local state; there is no routing library.
- Backend: Node.js, Express 5, CommonJS. API routes are mounted from `src/routes/index.js`; authentication middleware validates Supabase Auth access tokens with `auth.getUser()` and creates a user-scoped Supabase client.
- Database and identity: Supabase Auth and Postgres. SQL setup files are stored in `supabase/`; no ORM or checked-in Supabase migration directory/config was found.
- Existing role: `public.profiles.role` is already constrained to `user` or `admin`. `/api/auth/me` returns that profile role. No admin dashboard or protected admin API was present.
- Billing: `subscription_plans`, `user_subscriptions`, `payment_orders`, and Midtrans webhook/order handling already exist. Credit functionality has both the newer `credit_lots`/`credit_transactions`/`ai_usage_logs` design and legacy `token_wallets`/`token_ledger` structures.
- Entitlements: subscription plan data is read from the database. Backend enforcement exists in `entitlementsService.js` and a database trigger in `billing_credits_refactor.sql` for resource and scheduling limits.
- AI usage: generation logs and `ai_usage_logs` track usage. The current schema has cached token and USD cost fields, but not a verified historical USD/IDR rate or a complete provider cost ledger.
- Scheduling: `scheduled_jobs`, publishing services, and a cron worker already exist. Existing retry and publish reliability logic should be reused.
- UI styling: a shared CSS design system and reusable sidebar, cards, buttons, and navigation components exist.

## Configuration and data gaps

- The frontend marketing landing page still hardcodes Starter, Creator, and Pro display prices and quotas in `src/config/marketingPlans.ts`; the authenticated pricing page reads plan rows from the backend.
- Plan and top-up defaults are also seeded in `supabase/billing_credits_refactor.sql`. An older payment setup script seeds a separate `token_packages` catalog with different products and amounts, so the live checkout source must be confirmed before building a single editable catalog.
- AI token defaults include a 5,000-token-per-credit assumption and output token defaults in backend services. Those request caps and conversion assumptions are currently code-level defaults rather than published system settings.
- Database plan rows already store prices, credit allowances, persona limits, pillar limits, Threads limits, and scheduling access. Their actual integration coverage needs endpoint-by-endpoint verification before editable admin publishing is safe.
- Top-up package rows are database-backed. Midtrans amounts are derived server-side from those rows.
- The repository has no centralized configuration versioning, draft/publish/rollback workflow, or admin audit log table yet.
- Business reporting can reuse existing payment, subscription, credit, AI usage, and publishing records. Some requested measures (actual AI cost in IDR, gateway fees, contribution margin, MRR history) need trustworthy source data or an explicit exchange-rate and fee model before being shown as complete.
- The current API does not expose admin endpoints. Sensitive account and financial operations therefore have no admin workflow yet.

## Security findings

- Existing authentication can be reused; a second admin login is unnecessary.
- The database role lives in the server-owned profile row, which is a suitable authorization source. Frontend role checks are only for navigation and do not authorize API access.
- Existing profile self-update RLS makes it important to prevent direct role changes through the Supabase Data API. The additive SQL foundation in `admin_access_setup.sql` restricts profile updates to editable profile columns and adds a role-change guard.
- Admin reads should use the server-only service-role client after a fresh role check against `profiles`. Never return provider tokens or credentials.
- The service-role key is already intended for backend use. First-admin bootstrap and audited additional-admin provisioning are both backend-only; neither exposes public admin registration.

## Safe implementation started

- Added server-side admin middleware and rate-limited `GET /api/admin/overview` for exact counts from existing tables.
- Added a first-admin bootstrap RPC, a backend-only audited additional-admin grant RPC, and corresponding provisioning scripts in the additive SQL setup.
- Applied migration `alurin_admin_access_foundation` to Alurin Supabase project ref `rjzusztgiwalpixehdqe` on 15 October 2026. Confirmed the target profile exists with a verified Auth email and was previously a regular user; granted its role `admin` through the restricted grant function. Read-only verification confirmed the admin role and audit row.
- Verified `anon` and `authenticated` cannot execute the admin grant function, `service_role` can execute it, and RLS is enabled for `admin_audit_logs`. Supabase Advisor reports the audit table as RLS-enabled with no policies; this is intentional because direct client privileges are revoked and the backend service role has the required grants.
- The shell-based backend provisioning script could not reach Supabase due to the local network sandbox (`EACCES`); the same backend-only database function was called through the connected Supabase management channel.
- Frontend `/admin` route, direct-path guard, admin-only sidebar entry, and a responsive operational overview are implemented. The page currently presents exact operational counts only.

## Admin monitoring implementation update

- Added admin-only read endpoints: `GET /api/admin/users`, `/transactions`, `/ai-usage`, `/scheduled-posts`, and `/audit-logs`, alongside `/overview`. All routes share bearer authentication, a fresh server-owned `profiles.role` check, and the admin rate limiter. These endpoints use a server-only service-role client and omit social account credentials.
- Frontend `/admin` now provides Overview, Users, Transactions, AI Usage, Scheduled Posts, and Audit Logs panels with search, status/date filters where supported, paging, empty/error/loading states, and responsive tables.
- Users currently display profile `account_name`, plan, subscription status, credit lots or legacy wallet balance, usage-log credit/token totals, Threads connection presence, and successful paid-order totals. Credits/usage/payment figures are monitoring summaries: the database has both the legacy token wallet/ledger and the newer credit-lot system, so they must not be interpreted as a reconciled financial ledger.
- Transaction listing reuses `payment_orders` and `token_packages`; currently it represents top-ups only. Subscription payment/order history is not unified in the present schema.
- AI usage shows the persisted request token split, charged credits, stored USD provider-cost field, and estimated IDR cost. Historical exchange rates are absent, so no actual IDR API cost is calculated.
- Scheduled monitoring reads pending scheduled content from `content_outputs` and terminal posting outcomes from `published_posts`. It is read-only; retry/cancel workflows are not yet exposed.
- Audit Logs endpoint is present. The audit table is now applied; it contains the admin-role grant event. Other admin mutations do not yet exist.
- Overview remains operational counts only. It does not show fabricated revenue, MRR, active users, profitability, or trends.

## Current integration coverage matrix

| Admin setting | Public UI | User dashboard | Backend API | Worker | Billing |
|---|---|---|---|---|---|
| Subscription price | Incomplete (landing marketing values remain hardcoded) | N/A | Incomplete (read from existing plan rows, no admin editor) | N/A | Incomplete (checkout reads existing catalog; no published admin config) |
| Persona limit | Incomplete | Incomplete | Incomplete for centralized admin-config publish; existing DB plan/trigger enforcement exists | N/A | N/A |
| Pillar limit | Incomplete | Incomplete | Incomplete for centralized admin-config publish; existing DB plan/trigger enforcement exists | N/A | N/A |
| Monthly credits | Incomplete | Incomplete | Incomplete for centralized admin-config publish | N/A | Incomplete (new credit flow uses existing grants; no admin edit path) |
| AI credit rules | N/A | Incomplete | Incomplete (server defaults and existing atomic credit RPCs) | N/A | N/A |
| Schedule entitlement | N/A | Incomplete for central admin config | Incomplete for central admin config; current plan entitlement checks and DB insertion trigger exist | Incomplete for published config changes | N/A |
| Top up packages | Incomplete | Incomplete | Incomplete (current catalog API exists, admin editing absent) | N/A | Incomplete (existing Midtrans flow and DB catalog reused, admin editing absent) |

Configuration drafts, validation/impact preview/publish/rollback, profitability calculations, credit adjustments, subscription mutation, promotions, analytics charts, and administrative publishing actions are not implemented yet.

## Phase 2 implementation status (15 October 2026)

- Added `/admin/profitability` UI with reporting date range, plan filter, seven sort choices, and page navigation. Profitability data is aggregated in the additive `admin_monitoring_setup.sql` RPC from existing profiles, active subscriptions, top-up payment orders, credit lots/transactions, and AI usage logs. The RPC uses grouped server-side aggregates and bounded pagination; it does not load all users or payments into application memory.
- Added an additive `admin_monitoring_overview` RPC for bounded daily series and aggregate KPIs from current records. The overview UI includes date presets/custom dates and trend charts for recorded top-up revenue, estimated AI cost, their comparison, user registrations, and AI usage by feature. Revenue by subscription plan is explicitly marked unavailable because subscription payments are not recorded in a canonical ledger.
- Added `/admin/users/:id` with Supabase Auth email lookup, profile and plan summary, available credit lots, content counts, and recent AI, payment, credit, and schedule histories. Prompt text and generated content are not included in detail history.
- Changed user list loading to use SQL-side profitability filtering and pagination instead of retrieving up to 100,000 profiles. AI, payment, and usage API pages remain paginated.
- Preserved visible legacy wallet balances in reports only when a user has no credit-lot records. Historical usage is not inferred from wallet balances.
- Added bounded/validated report pagination and date ranges (maximum 366 days), plus indexes for the reporting date/user predicates. The SQL file is additive (indexes/functions only); no credit, subscription, payment, or user data is changed.
- Financial semantics are intentionally limited: successful top-up payment orders are known revenue; there is no subscription revenue ledger, reliable refund ledger, gateway fee history, or historical USD/IDR exchange rate. AI `actual_cost_usd` is persisted using configured internal pricing, but `SUMO_MODEL` is unset in the current local backend environment; therefore the UI labels it stored/unverified and only uses `estimated_cost_idr` for an explicitly estimated contribution-before-fees figure. MRR and actual IDR cost stay unavailable.
- Profile schema has no last-active field. The overview derives active-user count from recorded AI/content/publish activity in the selected period; it does not invent a last-active timestamp.
- The SQL setup script was not applied to the Supabase project. Per the Phase 2 brief, no deployment was performed. Until an authorized database rollout applies `supabase/admin_monitoring_setup.sql`, overview uses its previous count-only fallback and profitability/user details return `ADMIN_REPORTING_NOT_READY`.
- Verification: frontend TypeScript production build and ESLint pass. New report filter/pagination test and the expanded direct-API regular-user 403 test pass. The full backend suite currently exits nonzero on an existing `notificationsService.test.js` assertion (`limit` expected 20, received 10); unrelated notification code was left untouched. SQL RPC execution against the live project remains pending the migration rollout.

### Remaining Phase 2 gaps

- Reliable actual provider cost in IDR, payment gateway fees, subscription revenue/MRR history, and complete refunds need new authoritative records/integration before they can be calculated.
- User list does not include a last-active timestamp; transaction data remains top-up-only. The user detail history is a recent-record preview and not a downloadable full audit export.
- The scheduled-post model has no persisted canceled state or accurate publishing delay for every row. Existing views only map statuses represented by the current content/publish tables.
- Querying the Supabase Auth Admin API per detail page supplies that selected user's email; the paged user list currently identifies users by profile name/account name and does not expose emails.
- Local database function testing and Supabase advisors should be run after the SQL rollout; the Supabase CLI is not installed in the current workspace.

## Risks and rollout requirements

- The additive admin access migration is applied to project `rjzusztgiwalpixehdqe`. Keep the service-role key backend-only. The Alurin user `jjeremy.jjason@gmail.com` was already registered and email-verified, so the existing account was promoted without replacing its session or credentials.
- Admin functionality is incomplete until the remaining monitoring modules, configuration versioning, and tested configuration enforcement paths are built. Current metrics are operational counts only; they are not profitability or financial summaries.
