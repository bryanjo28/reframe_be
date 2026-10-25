-- Apply manually before enabling HERMES_ALERT_ENABLED. Only service_role has access.
create table if not exists public.error_alert_outbox (
  id uuid primary key,
  fingerprint text not null,
  bucket bigint,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lock_token uuid,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists error_alert_pending_dedup on public.error_alert_outbox(fingerprint,bucket) where status='pending';
create index if not exists error_alert_due on public.error_alert_outbox(next_attempt_at) where status in ('pending','sending');
alter table public.error_alert_outbox enable row level security;
revoke all on public.error_alert_outbox from public, anon, authenticated;
grant all on public.error_alert_outbox to service_role;

create or replace function public.enqueue_error_alert(p_fingerprint text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.error_alert_outbox(id,fingerprint,bucket,payload)
  values ((p_payload->>'event_id')::uuid,p_fingerprint,floor(extract(epoch from clock_timestamp())/300)::bigint,p_payload)
  on conflict (fingerprint,bucket) where status='pending' do update
    set payload=jsonb_set(error_alert_outbox.payload,'{occurrences}',to_jsonb((error_alert_outbox.payload->>'occurrences')::integer+1));
end $$;

create or replace function public.claim_error_alerts()
returns setof public.error_alert_outbox language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.error_alert_outbox set status='failed', finished_at=now(),lock_token=null,locked_until=null
  where status='sending' and locked_until<now() and attempts>=5;
  return query
  with candidates as (
    select id from public.error_alert_outbox
    where attempts<5 and ((status='pending' and next_attempt_at<=now()) or (status='sending' and locked_until<now()))
    order by created_at for update skip locked limit 10
  )
  update public.error_alert_outbox q set status='sending',attempts=attempts+1,
    lock_token=gen_random_uuid(), locked_until=now()+interval '2 minutes'
  from candidates c where q.id=c.id returning q.*;
end $$;

create or replace function public.finish_error_alert(p_id uuid,p_lock_token uuid,p_success boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- NULL excludes retries from deduplication with newer pending events.
  update public.error_alert_outbox set
    status=case when p_success then 'sent' when attempts>=5 then 'failed' else 'pending' end,
    bucket=null,
    next_attempt_at=now()+make_interval(secs=>60*power(2,attempts-1)::integer),
    finished_at=case when p_success or attempts>=5 then now() else null end,
    lock_token=null,locked_until=null
  where id=p_id and lock_token=p_lock_token and status='sending' and locked_until>now();
end $$;

revoke all on function public.enqueue_error_alert(text,jsonb), public.claim_error_alerts(), public.finish_error_alert(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_error_alert(text,jsonb), public.claim_error_alerts(), public.finish_error_alert(uuid,uuid,boolean) to service_role;
