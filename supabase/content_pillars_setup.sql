alter table public.content_pillars enable row level security;

create or replace function public.touch_content_pillars_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_content_pillars_updated_at on public.content_pillars;

create trigger on_content_pillars_updated_at
before update on public.content_pillars
for each row execute procedure public.touch_content_pillars_updated_at();

drop policy if exists "Users can view own content pillars" on public.content_pillars;
create policy "Users can view own content pillars"
on public.content_pillars
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own content pillars" on public.content_pillars;
create policy "Users can insert own content pillars"
on public.content_pillars
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own content pillars" on public.content_pillars;
create policy "Users can update own content pillars"
on public.content_pillars
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own content pillars" on public.content_pillars;
create policy "Users can delete own content pillars"
on public.content_pillars
for delete
using (auth.uid() = user_id);
