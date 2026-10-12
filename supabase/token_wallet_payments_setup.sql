-- Provider-agnostic payment and token foundation. Safe to run repeatedly.
create table if not exists public.token_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  kind text not null check (kind in ('plan_grant','topup','ai_usage','adjustment','refund')),
  description text,
  reference_type text,
  reference_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists token_ledger_idempotency_idx
  on public.token_ledger(user_id, reference_type, reference_id)
  where reference_id is not null;

create table if not exists public.token_packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  token_amount bigint not null check (token_amount > 0),
  price_idr bigint not null check (price_idr >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  package_id uuid not null references public.token_packages(id),
  amount_idr bigint not null check (amount_idr >= 0),
  token_amount bigint not null check (token_amount > 0),
  status text not null default 'pending' check (status in ('pending','paid','failed','expired','cancelled','refunded')),
  provider text,
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.token_wallets enable row level security;
alter table public.token_ledger enable row level security;
alter table public.token_packages enable row level security;
alter table public.payment_orders enable row level security;
alter table public.user_notifications enable row level security;

grant select on public.token_wallets, public.token_ledger, public.token_packages, public.payment_orders, public.user_notifications to authenticated;
revoke insert, update, delete on public.token_wallets, public.token_ledger, public.payment_orders from anon, authenticated;
revoke insert, update, delete on public.token_packages from anon, authenticated;
revoke insert, delete on public.user_notifications from anon, authenticated;
grant update (read_at) on public.user_notifications to authenticated;

drop policy if exists "read own wallet" on public.token_wallets;
create policy "read own wallet" on public.token_wallets for select using ((select auth.uid()) = user_id);
drop policy if exists "read own token ledger" on public.token_ledger;
create policy "read own token ledger" on public.token_ledger for select using ((select auth.uid()) = user_id);
drop policy if exists "read active token packages" on public.token_packages;
create policy "read active token packages" on public.token_packages for select using (is_active = true);
drop policy if exists "read own payment orders" on public.payment_orders;
create policy "read own payment orders" on public.payment_orders for select using ((select auth.uid()) = user_id);
drop policy if exists "read own notifications" on public.user_notifications;
create policy "read own notifications" on public.user_notifications for select using ((select auth.uid()) = user_id);
drop policy if exists "mark own notifications read" on public.user_notifications;
create policy "mark own notifications read" on public.user_notifications for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into public.token_packages(code,name,token_amount,price_idr,sort_order) values
  ('starter','Starter',10000,25000,10), ('creator','Creator',25000,50000,20), ('growth','Growth',60000,100000,30)
on conflict (code) do update set name=excluded.name, token_amount=excluded.token_amount, price_idr=excluded.price_idr, sort_order=excluded.sort_order;

create or replace function public.consume_ai_tokens(p_user_id uuid, p_amount bigint, p_reference_id text, p_description text default 'Pemakaian AI')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_balance bigint; v_new_balance bigint;
begin
  if p_amount <= 0 then raise exception 'Token amount must be positive'; end if;
  insert into token_wallets(user_id,balance) values(p_user_id,0) on conflict do nothing;
  select balance into v_balance from token_wallets where user_id=p_user_id for update;
  if exists(select 1 from token_ledger where user_id=p_user_id and reference_type='ai_request' and reference_id=p_reference_id) then
    return jsonb_build_object('balance',v_balance,'creditsUsed',0,'duplicate',true);
  end if;
  if v_balance < p_amount then raise exception using message='Token penggunaan kamu tidak cukup.', errcode='P0001'; end if;
  v_new_balance := v_balance-p_amount;
  update token_wallets set balance=v_new_balance,updated_at=now() where user_id=p_user_id;
  insert into token_ledger(user_id,amount,balance_after,kind,description,reference_type,reference_id)
  values(p_user_id,-p_amount,v_new_balance,'ai_usage',p_description,'ai_request',p_reference_id);
  return jsonb_build_object('balance',v_new_balance,'remainingCredits',v_new_balance,'creditsUsed',p_amount);
end $$;

create or replace function public.settle_payment_order(p_order_id uuid, p_provider text, p_provider_reference text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order payment_orders%rowtype; v_balance bigint; v_new_balance bigint;
begin
  select * into v_order from payment_orders where id=p_order_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  if v_order.status='paid' then select balance into v_balance from token_wallets where user_id=v_order.user_id; return jsonb_build_object('status','paid','balance',coalesce(v_balance,0),'duplicate',true); end if;
  if v_order.status<>'pending' then raise exception 'Payment order cannot be settled'; end if;
  insert into token_wallets(user_id,balance) values(v_order.user_id,0) on conflict do nothing;
  select balance into v_balance from token_wallets where user_id=v_order.user_id for update;
  v_new_balance:=v_balance+v_order.token_amount;
  update token_wallets set balance=v_new_balance,updated_at=now() where user_id=v_order.user_id;
  update payment_orders set status='paid',provider=p_provider,provider_reference=p_provider_reference,paid_at=now(),updated_at=now() where id=p_order_id;
  insert into token_ledger(user_id,amount,balance_after,kind,description,reference_type,reference_id)
  values(v_order.user_id,v_order.token_amount,v_new_balance,'topup','Top up token','payment_order',p_order_id::text);
  insert into user_notifications(user_id,type,title,message) values(v_order.user_id,'payment_success','Pembayaran berhasil',format('%s token sudah masuk ke saldo kamu.',v_order.token_amount));
  return jsonb_build_object('status','paid','balance',v_new_balance,'tokensAdded',v_order.token_amount);
end $$;

revoke all on function public.consume_ai_tokens(uuid,bigint,text,text) from public, anon, authenticated;
revoke all on function public.settle_payment_order(uuid,text,text) from public, anon, authenticated;
grant execute on function public.consume_ai_tokens(uuid,bigint,text,text) to service_role;
grant execute on function public.settle_payment_order(uuid,text,text) to service_role;

create or replace function public.grant_subscription_tokens()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_amount bigint; v_balance bigint; v_reference text;
begin
  if new.status <> 'active' then return new; end if;
  v_reference := new.id::text;
  if exists(select 1 from token_ledger where user_id=new.user_id and reference_type='subscription' and reference_id=v_reference) then return new; end if;
  select monthly_ai_credits into v_amount from subscription_plans where id=new.plan_id;
  if coalesce(v_amount,0)<=0 then return new; end if;
  insert into token_wallets(user_id,balance) values(new.user_id,0) on conflict do nothing;
  select balance into v_balance from token_wallets where user_id=new.user_id for update;
  update token_wallets set balance=v_balance+v_amount,updated_at=now() where user_id=new.user_id;
  insert into token_ledger(user_id,amount,balance_after,kind,description,reference_type,reference_id)
  values(new.user_id,v_amount,v_balance+v_amount,'plan_grant','Token dari paket subscription','subscription',v_reference);
  insert into user_notifications(user_id,type,title,message) values(new.user_id,'tokens_added','Token ditambahkan',format('%s token dari paket kamu sudah aktif.',v_amount));
  return new;
end $$;
drop trigger if exists user_subscription_token_grant on public.user_subscriptions;
create trigger user_subscription_token_grant after insert or update of status,plan_id on public.user_subscriptions for each row execute function public.grant_subscription_tokens();
revoke all on function public.grant_subscription_tokens() from public, anon, authenticated;

-- Give existing users their remaining plan allowance once during migration.
insert into public.token_wallets(user_id,balance)
select us.user_id, greatest(0, coalesce(sp.monthly_ai_credits,0)-coalesce(uu.ai_credits_used,0))
from public.user_subscriptions us join public.subscription_plans sp on sp.id=us.plan_id
left join public.user_usage uu on uu.user_id=us.user_id and uu.period_month=date_trunc('month',now())::date
where us.status='active' on conflict(user_id) do nothing;
