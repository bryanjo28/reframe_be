# Prepaid Multi-Month Subscriptions Design

## Summary

Add manual, prepaid subscription purchases for 1, 3, 6, or 12 months through Pakasir. A successful payment reserves consecutive monthly subscription periods. Only one period is active at a time, and each period grants one month's AI credits when it starts. A purchase made while a paid subscription is active is queued after all previously paid periods; it never removes time or credits already purchased. Credit top-ups keep their current immediate-settlement behavior.

This first version uses linear pricing (`monthly price * duration`). Pending Pakasir orders use the provider's `expired_at` as the authoritative deadline and are automatically reconciled; order rows are retained for audit.

## Goals

- Accept prepaid durations of exactly 1, 3, 6, or 12 months.
- Capture price, plan, duration, and monthly credits on the payment order so later catalog changes cannot alter a paid purchase.
- Queue new paid subscription periods after the user's last paid or queued period.
- Grant subscription credits monthly rather than granting the full term up front.
- Preserve existing top-up settlement behavior.
- Make payment settlement and monthly activation safe under duplicate webhooks, polling, retries, and concurrent requests.
- Expose the active subscription and future paid periods to the user.
- Continue functioning when an in-process Render cron is asleep by reconciling due periods on relevant authenticated requests.
- Persist Pakasir's transaction ID and expiry, then automatically cancel provider transactions that remain pending at their provider-defined deadline.

## Non-goals

- Automatic recurring charges.
- Discounts for longer durations.
- Proration, immediate upgrades, or immediate downgrades.
- Refunds or partial cancellations after payment.
- Manual cancellation controls and deletion of payment orders.
- Changes to top-up expiry or settlement.

## Product Rules

1. `durationMonths` must be one of `1`, `3`, `6`, or `12`.
2. The server calculates the total. Client-supplied prices or credit amounts are ignored.
3. A free-plan entitlement does not delay the first paid period. It is replaced when the paid period activates.
4. An existing paid active or queued entitlement does delay the new purchase. The new contract starts immediately after the latest paid period ends.
5. Buying the same or a different plan follows the same queue rule.
6. Each period is one calendar-month interval from its own start timestamp, using PostgreSQL month arithmetic. For example, PostgreSQL determines the result of adding one month to a month-end timestamp consistently inside the database.
7. Subscription credits are valid only for that period. When the next period activates, unused free/subscription credits from the previous period expire. Top-up credits are not expired.
8. A plan snapshot on the order and contract is authoritative for price and monthly credits. Renaming, repricing, deactivating, or editing the catalog later does not alter an already-paid contract.
9. A payment order may create at most one contract, and a contract period may grant credits at most once.
10. Pakasir's `expired_at` is the only payment countdown deadline. The application does not impose its own 30-minute timeout.
11. A due order is checked with Pakasir before cancellation. A completed payment is settled; an already canceled payment is synchronized; only a still-pending transaction is sent to Pakasir's cancel endpoint.

## Data Model

### `payment_orders` additions

- `duration_months integer`: nullable for legacy/top-up orders; constrained to `1,3,6,12` for subscription orders.
- `monthly_price_idr bigint`: the monthly price captured at checkout.
- `monthly_credits integer`: the monthly credit grant captured at checkout.
- `provider_expires_at timestamptz`: Pakasir's captured `expired_at` value.
- `cancelled_at timestamptz`: local terminal transition time.
- `cancellation_reason text`: `provider_expired` for this version.

`amount_idr` remains the final amount sent to Pakasir and equals `monthly_price_idr * duration_months` in this version.

### New `subscription_contracts` table

Represents one successful prepaid subscription purchase.

- `id uuid primary key`
- `user_id uuid not null`
- `plan_id uuid not null`
- `payment_order_id uuid not null unique`
- `provider_reference text not null`
- `duration_months integer not null`
- `monthly_price_idr bigint not null`
- `monthly_credits integer not null`
- `total_amount_idr bigint not null`
- `starts_at timestamptz not null`
- `ends_at timestamptz not null`
- `status text not null`: `queued`, `active`, `completed`, or `cancelled`
- timestamps

The unique payment order constraint provides settlement idempotency.

### New `subscription_periods` table

Represents each monthly entitlement and provides an auditable activation ledger.

