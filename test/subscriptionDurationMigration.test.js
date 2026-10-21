const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261020120000_subscription_duration_pricing_and_reminders.sql'), 'utf8');
const priorMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261019010000_prepaid_multi_month_subscriptions.sql'), 'utf8');

assert.match(migration, /create table if not exists public\.subscription_pricing_config/);
assert.match(migration, /"defaultDurationMonths":3/);
assert.match(migration, /"enabledDurations":\[1,3,12\]/);
for (const amount of [29000, 74000, 249000, 59000, 149000, 499000, 99000, 839000]) assert.ok(migration.includes(String(amount)), `expected default IDR price ${amount}`);
assert.match(migration, /add column if not exists pricing_config_version integer/);
assert.match(migration, /payment_verification_source text/);
assert.match(migration, /create or replace function public\.publish_subscription_pricing\(p_config jsonb, p_admin_user_id uuid\)/);
assert.match(migration, /insert into public\.admin_audit_logs/);
assert.match(migration, /create or replace function public\.process_subscription_expiry_reminders/);
assert.match(migration, /unique \(contract_id, days_before\)/);
assert.match(migration, /on conflict\(idempotency_key\) do nothing/);
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_order\.user_id::text,0\)\)/);
assert.match(priorMigration, /generate_series\(1,v_months\)/);
assert.match(priorMigration, /on conflict\(user_id,credit_type,source_reference\) do nothing/);
assert.match(priorMigration, /subscription_month_boundary\(p_start timestamptz,p_months integer\)/);
assert.match(priorMigration, /p_start \+ make_interval\(months=>p_months\)/);
assert.doesNotMatch(priorMigration, /interval '\s*30 days'/);

console.log('Subscription duration migration invariants passed');
