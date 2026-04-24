alter table public.persona_configs
add column if not exists is_active boolean not null default true;

alter table public.persona_configs enable row level security;

create or replace function public.touch_persona_configs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_persona_configs_updated_at on public.persona_configs;

create trigger on_persona_configs_updated_at
before update on public.persona_configs
for each row execute procedure public.touch_persona_configs_updated_at();

drop policy if exists "Users can view own persona configs" on public.persona_configs;
create policy "Users can view own persona configs"
on public.persona_configs
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own persona configs" on public.persona_configs;
create policy "Users can insert own persona configs"
on public.persona_configs
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own persona configs" on public.persona_configs;
create policy "Users can update own persona configs"
on public.persona_configs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own persona configs" on public.persona_configs;
create policy "Users can delete own persona configs"
on public.persona_configs
for delete
using (auth.uid() = user_id);
