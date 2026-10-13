begin;

create table if not exists public.social_account_credentials (
  social_account_id uuid primary key
    references public.social_accounts (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.social_account_credentials enable row level security;
revoke all on table public.social_account_credentials from anon, authenticated;

insert into public.social_account_credentials (
  social_account_id,
  access_token,
  refresh_token,
  created_at,
  updated_at
)
select
  id,
  access_token,
  refresh_token,
  coalesce(created_at, now()),
  now()
from public.social_accounts
where access_token is not null
on conflict (social_account_id) do update
set access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    updated_at = now();

do $$
declare
  source_count bigint;
  copied_count bigint;
begin
  select count(*)
    into source_count
  from public.social_accounts
  where access_token is not null;

  select count(*)
    into copied_count
  from public.social_accounts accounts
  join public.social_account_credentials credentials
    on credentials.social_account_id = accounts.id
   and credentials.access_token = accounts.access_token
   and credentials.refresh_token is not distinct from accounts.refresh_token
  where accounts.access_token is not null;

  if copied_count <> source_count then
    raise exception 'Credential migration verification failed: copied % of % rows',
      copied_count,
      source_count;
  end if;
end;
$$;

alter table public.social_accounts
  drop column if exists access_token,
  drop column if exists refresh_token;

commit;
