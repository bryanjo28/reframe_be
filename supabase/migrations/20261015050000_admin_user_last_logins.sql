-- Backend-only, bounded Auth lookup for the existing paginated admin user list.
begin;

create or replace function public.admin_user_last_logins(p_user_ids uuid[])
returns table (user_id uuid, last_login_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.cardinality(p_user_ids), 0) > 100 then
    raise invalid_parameter_value using message = 'At most 100 user IDs are allowed';
  end if;

  return query
    select u.id, u.last_sign_in_at
    from auth.users u
    where u.id = any(p_user_ids);
end;
$$;

revoke all on function public.admin_user_last_logins(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_user_last_logins(uuid[]) to service_role;

commit;
