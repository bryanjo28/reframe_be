# Native execution: 2026-10-19-prepaid-multi-month-subscriptions

User authorized implementation in the current checkout; preserve existing full_schema.sql edits.
Baseline: npm test passed on 2026-10-19.
Ruling: SQL behavior requires executable database tests rather than source-string assertions; use available PostgreSQL tooling if possible and report any unavailable runtime.
Pre-flight: settlement -> period reconciliation -> subscription reads share the RPC and snapshot contracts. Payment polling and cron share the same verify lifecycle. Preserve existing subscription/plan response fields.

Tasks 1-5 implemented: executable migration tests and service tests passed; baseline regression suite passed after updating legacy fixtures for expiry and RPC behavior.
Ruling: preserve contract anniversary boundaries (explicit in implementation plan) rather than iteratively drifting after February; cost if wrong: expected monthly grant dates differ at month-end. Spec clarified accordingly.
Ruling: keep compatibility subscription/plan fields and add timeline fields; reconcile through an authenticated-owner wrapper with server time rather than exposing service-role clock arguments.
Final review: independent reviewer found inactive-catalog database entitlement fallback; regression reproduced RED and fixed GREEN by replacing existing entitlement trigger function. Month boundary ambiguity resolved above.

Task 6 complete: schema snapshot extended while preserving user's pre-existing edits; API guide covers deployment, duration, queue, expiry and polling.
Final verification: npm test (including pretest billing suite) exited 0. git diff --check passed.
Final fixed: scheduled_jobs trigger incorrectly referenced NEW.platform from a table without that column; executable SQL regression RED -> GREEN with table-specific nested access.
Final review findings resolved; no deferred minor findings. All changes remain in the user's current checkout for their commit/push. No live Supabase migration or Render deployment was performed.
Operational note: apply 20261019010000_prepaid_multi_month_subscriptions.sql before deploying, then enable CRON_JOB=TRUE (or external cron:run). Existing pending orders without saved expiry can recover it with the same-order checkout retry.
