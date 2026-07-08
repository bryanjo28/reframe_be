alter table public.subscription_plans enable row level security;
alter table public.user_subscriptions enable row level security;

alter table public.subscription_plans
add column if not exists daily_topic_generations integer not null default 0;

alter table public.subscription_plans
add column if not exists daily_content_generations integer not null default 0;

alter table public.user_subscriptions
add column if not exists status text;

update public.user_subscriptions
set status = 'active'
where status is null;

alter table public.user_subscriptions
alter column status set default 'active';

alter table public.user_subscriptions
alter column status set not null;

alter table public.user_subscriptions
drop constraint if exists user_subscriptions_status_check;

alter table public.user_subscriptions
add constraint user_subscriptions_status_check
check (status in ('active', 'inactive', 'paused', 'cancelled', 'expired'));

create unique index if not exists user_subscriptions_one_active_per_user_idx
on public.user_subscriptions (user_id)
where status = 'active';

create table if not exists public.user_daily_usage (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  usage_date date not null,
  usage_key text not null,
  request_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_daily_usage_pkey primary key (id),
  constraint user_daily_usage_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint user_daily_usage_usage_key_check check (usage_key in ('generate_topic', 'generate_content')),
  constraint user_daily_usage_unique unique (user_id, usage_date, usage_key)
);

alter table public.user_daily_usage enable row level security;

drop policy if exists "Users can view subscription plans" on public.subscription_plans;
create policy "Users can view subscription plans"
on public.subscription_plans
for select
using (
  auth.uid() is not null
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can manage subscription plans" on public.subscription_plans;
create policy "Admins can manage subscription plans"
on public.subscription_plans
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can update subscription plans" on public.subscription_plans;
create policy "Admins can update subscription plans"
on public.subscription_plans
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can delete subscription plans" on public.subscription_plans;
create policy "Admins can delete subscription plans"
on public.subscription_plans
for delete
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can view own subscriptions or admins can view all" on public.user_subscriptions;
create policy "Users can view own subscriptions or admins can view all"
on public.user_subscriptions
for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can insert subscriptions" on public.user_subscriptions;
create policy "Admins can insert subscriptions"
on public.user_subscriptions
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can update subscriptions" on public.user_subscriptions;
create policy "Admins can update subscriptions"
on public.user_subscriptions
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can delete subscriptions" on public.user_subscriptions;
create policy "Admins can delete subscriptions"
on public.user_subscriptions
for delete
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can view own daily usage or admins can view all" on public.user_daily_usage;
create policy "Users can view own daily usage or admins can view all"
on public.user_daily_usage
for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can insert own daily usage or admins can insert any" on public.user_daily_usage;
create policy "Users can insert own daily usage or admins can insert any"
on public.user_daily_usage
for insert
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can update own daily usage or admins can update all" on public.user_daily_usage;
create policy "Users can update own daily usage or admins can update all"
on public.user_daily_usage
for update
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admins can delete daily usage" on public.user_daily_usage;
create policy "Admins can delete daily usage"
on public.user_daily_usage
for delete
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