- `id uuid primary key`
- `contract_id uuid not null`
- `user_id uuid not null`
- `plan_id uuid not null`
- `sequence_number integer not null`
- `starts_at timestamptz not null`
- `ends_at timestamptz not null`
- `monthly_credits integer not null`
- `status text not null`: `scheduled`, `active`, `completed`, or `cancelled`
- `activated_at timestamptz`
- `completed_at timestamptz`
- timestamps
- unique `(contract_id, sequence_number)`

Indexes cover `(user_id, status, starts_at)`, due scheduled periods, and contract lookup.

### Existing `user_subscriptions`

This remains the compatibility projection used by feature entitlement checks. Period activation atomically expires the previous paid/free subscription and creates or updates the active `user_subscriptions` row for the newly active monthly period. It does not represent the whole prepaid contract.

The existing generic subscription-credit trigger must not grant catalog credits for these periods because the contract's captured `monthly_credits` value is authoritative. The migration will replace the paid activation path with the new activation function while retaining free-registration behavior.

## Checkout and Settlement

`POST /api/payments/orders` accepts:

```json
{
  "planId": "uuid",
  "durationMonths": 6,
  "method": "qris"
}
```

For backward compatibility, omitted `durationMonths` defaults to `1`. The service validates the duration, loads the active plan, calculates the total, validates the payment-method amount limits against that total, and writes the complete snapshot to `payment_orders` before contacting Pakasir. A successful provider response must contain a valid `txn_id` and `expired_at`; both are persisted as `provider_reference` and `provider_expires_at`.

When Pakasir reports `completed`, a database settlement function runs in one transaction:

1. Lock the order and a user-scoped advisory lock.
2. Validate the provider, reference, pending status, subscription snapshot, and amount.
3. Determine `starts_at`: now when no future paid entitlement exists, otherwise the greatest queued/active period end.
4. Create one contract and the requested number of consecutive periods.
5. Mark the payment order paid and store its payment reference and paid timestamp. Do not grant the whole contract's credits at settlement.
6. Activate the first period if it is due; otherwise leave the contract queued.
7. Create a payment-success notification that states whether the plan is active now or queued and includes its start date.

A repeated webhook or polling request returns the existing result without creating another contract, period, or credit grant.

Unlike top-ups, settling a multi-month subscription does not insert one credit transaction for all months. Each period activation writes its own `subscription_grant` transaction.

## Pending Payment Expiry

`GET /api/payments/orders/:id` remains the frontend polling endpoint. Its response includes `providerExpiresAt`, allowing the frontend to show the provider-defined countdown and stop polling on `paid` or `cancelled`.

When an order is still pending at or after `provider_expires_at`, the backend performs this sequence:

1. Fetch fresh transaction status from Pakasir.
2. If `completed`, run normal settlement and return `paid`.
3. If `canceled`, atomically mark the local order `cancelled`.
4. If still `pending`, call `POST /api/v2/cancel-transaction/{slug}/{txn_id}` and then atomically mark the local order `cancelled` with reason `provider_expired`.
5. If the provider cancel request fails, keep the order pending so cron or later polling can retry.

The Pakasir client rate-limits cancellation to two requests per second per Node process. The local cancellation transition locks the order and refuses to overwrite `paid` or any other terminal state, preventing a concurrent successful webhook from being changed to cancelled. Repeated reconciliation of a cancelled order returns its existing terminal state successfully.

No user-triggered cancel endpoint or button is included. A checkout that never obtained a `provider_reference` has no authoritative Pakasir expiry and remains eligible for the existing same-order checkout retry rather than automatic provider cancellation.

## Monthly Activation

A security-definer database function performs reconciliation atomically for a user (and a batch wrapper handles all due users):

1. Take the user-scoped advisory lock.
2. Mark active periods whose `ends_at <= now()` completed and expire their associated subscription credit lots.
3. Select the earliest scheduled period with `starts_at <= now()`.
4. Expire any old free/subscription entitlement, while leaving top-up lots untouched.
5. Make the selected period and contract active.
6. Project that period into `user_subscriptions` with its exact start/end timestamps.
7. Insert one `credit_lots` row using the period ID as an idempotent source reference and the captured monthly credit amount.
8. Insert one `credit_transactions` row using a unique idempotency key.
9. Create a monthly-credit notification.
10. Repeat only when necessary to catch up expired periods, without making more than one current period active.

