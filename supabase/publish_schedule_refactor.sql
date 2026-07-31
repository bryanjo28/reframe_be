alter table public.content_outputs
  add column if not exists publish_scheduled_job_id uuid,
  add column if not exists publish_scheduled_job_run_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_outputs_publish_scheduled_job_id_fkey'
  ) then
    alter table public.content_outputs
      add constraint content_outputs_publish_scheduled_job_id_fkey
      foreign key (publish_scheduled_job_id)
      references public.scheduled_jobs(id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_outputs_publish_scheduled_job_run_id_fkey'
  ) then
    alter table public.content_outputs
      add constraint content_outputs_publish_scheduled_job_run_id_fkey
      foreign key (publish_scheduled_job_run_id)
      references public.scheduled_job_runs(id);
  end if;
end $$;
