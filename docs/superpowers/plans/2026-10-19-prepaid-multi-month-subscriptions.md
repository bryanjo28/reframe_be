# Prepaid Multi-Month Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support prepaid 1/3/6/12-month Pakasir subscriptions that queue behind existing paid coverage, release captured AI credits once per monthly period, and automatically reconcile orders at Pakasir's provider-defined expiry.

**Architecture:** PostgreSQL owns contract creation, period scheduling, and idempotent activation under a per-user advisory lock. The Node service snapshots duration/price/credits on each payment order, invokes the database settlement RPC after Pakasir verification, and reconciles due periods from cron plus entitlement reads so Render sleep cannot strand a subscription.

**Tech Stack:** Node.js/CommonJS, Express 5, Supabase/PostgreSQL PL/pgSQL, Pakasir API v2, `node:test`/`node:assert`-style project tests.

**Spec:** `docs/superpowers/specs/2026-10-19-prepaid-multi-month-subscriptions-design.md`

## Global Constraints

- Accepted durations are exactly `1`, `3`, `6`, and `12`; omitted duration defaults to `1`.
- Initial pricing is exactly `subscription_plans.price * durationMonths`; client price and credit fields remain untrusted.
- New paid coverage queues after all active/queued paid periods; a free entitlement never delays paid activation.
- Credits are granted once per due monthly period from the order snapshot, never all at settlement.
- Top-up settlement, balances, expiry, and eligibility remain unchanged.
- Duplicate webhook, polling, cron, and request-time reconciliation must not duplicate contracts, periods, lots, or ledger entries.
- Manual pending-payment cancellation, payment-row deletion, discounts, refunds, proration, and recurring charges remain out of scope.
- There is no manual cancel endpoint; automatic expiry uses Pakasir's captured `expired_at`, never an application-defined timeout.
- Payment-order rows are retained after cancellation for audit.

## Review Focus

- A numeric-looking duration such as `"3"`, fractional value, `null`, or unsupported integer must not bypass exact duration validation; Task 2 tests the public input boundary.
- A multi-month total that exceeds the chosen QRIS/VA limit must fail before an order row or Pakasir transaction is created; Task 2 pins call ordering.
- Existing paid coverage ending exactly at settlement time must not create overlapping periods; Task 1 tests database boundary selection under the advisory lock.
- Catalog price/credit changes after checkout must not alter settlement or activation; Tasks 1 and 2 assert snapshot use.
- A payment completing at its expiry boundary must settle as paid instead of being overwritten by cancellation; Tasks 1, 2, and 4 test the race-safe transition.

---

### Task 1: Database Contract, Period, Settlement, and Activation Model

**Files:**
- Create: `supabase/migrations/20261019010000_prepaid_multi_month_subscriptions.sql`
- Create: `test/prepaidSubscriptionsMigration.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces RPC `settle_pakasir_payment(p_order_id uuid, p_provider_reference text) -> jsonb` with existing name and extended activation result.
- Produces RPC `reconcile_user_subscription_periods(p_user_id uuid, p_now timestamptz default now()) -> jsonb`.
- Produces RPC `reconcile_due_subscription_periods(p_now timestamptz default now(), p_limit integer default 100) -> jsonb`.
- Produces tables `subscription_contracts` and `subscription_periods`, plus payment-order snapshot columns from the spec.
- Produces RPC `mark_expired_pakasir_order_cancelled(p_order_id uuid, p_provider_reference text, p_reason text) -> jsonb` that locks the order and never overwrites `paid`.

- [ ] **Step 1: Write the failing migration contract test**

Create assertions that the migration contains exact duration constraints, `provider_expires_at`/`cancelled_at`/`cancellation_reason`, unique `payment_order_id`, unique `(contract_id, sequence_number)`, user advisory locking, snapshot-based credit insertion, idempotency keys, top-up preservation, all reconciliation RPCs, a paid-safe cancellation RPC, and a catch-up branch that completes expired periods without granting their credits. Assert the test is included in `npm test`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/prepaidSubscriptionsMigration.test.js`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the schema and atomic RPC implementation**

