-- Apply before deploying the backend recovery worker. No historical usage is invented.
begin;

create index if not exists ai_credit_reservations_stale_idx
  on public.ai_credit_reservations (created_at, user_id) where status = 'reserved';

create or replace function public.recover_stale_ai_reservations(p_user_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_count integer;
  v_total integer := 0;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;

  for v_user_id in
    select distinct user_id from public.ai_credit_reservations
    where status = 'reserved' and created_at < now() - interval '30 minutes'
      and (p_user_id is null or user_id = p_user_id)
    order by user_id
    limit 100
  loop
    -- Same lock as reservation and settlement; recheck status after acquiring it.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
    update public.ai_credit_reservations
    set status = 'released', settled_at = now()
    where user_id = v_user_id and status = 'reserved'
      and created_at < now() - interval '30 minutes';
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.recover_stale_ai_reservations(uuid) from public, anon, authenticated;
grant execute on function public.recover_stale_ai_reservations(uuid) to service_role;

commit;
