-- Additive administrator access foundation. Apply after reviewing against the
-- target database schema; this file does not change existing user records.

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  result_status text not null default 'success'
    check (result_status in ('success', 'failure')),
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_admin_user_id_idx
  on public.admin_audit_logs (admin_user_id, created_at desc);

alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_audit_logs from anon, authenticated;
grant select, insert on public.admin_audit_logs to service_role;

-- Users can edit their own profile fields, but must never grant themselves a
-- role through the exposed Supabase Data API.
revoke update on public.profiles from anon, authenticated;
grant update (account_name, full_name) on public.profiles to authenticated;

create or replace function public.prevent_client_profile_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and pg_catalog.current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Profile role changes are restricted to the backend administrator process';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_client_profile_role_change() from public, anon, authenticated;
drop trigger if exists prevent_client_profile_role_change on public.profiles;
create trigger prevent_client_profile_role_change
before update of role on public.profiles
for each row execute function public.prevent_client_profile_role_change();

-- First-admin provisioning is deliberately unavailable to normal sessions.
-- The backend bootstrap script calls this function with its service-role
-- client. A transaction-scoped lock prevents concurrent first-admin grants.
create or replace function public.bootstrap_first_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Backend service role required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(774611209);

  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception using errcode = '55000', message = 'An administrator is already provisioned';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id)
     or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception using errcode = '22023', message = 'Target user profile does not exist';
  end if;

  update public.profiles set role = 'admin' where id = p_user_id and role = 'user';

  if not found then
    raise exception using errcode = '55000', message = 'Target user is not eligible for first-admin provisioning';
  end if;

  insert into public.admin_audit_logs (
    admin_user_id, action, target_type, target_id, previous_values, new_values, reason
  ) values (
    p_user_id,
    'admin.bootstrap_first_admin',
    'profile',
    p_user_id::text,
    pg_catalog.jsonb_build_object('role', 'user'),
    pg_catalog.jsonb_build_object('role', 'admin'),
    'First administrator provisioned through the backend bootstrap process.'
  );
end;
$$;

revoke all on function public.bootstrap_first_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid) to service_role;

-- Additional administrator provisioning is also backend-only and audited.
-- This is separate from the one-time first-admin bootstrap because an
-- installation may already have its initial administrator.
create or replace function public.grant_admin_role(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_role text;
begin
  if pg_catalog.current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Backend service role required';
  end if;

  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) < 8 then
    raise exception using errcode = '22023', message = 'A meaningful audit reason is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(774611210);

  if not exists (select 1 from auth.users where id = p_user_id and deleted_at is null) then
    raise exception using errcode = '22023', message = 'Target auth user does not exist';
  end if;

  select role into v_previous_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Target user profile does not exist';
  end if;

  if v_previous_role = 'admin' then
    return;
  end if;
  if v_previous_role <> 'user' then
    raise exception using errcode = '55000', message = 'Target profile cannot be granted admin role';
  end if;

  update public.profiles set role = 'admin' where id = p_user_id;

  insert into public.admin_audit_logs (
    admin_user_id, action, target_type, target_id, previous_values, new_values, reason
  ) values (
    p_user_id,
    'admin.grant_role',
    'profile',
    p_user_id::text,
    pg_catalog.jsonb_build_object('role', v_previous_role),
    pg_catalog.jsonb_build_object('role', 'admin'),
    pg_catalog.left(pg_catalog.btrim(p_reason), 500)
  );
end;
$$;

revoke all on function public.grant_admin_role(uuid, text) from public, anon, authenticated;
grant execute on function public.grant_admin_role(uuid, text) to service_role;