If the service wakes after multiple completely missed periods, those historical periods are marked completed without granting already-expired spendable credits. The current due period is activated and granted. This prevents downtime from accumulating old monthly allowances while still preserving the paid end date and audit trail.

## Activation Triggers and Render Sleep

- Extend the existing cron runner to call the batch reconciliation function every minute when `CRON_JOB=true`.
- The cron runner also claims a bounded batch of pending payment orders whose `provider_expires_at <= now()` and runs provider reconciliation/cancellation.
- Call user reconciliation before returning subscription/payment-page data and before paid-plan/AI entitlement checks.
- Database uniqueness and advisory locks make concurrent cron, webhook, polling, and user requests safe.

The request-time fallback is required because an in-process cron does not run while a free Render instance is asleep.

## API Responses

`POST /api/payments/orders` includes the captured duration, total, monthly credits, and eventual activation information when known.

`GET /api/subscriptions/me` returns:

- `active`: current period, plan, period start/end, and monthly credits.
- `queued`: future contracts/periods in chronological order.
- `coverageEndsAt`: end of all currently paid subscription coverage.

`GET /api/payments/me` includes `durationMonths`, `monthlyCredits`, `providerExpiresAt`, and contract activation dates for subscription orders. Existing clients continue to work because current fields remain unchanged.

## Error Handling

- Invalid duration: HTTP 400 with a stable error code.
- Inactive/free/missing paid plan: existing unavailable-plan response.
- Total outside the selected payment method's limits: HTTP 400 before creating an order.
- Database settlement failure: webhook returns an error so Pakasir can retry; polling surfaces the failure without marking the order paid.
- Activation failure: the period remains scheduled and can be retried by cron or the next request.
- Duplicate settlement/activation: return the existing state as success.
- Provider cancellation failure: retain `pending`, return a retryable gateway error, and let later polling/cron retry.
- Cancellation racing with settlement: the database lock preserves whichever valid terminal provider outcome is confirmed; cancellation never overwrites `paid`.

## Migration and Compatibility

- Existing paid active subscriptions remain active until their current `ends_at`; new purchases queue after them.
- Existing pending one-month orders with no duration snapshot are interpreted as one month using their captured credits and amount where possible.
- Existing paid orders are not backfilled into contracts because their credits have already been settled.
- Top-up orders and their settlement function are unchanged.
- The migration is additive except for replacing the paid-subscription settlement/credit-trigger behavior; it must be safe to re-run where practical.

## Testing

Database/integration coverage:

- 1/3/6/12-month price and period generation.
- Invalid duration and method-limit rejection.
- First paid purchase activates immediately and replaces free credits only.
- Purchase during an active paid period queues after its end.
- Multiple queued purchases, including a plan change, remain ordered.
- Monthly activation grants exactly the captured credit amount.
- Top-up credits survive subscription transitions.
- Duplicate webhook, polling, cron, and concurrent activation do not duplicate contracts or credits.
- A delayed wake-up skips expired grants and activates only the current period.
- Existing one-month clients work when `durationMonths` is omitted.
- Top-up tests continue to pass unchanged.
- Provider `expired_at` is persisted and returned for frontend countdowns.
- Due completed payments settle instead of being cancelled.
- Due pending payments call provider cancel once and become locally cancelled.
- Failed provider cancellation remains pending and is retryable.
- Concurrent cancellation/settlement and duplicate expiry reconciliation preserve one terminal state.

Service/API coverage:

- Order creation forwards the server-calculated multi-month total to Pakasir.
- Subscription response exposes active, queued, and coverage end data.
- Request-time reconciliation repairs a due period when cron has not run.
- Payment and notification history accurately distinguish immediate activation from queued activation.

## Rollout

1. Apply the database migration before deploying application code.
2. Deploy backend changes with one-month default compatibility.
3. Verify a sandbox one-month purchase, duplicate webhook behavior, and first monthly grant.
4. Verify a second purchase queues rather than replacing the active period.
5. Enable the 3/6/12-month choices in the frontend.
6. Monitor payment settlement errors, activation errors, and duplicate-grant constraints.

