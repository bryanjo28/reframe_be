alter table public.content_topics enable row level security;

drop policy if exists "Users can view own content topics or admins can view all" on public.content_topics;
create policy "Users can view own content topics or admins can view all"
on public.content_topics
for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can insert own content topics or admins can insert any" on public.content_topics;
create policy "Users can insert own content topics or admins can insert any"
on public.content_topics
for insert
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can update own content topics or admins can update all" on public.content_topics;
create policy "Users can update own content topics or admins can update all"
on public.content_topics
for update
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can delete own content topics or admins can delete all" on public.content_topics;
create policy "Users can delete own content topics or admins can delete all"
on public.content_topics
for delete
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
