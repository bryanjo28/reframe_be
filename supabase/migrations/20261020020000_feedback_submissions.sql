-- Store signed-in user feedback for review in the admin dashboard.
-- The API verifies the user's Supabase session before inserting with its
-- server-only service-role client. No direct Data API access is granted.
create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_email text not null,
  user_name text,
  message text not null check (char_length(btrim(message)) between 10 and 5000),
  page_path text check (page_path is null or (page_path like '/%' and char_length(page_path) <= 200)),
  created_at timestamptz not null default now()
);

create index if not exists feedback_submissions_created_at_idx
  on public.feedback_submissions (created_at desc);
create index if not exists feedback_submissions_user_id_created_at_idx
  on public.feedback_submissions (user_id, created_at desc);

alter table public.feedback_submissions enable row level security;
revoke all on public.feedback_submissions from public, anon, authenticated;
grant select, insert on public.feedback_submissions to service_role;
