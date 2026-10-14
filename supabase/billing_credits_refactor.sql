-- Additive billing/credit migration. It intentionally preserves legacy wallet and history tables.
alter table public.subscription_plans add column if not exists token_allowance bigint not null default 0;
alter table public.subscription_plans add column if not exists currency text not null default 'IDR';
alter table public.subscription_plans add column if not exists max_content_pillars integer not null default 1 check (max_content_pillars >= 0);
alter table public.subscription_plans add column if not exists max_threads_accounts integer not null default 0 check (max_threads_accounts >= 0);
alter table public.subscription_plans add column if not exists can_schedule boolean not null default false;
alter table public.user_subscriptions add column if not exists current_period_start timestamptz;
alter table public.user_subscriptions add column if not exists current_period_end timestamptz;
alter table public.user_subscriptions add column if not exists payment_reference text;

create table if not exists public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  credit_type text not null check (credit_type in ('free','subscription','topup')),
  original_credits integer not null check (original_credits > 0),
  remaining_credits integer not null check (remaining_credits >= 0 and remaining_credits <= original_credits),
  reserved_credits integer not null default 0 check (reserved_credits >= 0 and reserved_credits <= remaining_credits),
  expires_at timestamptz,
  source_reference text not null,
  created_at timestamptz not null default now(),
  unique(user_id, credit_type, source_reference)
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_type text not null, credits_delta integer not null, balance_after integer not null check (balance_after >= 0),
  source_type text not null, source_id text, idempotency_key text not null unique, created_at timestamptz not null default now()
);

create table if not exists public.ai_credit_reservations (
  request_id text primary key, user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null, reserved_credits integer not null check (reserved_credits > 0),
  status text not null default 'reserved' check (status in ('reserved','settled','released')),
  created_at timestamptz not null default now(), settled_at timestamptz
);

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  request_id text not null unique, feature text not null, model text not null,
  input_tokens integer not null default 0, cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0, total_tokens integer not null default 0,
  estimated_cost_idr numeric(14,2) not null default 0, actual_cost_usd numeric(18,8) not null default 0,
  credits_charged integer not null default 0, status text not null, created_at timestamptz not null default now()
);

alter table public.payment_orders add column if not exists credits integer;
alter table public.payment_orders add column if not exists payment_reference text;

alter table public.credit_lots enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.ai_credit_reservations enable row level security;
alter table public.ai_usage_logs enable row level security;
grant select on public.credit_lots, public.credit_transactions, public.ai_usage_logs to authenticated;
grant all on public.credit_lots, public.credit_transactions, public.ai_credit_reservations, public.ai_usage_logs to service_role;
revoke insert, update, delete on public.credit_lots, public.credit_transactions, public.ai_credit_reservations, public.ai_usage_logs from anon, authenticated;
drop policy if exists "read own credit lots" on public.credit_lots;
create policy "read own credit lots" on public.credit_lots for select using ((select auth.uid())=user_id);
drop policy if exists "read own credit transactions" on public.credit_transactions;
create policy "read own credit transactions" on public.credit_transactions for select using ((select auth.uid())=user_id);
drop policy if exists "read own ai usage" on public.ai_usage_logs;
create policy "read own ai usage" on public.ai_usage_logs for select using ((select auth.uid())=user_id);

insert into public.subscription_plans(code,name,price,max_personas,max_content_pillars,max_threads_accounts,can_schedule,monthly_ai_credits,token_allowance,is_active) values
 ('free','Free',0,1,1,0,false,6,30000,true),('starter','Starter',29000,2,3,1,true,200,1000000,true),
 ('creator','Creator',59000,5,10,1,true,600,3000000,true),('pro','Pro',99000,10,20,1,true,1200,6000000,true)
on conflict(code) do update set name=excluded.name,price=excluded.price,max_personas=excluded.max_personas,
 max_content_pillars=excluded.max_content_pillars,max_threads_accounts=excluded.max_threads_accounts,
 can_schedule=excluded.can_schedule,monthly_ai_credits=excluded.monthly_ai_credits,
 token_allowance=excluded.token_allowance,is_active=true;