Implement the migration with:

- nullable snapshot columns on `payment_orders` and checks tied to `order_type='subscription'`;
- contract/period foreign keys, status checks, uniqueness, and due-query indexes;
- an updated settlement RPC that preserves the top-up branch but creates contracts/periods for subscription orders;
- an activation RPC that projects the current period into `user_subscriptions`, explicitly inserts the captured credit lot and `subscription_grant` transaction, and prevents the legacy paid-plan trigger from granting catalog values;
- a bounded batch reconciliation RPC for cron;
- a cancellation transition RPC that checks `provider_reference`, locks the row, is idempotent for `cancelled`, and returns rather than overwrites an already `paid` order;
- service-role-only execution grants and authenticated read policies limited to the owning user.

Use one user-scoped advisory lock in both settlement and reconciliation. Compute each period as `start + make_interval(months => sequence_number)` from a fixed contract start, rather than repeatedly adding a month, so month-end drift is deterministic.

- [ ] **Step 4: Run the migration contract test**

Run: `node test/prepaidSubscriptionsMigration.test.js`

Expected: PASS with all schema/RPC safety assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261019010000_prepaid_multi_month_subscriptions.sql test/prepaidSubscriptionsMigration.test.js package.json
git commit -m "feat: add prepaid subscription contract schema"
```

### Task 2: Duration-Aware Pakasir Order Creation

**Files:**
- Modify: `src/services/pakasirService.js`
- Modify: `src/services/pakasirPaymentsService.js`
- Modify: `src/services/paymentsService.js`
- Modify: `test/pakasirPayments.test.js`

**Interfaces:**
- Consumes the new `payment_orders` columns and existing `gateway.create(orderId, amount, method)`.
- Extends the Pakasir client with `cancel(txnId) -> Promise<{message:string}>`, throttled to at most two starts per second per process.
- Produces `normalizeDurationMonths(value) -> 1|3|6|12` inside `pakasirPaymentsService.js` (exported only through `createPaymentsService` behavior).
- Produces subscription order fields `duration_months`, `monthly_price_idr`, `monthly_credits`, and total `amount_idr`.

- [ ] **Step 1: Add failing order-creation tests**

Extend `test/pakasirPayments.test.js` to assert:

- omitted duration stores `1` and preserves current one-month amount;
- durations `3`, `6`, and `12` send the multiplied server price to Pakasir and store snapshots;
- `"3"`, `null`, `0`, `2`, `1.5`, and `13` return HTTP 400 with `INVALID_SUBSCRIPTION_DURATION` when explicitly supplied;
- client `amount` and `credits` cannot override snapshots;
- a multiplied amount outside method limits fails before insert and before `gateway.create`;
- top-up input ignores/rejects `durationMonths` consistently (choose rejection with HTTP 400 to keep the API unambiguous).
- provider `expired_at` is required, validated as a timestamp, stored as `provider_expires_at`, and returned as `providerExpiresAt`;
- concurrent `cancel()` calls obey the provider's two-requests-per-second limit and reject malformed responses.

- [ ] **Step 2: Run the focused test to verify failures**

Run: `node test/pakasirPayments.test.js`

Expected: FAIL on missing snapshot fields and duration validation.

- [ ] **Step 3: Implement duration validation and server-side snapshots**

Update `createOrder(userId, input)` so subscription orders default an omitted property to `1`, require exact integer membership when present, calculate a safe-integer total, validate the total against the selected payment method, and insert all snapshot columns. In `pakasirService.js`, add a cancellation queue spaced by at least 510ms and the v2 cancel request. Persist validated `txn_id` and `expired_at` after checkout. Preserve the existing top-up path and recovery response. Include camelCase duration/monthly-credit/expiry fields in returned payment data without removing existing fields.

- [ ] **Step 4: Run payment tests**

Run: `node test/pakasirPayments.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/pakasirService.js src/services/pakasirPaymentsService.js src/services/paymentsService.js test/pakasirPayments.test.js
git commit -m "feat: create duration-aware subscription orders"
```

### Task 3: Active and Queued Subscription Read Model

**Files:**
- Create: `src/services/subscriptionPeriodsService.js`
- Create: `test/subscriptionPeriodsService.test.js`
- Modify: `src/services/subscriptionsService.js`
- Modify: `src/services/subscriptionUsageService.js`
- Modify: `test/subscriptionUsageService.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Consumes RPC `reconcile_user_subscription_periods` from Task 1.
- Produces `reconcileUserSubscriptionPeriods({ supabase, userId, now? }) -> Promise<object>`.
- Produces `getSubscriptionTimeline({ supabase, userId }) -> Promise<{active, queued, coverageEndsAt}>`.
- Extends `getCurrentUserSubscription({ supabase, userId })` response with `active`, `queued`, and `coverageEndsAt` while retaining existing `subscription` and `plan` fields for compatibility.

