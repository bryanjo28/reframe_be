alter table public.profiles enable row level security;
alter table public.persona_configs enable row level security;
alter table public.content_pillars enable row level security;
alter table public.content_topics enable row level security;
alter table public.scheduled_jobs enable row level security;
alter table public.scheduled_job_runs enable row level security;
alter table public.social_accounts enable row level security;
alter table public.content_outputs enable row level security;
alter table public.published_posts enable row level security;
alter table public.generation_logs enable row level security;
alter table public.reference_notes enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.user_usage enable row level security;
alter table public.ai_settings enable row level security;
alter table public.generation_topic_logs enable row level security;
alter table public.user_daily_usage enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, account_name, full_name)
  values (
    new.id,
    new.raw_user_meta_data->>'account_name',
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles
for select
using (auth.uid() = id or public.is_admin());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
using (auth.uid() = id or public.is_admin())
with check (auth.uid() = id or public.is_admin());

drop policy if exists "Users can view own persona configs" on public.persona_configs;
create policy "Users can view own persona configs"
on public.persona_configs
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own persona configs" on public.persona_configs;
create policy "Users can insert own persona configs"
on public.persona_configs
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own persona configs" on public.persona_configs;
create policy "Users can update own persona configs"
on public.persona_configs
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own persona configs" on public.persona_configs;
create policy "Users can delete own persona configs"
on public.persona_configs
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own content pillars" on public.content_pillars;
create policy "Users can view own content pillars"
on public.content_pillars
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own content pillars" on public.content_pillars;
create policy "Users can insert own content pillars"
on public.content_pillars
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own content pillars" on public.content_pillars;
create policy "Users can update own content pillars"
on public.content_pillars
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own content pillars" on public.content_pillars;
create policy "Users can delete own content pillars"
on public.content_pillars
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own content topics" on public.content_topics;
create policy "Users can view own content topics"
on public.content_topics
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own content topics" on public.content_topics;
create policy "Users can insert own content topics"
on public.content_topics
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own content topics" on public.content_topics;
create policy "Users can update own content topics"
on public.content_topics
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own content topics" on public.content_topics;
create policy "Users can delete own content topics"
on public.content_topics
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own scheduled jobs" on public.scheduled_jobs;
create policy "Users can view own scheduled jobs"
on public.scheduled_jobs
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own scheduled jobs" on public.scheduled_jobs;
create policy "Users can insert own scheduled jobs"
on public.scheduled_jobs
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own scheduled jobs" on public.scheduled_jobs;
create policy "Users can update own scheduled jobs"
on public.scheduled_jobs
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own scheduled jobs" on public.scheduled_jobs;
create policy "Users can delete own scheduled jobs"
on public.scheduled_jobs
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own scheduled job runs" on public.scheduled_job_runs;
create policy "Users can view own scheduled job runs"
on public.scheduled_job_runs
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own scheduled job runs" on public.scheduled_job_runs;
create policy "Users can insert own scheduled job runs"
on public.scheduled_job_runs
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own scheduled job runs" on public.scheduled_job_runs;
create policy "Users can update own scheduled job runs"
on public.scheduled_job_runs
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own scheduled job runs" on public.scheduled_job_runs;
create policy "Users can delete own scheduled job runs"
on public.scheduled_job_runs
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own social accounts" on public.social_accounts;
create policy "Users can view own social accounts"
on public.social_accounts
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own social accounts" on public.social_accounts;
create policy "Users can insert own social accounts"
on public.social_accounts
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own social accounts" on public.social_accounts;
create policy "Users can update own social accounts"
on public.social_accounts
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own social accounts" on public.social_accounts;
create policy "Users can delete own social accounts"
on public.social_accounts
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own content outputs" on public.content_outputs;
create policy "Users can view own content outputs"
on public.content_outputs
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own content outputs" on public.content_outputs;
create policy "Users can insert own content outputs"
on public.content_outputs
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own content outputs" on public.content_outputs;
create policy "Users can update own content outputs"
on public.content_outputs
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own content outputs" on public.content_outputs;
create policy "Users can delete own content outputs"
on public.content_outputs
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own published posts" on public.published_posts;
create policy "Users can view own published posts"
on public.published_posts
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own published posts" on public.published_posts;
create policy "Users can insert own published posts"
on public.published_posts
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own published posts" on public.published_posts;
create policy "Users can update own published posts"
on public.published_posts
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own published posts" on public.published_posts;
create policy "Users can delete own published posts"
on public.published_posts
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own generation logs" on public.generation_logs;
create policy "Users can view own generation logs"
on public.generation_logs
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own generation logs" on public.generation_logs;
create policy "Users can insert own generation logs"
on public.generation_logs
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own generation logs" on public.generation_logs;
create policy "Users can update own generation logs"
on public.generation_logs
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own generation logs" on public.generation_logs;
create policy "Users can delete own generation logs"
on public.generation_logs
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own reference notes" on public.reference_notes;
create policy "Users can view own reference notes"
on public.reference_notes
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own reference notes" on public.reference_notes;
create policy "Users can insert own reference notes"
on public.reference_notes
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own reference notes" on public.reference_notes;
create policy "Users can update own reference notes"
on public.reference_notes
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own reference notes" on public.reference_notes;
create policy "Users can delete own reference notes"
on public.reference_notes
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view subscription plans" on public.subscription_plans;
create policy "Users can view subscription plans"
on public.subscription_plans
for select
using (auth.uid() is not null or public.is_admin());

drop policy if exists "Admins can insert subscription plans" on public.subscription_plans;
create policy "Admins can insert subscription plans"
on public.subscription_plans
for insert
with check (public.is_admin());

drop policy if exists "Admins can update subscription plans" on public.subscription_plans;
create policy "Admins can update subscription plans"
on public.subscription_plans
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete subscription plans" on public.subscription_plans;
create policy "Admins can delete subscription plans"
on public.subscription_plans
for delete
using (public.is_admin());

drop policy if exists "Users can view own subscriptions" on public.user_subscriptions;
create policy "Users can view own subscriptions"
on public.user_subscriptions
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admins can insert subscriptions" on public.user_subscriptions;
create policy "Admins can insert subscriptions"
on public.user_subscriptions
for insert
with check (public.is_admin());

drop policy if exists "Admins can update subscriptions" on public.user_subscriptions;
create policy "Admins can update subscriptions"
on public.user_subscriptions
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete subscriptions" on public.user_subscriptions;
create policy "Admins can delete subscriptions"
on public.user_subscriptions
for delete
using (public.is_admin());

drop policy if exists "Users can view own monthly usage" on public.user_usage;
create policy "Users can view own monthly usage"
on public.user_usage
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admins can insert monthly usage" on public.user_usage;
create policy "Admins can insert monthly usage"
on public.user_usage
for insert
with check (public.is_admin());

drop policy if exists "Admins can update monthly usage" on public.user_usage;
create policy "Admins can update monthly usage"
on public.user_usage
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete monthly usage" on public.user_usage;
create policy "Admins can delete monthly usage"
on public.user_usage
for delete
using (public.is_admin());

drop policy if exists "Users can view own ai settings" on public.ai_settings;
create policy "Users can view own ai settings"
on public.ai_settings
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own ai settings" on public.ai_settings;
create policy "Users can insert own ai settings"
on public.ai_settings
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own ai settings" on public.ai_settings;
create policy "Users can update own ai settings"
on public.ai_settings
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own ai settings" on public.ai_settings;
create policy "Users can delete own ai settings"
on public.ai_settings
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own generation topic logs" on public.generation_topic_logs;
create policy "Users can view own generation topic logs"
on public.generation_topic_logs
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own generation topic logs" on public.generation_topic_logs;
create policy "Users can insert own generation topic logs"
on public.generation_topic_logs
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can update own generation topic logs" on public.generation_topic_logs;
create policy "Users can update own generation topic logs"
on public.generation_topic_logs
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can delete own generation topic logs" on public.generation_topic_logs;
create policy "Users can delete own generation topic logs"
on public.generation_topic_logs
for delete
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can view own daily usage" on public.user_daily_usage;
create policy "Users can view own daily usage"
on public.user_daily_usage
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admins can insert daily usage" on public.user_daily_usage;
create policy "Admins can insert daily usage"
on public.user_daily_usage
for insert
with check (public.is_admin());

drop policy if exists "Admins can update daily usage" on public.user_daily_usage;
create policy "Admins can update daily usage"
on public.user_daily_usage
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete daily usage" on public.user_daily_usage;
create policy "Admins can delete daily usage"
on public.user_daily_usage
for delete
using (public.is_admin());