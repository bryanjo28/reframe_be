alter table public.social_accounts
  alter column access_token drop not null;

alter table public.social_accounts
  alter column refresh_token drop not null;