- [ ] **Step 1: Write failing reconciliation and timeline tests**

Cover RPC invocation before reads, chronological queued periods, `coverageEndsAt` from the final paid period, no active subscription with a future queue, legacy active subscriptions with no contract, ownership filters, database errors, and catalog plans that become inactive after purchase (captured paid periods remain readable/usable).

- [ ] **Step 2: Run focused tests to verify failure**

Run: `node test/subscriptionPeriodsService.test.js && node test/subscriptionUsageService.test.js`

Expected: FAIL because the new service and response fields do not exist.

- [ ] **Step 3: Implement the focused period service and compatibility mapping**

Keep period queries/mapping in `subscriptionPeriodsService.js`. Reconcile before subscription reads and entitlement checks. For contract-backed paid periods, treat the paid snapshot as authoritative even if the catalog row later changes; preserve existing inactive-plan rejection for legacy/unpaid catalog-only entitlements.

- [ ] **Step 4: Run subscription tests**

Run: `node test/subscriptionPeriodsService.test.js && node test/subscriptionUsageService.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/subscriptionPeriodsService.js src/services/subscriptionsService.js src/services/subscriptionUsageService.js test/subscriptionPeriodsService.test.js test/subscriptionUsageService.test.js test/run-tests.js
git commit -m "feat: expose prepaid subscription timeline"
```

### Task 4: Payment Page and Settlement Response Integration

