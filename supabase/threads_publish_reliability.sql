-- Persist per-sequence Threads progress for safe retries.
alter table public.published_posts
  add column if not exists creation_id text,
  add column if not exists publish_status text not null default 'success',
  add column if not exists publish_error_message text,
  add column if not exists publish_started_at timestamptz,
  add column if not exists publish_finished_at timestamptz;

alter table public.published_posts
  alter column publish_status set default 'success',
  alter column publish_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.published_posts'::regclass
      and conname = 'published_posts_publish_status_check'
  ) then
    alter table public.published_posts
      add constraint published_posts_publish_status_check
      check (publish_status in ('processing', 'success', 'failed', 'uncertain'));
  end if;
end $$;

create unique index if not exists uq_published_posts_output_sequence
  on public.published_posts (content_output_id, sequence_number);

-- Track ownership and freshness of Threads scheduled-job leases.
alter table public.scheduled_jobs
  add column if not exists locked_at timestamptz,
  add column if not exists lock_token uuid,
  add column if not exists heartbeat_at timestamptz;

create index if not exists idx_scheduled_jobs_running_threads_heartbeat
  on public.scheduled_jobs (heartbeat_at)
  where status = 'running' and job_type = 'threads_auto_post';
