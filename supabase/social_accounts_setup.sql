alter table public.social_accounts enable row level security;

drop policy if exists "Users can view own social accounts" on public.social_accounts;
create policy "Users can view own social accounts"
on public.social_accounts
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own social accounts" on public.social_accounts;
create policy "Users can insert own social accounts"
on public.social_accounts
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own social accounts" on public.social_accounts;
create policy "Users can update own social accounts"
on public.social_accounts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own social accounts" on public.social_accounts;
create policy "Users can delete own social accounts"
on public.social_accounts
for delete
using (auth.uid() = user_id);
