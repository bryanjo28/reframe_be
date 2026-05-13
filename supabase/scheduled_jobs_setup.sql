alter table public.scheduled_jobs enable row level security;
alter table public.scheduled_job_runs enable row level security;

drop policy if exists "Users can view own scheduled jobs or admins can view all" on public.scheduled_jobs;
create policy "Users can view own scheduled jobs or admins can view all"
on public.scheduled_jobs
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

drop policy if exists "Users can insert own scheduled jobs or admins can insert any" on public.scheduled_jobs;
create policy "Users can insert own scheduled jobs or admins can insert any"
on public.scheduled_jobs
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

drop policy if exists "Users can update own scheduled jobs or admins can update all" on public.scheduled_jobs;
create policy "Users can update own scheduled jobs or admins can update all"
on public.scheduled_jobs
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

drop policy if exists "Users can delete own scheduled jobs or admins can delete all" on public.scheduled_jobs;
create policy "Users can delete own scheduled jobs or admins can delete all"
on public.scheduled_jobs
for delete
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can view own scheduled job runs or admins can view all" on public.scheduled_job_runs;
create policy "Users can view own scheduled job runs or admins can view all"
on public.scheduled_job_runs
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

drop policy if exists "Users can insert own scheduled job runs or admins can insert any" on public.scheduled_job_runs;
create policy "Users can insert own scheduled job runs or admins can insert any"
on public.scheduled_job_runs
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

drop policy if exists "Users can update own scheduled job runs or admins can update all" on public.scheduled_job_runs;
create policy "Users can update own scheduled job runs or admins can update all"
on public.scheduled_job_runs
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

drop policy if exists "Users can delete own scheduled job runs or admins can delete all" on public.scheduled_job_runs;
create policy "Users can delete own scheduled job runs or admins can delete all"
on public.scheduled_job_runs
for delete
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