-- Database enforcement protects the limits even if a caller bypasses the API.
-- Existing rows are preserved on downgrade; only future inserts are rejected.
create or replace function public.enforce_alurin_entitlement()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan public.subscription_plans%rowtype; v_count integer; v_limit integer; v_resource text;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || tg_table_name,0));
 select sp.* into v_plan from public.user_subscriptions us
 join public.subscription_plans sp on sp.id=us.plan_id
 where us.user_id=new.user_id and us.status='active' and sp.is_active=true
   and (us.ends_at is null or us.ends_at>now())
 order by us.started_at desc limit 1;
 if not found then select * into v_plan from public.subscription_plans where code='free' and is_active=true limit 1; end if;
 if tg_table_name='persona_configs' then v_resource:='Persona'; v_limit:=v_plan.max_personas;
 elsif tg_table_name='content_pillars' then v_resource:='Content Pillar'; v_limit:=v_plan.max_content_pillars;
 elsif tg_table_name='social_accounts' and new.platform='threads' then
   if v_plan.max_threads_accounts<1 then raise exception using message='Connect Threads tersedia mulai dari paket Starter. Upgrade paket untuk menghubungkan akun Threads.',errcode='P0001'; end if;
   select count(*) into v_count from public.social_accounts where user_id=new.user_id and platform='threads';
   if v_count>=v_plan.max_threads_accounts then raise exception using message='Batas akun Threads pada paket kamu sudah tercapai.',errcode='P0001'; end if;
   return new;
 elsif tg_table_name='scheduled_jobs' then
   if not coalesce(v_plan.can_schedule,false) or v_plan.code='free' then raise exception using message='Schedule Post tersedia mulai dari paket Starter. Upgrade untuk menjadwalkan konten Threads kamu secara otomatis.',errcode='P0001'; end if;
   return new;
 else return new; end if;
 execute format('select count(*) from public.%I where user_id=$1',tg_table_name) into v_count using new.user_id;
 if v_count>=v_limit then raise exception using message='Batas Persona atau Content Pillar pada paket kamu sudah tercapai. Upgrade paket untuk menambahkan lebih banyak.',errcode='P0001',detail=v_resource||' limit reached'; end if;
 return new;
end $$;
revoke all on function public.enforce_alurin_entitlement() from public,anon,authenticated;
drop trigger if exists enforce_persona_entitlement on public.persona_configs;
create trigger enforce_persona_entitlement before insert on public.persona_configs for each row execute function public.enforce_alurin_entitlement();
drop trigger if exists enforce_pillar_entitlement on public.content_pillars;
create trigger enforce_pillar_entitlement before insert on public.content_pillars for each row execute function public.enforce_alurin_entitlement();
drop trigger if exists enforce_threads_entitlement on public.social_accounts;
create trigger enforce_threads_entitlement before insert on public.social_accounts for each row execute function public.enforce_alurin_entitlement();
drop trigger if exists enforce_schedule_entitlement on public.scheduled_jobs;
create trigger enforce_schedule_entitlement before insert on public.scheduled_jobs for each row execute function public.enforce_alurin_entitlement();

insert into public.token_packages(code,name,token_amount,price_idr,sort_order,is_active) values
 ('mini','Mini',100,15000,10,true),('basic','Basic',250,29000,20,true),
 ('plus','Plus',500,49000,30,true),('max','Max',1000,89000,40,true)
on conflict(code) do update set name=excluded.name,token_amount=excluded.token_amount,price_idr=excluded.price_idr,sort_order=excluded.sort_order,is_active=true;

create or replace function public.current_credit_balance(p_user_id uuid) returns integer language sql stable security definer set search_path=public as $$
 select coalesce(sum(remaining_credits),0)::integer from credit_lots where user_id=p_user_id and remaining_credits>0 and (expires_at is null or expires_at>now())
$$;
revoke all on function public.current_credit_balance(uuid) from public,anon,authenticated;
grant execute on function public.current_credit_balance(uuid) to service_role;

