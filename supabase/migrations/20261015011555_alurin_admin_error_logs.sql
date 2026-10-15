-- Store sanitized server-side API failures for authorized admin monitoring.
-- Request bodies, credentials, and stack traces are intentionally excluded.
create table if not exists public.admin_error_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid,
  method text not null,
  path text not null,
  status_code integer not null check (status_code between 500 and 599),
  error_code text not null,
  error_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists admin_error_logs_request_id_uidx
  on public.admin_error_logs (request_id);
create index if not exists admin_error_logs_created_at_idx
  on public.admin_error_logs (created_at desc);
create index if not exists admin_error_logs_status_created_at_idx
  on public.admin_error_logs (status_code, created_at desc);

alter table public.admin_error_logs enable row level security;
revoke all on public.admin_error_logs from public, anon, authenticated;
grant select, insert on public.admin_error_logs to service_role;
