alter table public.published_posts enable row level security;

drop policy if exists "Users can view own published posts" on public.published_posts;
create policy "Users can view own published posts"
on public.published_posts
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own published posts" on public.published_posts;
create policy "Users can insert own published posts"
on public.published_posts
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own published posts" on public.published_posts;
create policy "Users can update own published posts"
on public.published_posts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own published posts" on public.published_posts;
create policy "Users can delete own published posts"
on public.published_posts
for delete
using (auth.uid() = user_id);
