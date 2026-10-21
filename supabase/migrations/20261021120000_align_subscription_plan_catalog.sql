-- Align persisted plan entitlements with the customer-facing plan catalog.
-- Credits are captured in payment orders and granted only after verified payment.
begin;

alter table public.subscription_plans
  add column if not exists price numeric not null default 0,
  add column if not exists currency text not null default 'IDR',
  add column if not exists token_allowance bigint not null default 0,
  add column if not exists content_pillars integer not null default 1 check (content_pillars >= 0),
  add column if not exists max_threads_accounts integer not null default 1 check (max_threads_accounts >= 0),
  add column if not exists can_schedule boolean not null default true;

insert into public.subscription_plans (
  code,
  name,
  price,
  currency,
  max_personas,
  content_pillars,
  max_threads_accounts,
  can_schedule,
  monthly_ai_credits,
  token_allowance,
  is_active
)
values
  ('free', 'Free', 0, 'IDR', 1, 1, 0, false, 6, 30000, true),
  ('starter', 'Starter', 29000, 'IDR', 2, 3, 1, true, 200, 1000000, true),
  ('creator', 'Creator', 59000, 'IDR', 5, 10, 1, true, 600, 3000000, true),
  ('pro', 'Pro', 99000, 'IDR', 10, 20, 1, true, 1200, 6000000, true)
on conflict (code) do update set
  name = excluded.name,
  price = excluded.price,
  currency = excluded.currency,
  max_personas = excluded.max_personas,
  content_pillars = excluded.content_pillars,
  max_threads_accounts = excluded.max_threads_accounts,
  can_schedule = excluded.can_schedule,
  monthly_ai_credits = excluded.monthly_ai_credits,
  token_allowance = excluded.token_allowance,
  is_active = excluded.is_active;

commit;