create or replace function public.reserve_ai_credits(p_user_id uuid,p_request_id text,p_feature text,p_credits integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_available integer; v_reserved integer; v_existing ai_credit_reservations%rowtype;
begin
 if p_credits<=0 then raise exception 'Credits must be positive'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select * into v_existing from ai_credit_reservations where request_id=p_request_id;
 if found then
   if v_existing.user_id<>p_user_id then raise exception 'Request id belongs to another user'; end if;
   return jsonb_build_object('requestId',p_request_id,'reservedCredits',v_existing.reserved_credits,'duplicate',true);
 end if;
 select coalesce(sum(remaining_credits-reserved_credits),0)::integer into v_available from credit_lots
  where user_id=p_user_id and remaining_credits>reserved_credits and (expires_at is null or expires_at>now());
 select coalesce(sum(reserved_credits),0)::integer into v_reserved from ai_credit_reservations where user_id=p_user_id and status='reserved';
 v_available:=greatest(0,v_available-v_reserved);
 if v_available<p_credits then raise exception 'Insufficient AI credits'; end if;
 insert into ai_credit_reservations(request_id,user_id,feature,reserved_credits) values(p_request_id,p_user_id,p_feature,p_credits);
 -- Reservation is represented centrally; advisory locking prevents concurrent over-reservation.
 return jsonb_build_object('requestId',p_request_id,'reservedCredits',p_credits,'availableCredits',v_available-p_credits);
end $$;

create or replace function public.settle_ai_credits(
 p_user_id uuid,p_request_id text,p_feature text,p_model text,p_input_tokens integer,p_cached_input_tokens integer,
 p_output_tokens integer,p_total_tokens integer,p_estimated_cost_idr numeric,p_actual_cost_usd numeric,p_credits_charged integer,p_usage_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_res ai_credit_reservations%rowtype; v_lot record; v_need integer; v_take integer; v_balance integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select * into v_res from ai_credit_reservations where request_id=p_request_id for update;
 if not found or v_res.user_id<>p_user_id then raise exception 'Credit reservation not found'; end if;
 if v_res.status='settled' then return jsonb_build_object('duplicate',true,'creditsUsed',p_credits_charged,'balance',current_credit_balance(p_user_id)); end if;
 if v_res.status<>'reserved' then raise exception 'Credit reservation is not active'; end if;
 if p_credits_charged>v_res.reserved_credits then raise exception 'Actual usage exceeds reserved credit limit'; end if;
 v_need:=greatest(p_credits_charged,0);
 for v_lot in select * from credit_lots where user_id=p_user_id and remaining_credits>0 and (expires_at is null or expires_at>now())
   order by case when credit_type='topup' then 1 else 0 end, expires_at asc nulls last, created_at asc for update
 loop
   exit when v_need=0; v_take:=least(v_need,v_lot.remaining_credits);
   update credit_lots set remaining_credits=remaining_credits-v_take where id=v_lot.id; v_need:=v_need-v_take;
 end loop;
 if v_need>0 then raise exception 'Insufficient AI credits during settlement'; end if;
 update ai_credit_reservations set status='settled',settled_at=now() where request_id=p_request_id;
 insert into ai_usage_logs(user_id,request_id,feature,model,input_tokens,cached_input_tokens,output_tokens,total_tokens,estimated_cost_idr,actual_cost_usd,credits_charged,status)
 values(p_user_id,p_request_id,p_feature,p_model,greatest(p_input_tokens,0),least(greatest(p_cached_input_tokens,0),greatest(p_input_tokens,0)),greatest(p_output_tokens,0),greatest(p_total_tokens,0),p_estimated_cost_idr,p_actual_cost_usd,p_credits_charged,p_usage_status)
 on conflict(request_id) do nothing;
 v_balance:=current_credit_balance(p_user_id);
 insert into credit_transactions(user_id,transaction_type,credits_delta,balance_after,source_type,source_id,idempotency_key)
 values(p_user_id,'ai_usage',-p_credits_charged,v_balance,'ai_request',p_request_id,'ai:settle:'||p_request_id) on conflict(idempotency_key) do nothing;
 return jsonb_build_object('creditsUsed',p_credits_charged,'balance',v_balance,'releasedCredits',v_res.reserved_credits-p_credits_charged);
end $$;

create or replace function public.release_ai_credit_reservation(p_user_id uuid,p_request_id text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_res ai_credit_reservations%rowtype;
begin
 select * into v_res from ai_credit_reservations where request_id=p_request_id for update;
 if not found or v_res.user_id<>p_user_id then return jsonb_build_object('released',false); end if;
 if v_res.status='reserved' then update ai_credit_reservations set status='released',settled_at=now() where request_id=p_request_id; end if;
 return jsonb_build_object('released',true,'credits',v_res.reserved_credits,'reason',p_reason);
end $$;

revoke all on function public.reserve_ai_credits(uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.settle_ai_credits(uuid,text,text,text,integer,integer,integer,integer,numeric,numeric,integer,text) from public,anon,authenticated;
revoke all on function public.release_ai_credit_reservation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_credits(uuid,text,text,integer) to service_role;
grant execute on function public.settle_ai_credits(uuid,text,text,text,integer,integer,integer,integer,numeric,numeric,integer,text) to service_role;
grant execute on function public.release_ai_credit_reservation(uuid,text,text) to service_role;

create or replace function public.settle_verified_topup(p_order_id uuid,p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order payment_orders%rowtype; v_credits integer; v_balance integer;
begin
 select * into v_order from payment_orders where id=p_order_id for update;
 if not found then raise exception 'Payment order not found'; end if;
 if v_order.status='paid' then return jsonb_build_object('duplicate',true,'balance',current_credit_balance(v_order.user_id)); end if;
 if v_order.status<>'pending' then raise exception 'Payment order cannot be settled'; end if;
 v_credits:=coalesce(v_order.credits,v_order.token_amount::integer);
 insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
 values(v_order.user_id,'topup',v_credits,v_credits,now()+interval '12 months','payment:'||v_order.id::text)
 on conflict(user_id,credit_type,source_reference) do nothing;
 update payment_orders set status='paid',provider='midtrans',provider_reference=p_provider_reference,payment_reference=p_provider_reference,paid_at=now(),updated_at=now() where id=p_order_id;
 v_balance:=current_credit_balance(v_order.user_id);
 insert into credit_transactions(user_id,transaction_type,credits_delta,balance_after,source_type,source_id,idempotency_key)
 values(v_order.user_id,'topup',v_credits,v_balance,'payment_order',v_order.id::text,'topup:'||v_order.id::text) on conflict(idempotency_key) do nothing;
 return jsonb_build_object('duplicate',false,'creditsAdded',v_credits,'balance',v_balance);
end $$;
revoke all on function public.settle_verified_topup(uuid,text) from public,anon,authenticated;
grant execute on function public.settle_verified_topup(uuid,text) to service_role;

create or replace function public.grant_subscription_credit_lot()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_plan subscription_plans%rowtype; v_source text; v_expiry timestamptz;
begin
 if new.status<>'active' then return new; end if;
 select * into v_plan from subscription_plans where id=new.plan_id;
 if not found or v_plan.monthly_ai_credits<=0 then return new; end if;
 if v_plan.code='free' then
   v_source:='registration:'||new.user_id::text; v_expiry:=null;
 else
   -- Paid credits require a server-verified payment reference and a concrete period.
   if new.payment_reference is null or new.current_period_start is null or new.current_period_end is null then return new; end if;
   v_source:='subscription:'||new.id::text||':'||new.current_period_start::date::text;
   v_expiry:=new.current_period_end;
 end if;
 insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
 values(new.user_id,case when v_plan.code='free' then 'free' else 'subscription' end,v_plan.monthly_ai_credits,v_plan.monthly_ai_credits,v_expiry,v_source)
 on conflict(user_id,credit_type,source_reference) do nothing;
 return new;
end $$;
drop trigger if exists grant_subscription_credit_lot_trigger on public.user_subscriptions;
create trigger grant_subscription_credit_lot_trigger after insert or update of status,plan_id,current_period_start,payment_reference on public.user_subscriptions
for each row execute function public.grant_subscription_credit_lot();
revoke all on function public.grant_subscription_credit_lot() from public,anon,authenticated;

-- Legacy plans, subscriptions, packages, and credit balances are intentionally
-- left untouched. The application exposes only the final sellable catalog;
-- existing subscribers remain grandfathered until they explicitly change plan.

-- Existing users are not reset. Seed only users with no credit lot at all.
insert into public.credit_lots(user_id,credit_type,original_credits,remaining_credits,source_reference)
select us.user_id,case when sp.code='free' then 'free' else 'subscription' end,sp.monthly_ai_credits,sp.monthly_ai_credits,
 case when sp.code='free' then 'legacy-free-registration' else 'legacy-subscription:'||us.id::text end
from public.user_subscriptions us join public.subscription_plans sp on sp.id=us.plan_id
where us.status='active' and sp.monthly_ai_credits>0 and not exists(select 1 from public.credit_lots cl where cl.user_id=us.user_id);