**Files:**
- Modify: `src/services/paymentsService.js`
- Modify: `src/services/pakasirPaymentsService.js`
- Modify: `test/pakasirPayments.test.js`
- Create: `test/paymentsPageSubscriptions.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Consumes `reconcileUserSubscriptionPeriods` and contract tables from Tasks 1 and 3.
- Produces payment-page order fields `durationMonths`, `monthlyCredits`, `contractStartsAt`, and `contractEndsAt`.
- Produces `reconcileExpiredOrder(userId, orderId, {refresh:true})` behavior through the existing `checkOrder` endpoint; no manual cancel route is added.
- Produces settlement response `{id,status,credited,creditsAdded,balance,orderType,contractId,contractStartsAt,contractEndsAt,queued}` where applicable.

- [ ] **Step 1: Write failing page and settlement tests**

Assert that a completed subscription RPC result is returned without claiming the entire term was credited, queued settlement reports `queued: true`, an immediately active first period reports only one month's `creditsAdded`, duplicate settlement remains successful and uncredited, and `/payments/me` reconciles then maps snapshot/contract dates without changing top-up rows. Add expiry cases: before deadline no cancel call; at/after deadline a fresh `completed` status settles; `canceled` synchronizes locally; fresh `pending` calls provider cancel then the cancellation RPC; cancel failure remains pending; duplicate polling is idempotent; an RPC response reporting `paid` wins the race.

- [ ] **Step 2: Run focused tests to verify failures**

Run: `node test/pakasirPayments.test.js && node test/paymentsPageSubscriptions.test.js`

Expected: FAIL on missing contract mapping/reconciliation.

- [ ] **Step 3: Implement response and payment-page mapping**

Keep provider identity/amount verification unchanged. Extend verification to compare the current time with `provider_expires_at`, perform a fresh status read before any cancellation, and call provider cancel only for a due still-pending transaction. Pass through the extended settlement/cancellation RPC results, update the page query to include snapshot/expiry columns and contract relationships using separate bounded queries if Supabase relationship metadata is unavailable, and reconcile the requesting user before returning balances/orders.

- [ ] **Step 4: Run focused tests**

Run: `node test/pakasirPayments.test.js && node test/paymentsPageSubscriptions.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentsService.js src/services/pakasirPaymentsService.js test/pakasirPayments.test.js test/paymentsPageSubscriptions.test.js test/run-tests.js
git commit -m "feat: integrate prepaid subscriptions with payments"
```

### Task 5: Cron Reconciliation and Operational Recovery

**Files:**
- Modify: `src/services/cronService.js`
- Modify: `test/cronService.test.js`
- Modify: `test/cronOnce.test.js`

**Interfaces:**
- Consumes RPC `reconcile_due_subscription_periods(p_now, p_limit)`.
- Claims due `payment_orders` with `provider_expires_at <= now()` in a bounded batch and feeds them through the same provider reconciliation used by polling.
- Extends `runDueScheduledJobs(options)` with injectable `reconcileDueSubscriptions` behavior while preserving existing callers and scheduled content processing.

- [ ] **Step 1: Write failing cron tests**

Assert one subscription-period reconciliation call per cron tick, a bounded due-payment query, completed/canceled/pending provider outcomes, cancel rate-limit delegation, continued scheduled-job processing when either reconciliation fails, and no database work when Supabase admin is unconfigured.

- [ ] **Step 2: Run cron tests to verify failure**

Run: `node test/cronService.test.js && node test/cronOnce.test.js`

Expected: FAIL because subscription reconciliation is not invoked.

- [ ] **Step 3: Add cron reconciliation**

Call subscription-period and expired-payment reconciliation at the beginning of a configured tick without allowing either failure to prevent existing content/thread jobs. Bound expired orders to `100` per tick and reuse the payment service lifecycle method instead of duplicating provider rules. Return or log compact counts; do not log payment references or secrets.

- [ ] **Step 4: Run cron tests**

Run: `node test/cronService.test.js && node test/cronOnce.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/cronService.js test/cronService.test.js test/cronOnce.test.js
git commit -m "feat: reconcile subscription periods from cron"
```

### Task 6: Schema Snapshot, API Guide, and Full Verification

**Files:**
- Modify: `supabase/full_schema.sql`
- Modify: `docs/pakasir.http`
- Modify: `test/betaReadiness.test.js`

**Interfaces:**
- Documents the `durationMonths` request and active/queued response contract.
- Keeps `full_schema.sql` aligned with the deployable migration for future environment setup.

- [ ] **Step 1: Add failing readiness/documentation assertions**

Assert that the API guide contains 1/3/6/12-month examples, monthly-credit semantics, queue semantics, provider-expiry countdown/polling behavior, automatic cancellation with no user button, and the deployment order; assert the schema snapshot contains both new tables and all payment snapshot/lifecycle columns.

- [ ] **Step 2: Run readiness test to verify failure**

Run: `node test/betaReadiness.test.js`

Expected: FAIL on missing prepaid subscription documentation/schema snapshot.

- [ ] **Step 3: Update schema snapshot and Pakasir guide**

Reflect the migration exactly in `full_schema.sql`. Add request/response examples, provider-expiry countdown behavior, automatic expiry reconciliation, and state that the migration must be applied before deploying the compatible backend. Do not document a manual cancel button or payment-row cleanup as implemented.

- [ ] **Step 4: Run targeted and full verification**

Run: `node test/betaReadiness.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS with no unhandled rejection.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/full_schema.sql docs/pakasir.http test/betaReadiness.test.js
git commit -m "docs: document prepaid subscription operations"
```

