-- Apply after pakasir_payments_setup.sql and the existing billing migrations.
begin;
alter table public.payment_orders
  add column if not exists duration_months integer check (duration_months in (1,3,6,12)),
  add column if not exists monthly_price_idr bigint check (monthly_price_idr > 0),
  add column if not exists monthly_credits integer check (monthly_credits > 0),
  add column if not exists provider_expires_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

create table if not exists public.subscription_contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  payment_order_id uuid not null unique references public.payment_orders(id),
  provider_reference text not null,
  duration_months integer not null check (duration_months in (1,3,6,12)),
  monthly_price_idr bigint not null check (monthly_price_idr > 0),
  monthly_credits integer not null check (monthly_credits > 0),
  total_amount_idr bigint not null check (total_amount_idr > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','active','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table if not exists public.subscription_periods (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.subscription_contracts(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  sequence_number integer not null check (sequence_number between 1 and 12),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  monthly_credits integer not null check (monthly_credits > 0),
  status text not null default 'scheduled' check (status in ('scheduled','active','completed','cancelled')),
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contract_id,sequence_number),
  check (ends_at > starts_at)
);
alter table public.user_subscriptions add column if not exists subscription_period_id uuid references public.subscription_periods(id);
create unique index if not exists subscription_projection_period_unique on public.user_subscriptions(subscription_period_id) where subscription_period_id is not null;
create unique index if not exists subscription_one_active_period on public.subscription_periods(user_id) where status='active';
create index if not exists subscription_due_periods on public.subscription_periods(status,starts_at,ends_at);
create index if not exists subscription_user_contracts on public.subscription_contracts(user_id,ends_at);
create index if not exists payment_due_expiry on public.payment_orders(provider_expires_at) where status='pending' and provider='pakasir';

alter table public.subscription_contracts enable row level security;
alter table public.subscription_periods enable row level security;
drop policy if exists read_own_contracts on public.subscription_contracts;
create policy read_own_contracts on public.subscription_contracts for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists read_own_periods on public.subscription_periods;
create policy read_own_periods on public.subscription_periods for select to authenticated using (user_id=(select auth.uid()));
grant select on public.subscription_contracts,public.subscription_periods to authenticated;
grant all on public.subscription_contracts,public.subscription_periods to service_role;
revoke insert,update,delete on public.subscription_contracts,public.subscription_periods from anon,authenticated;

-- Keep legacy/free grants, but the new period path grants captured credits explicitly.
create or replace function public.grant_subscription_credit_lot()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_plan subscription_plans%rowtype; v_source text; v_expiry timestamptz;
begin
  if new.status<>'active' or new.subscription_period_id is not null then return new; end if;
  select * into v_plan from subscription_plans where id=new.plan_id;
  if not found or v_plan.monthly_ai_credits<=0 then return new; end if;
  if v_plan.code='free' then
    v_source:='registration:'||new.user_id::text; v_expiry:=null;
  else
    if new.payment_reference is null or new.current_period_start is null or new.current_period_end is null then return new; end if;
    v_source:='subscription:'||new.id::text||':'||new.current_period_start::date::text;
    v_expiry:=new.current_period_end;
  end if;
  insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
    values(new.user_id,case when v_plan.code='free' then 'free' else 'subscription' end,v_plan.monthly_ai_credits,v_plan.monthly_ai_credits,v_expiry,v_source)
    on conflict(user_id,credit_type,source_reference) do nothing;
  return new;
end $$;

create or replace function public.reconcile_user_subscription_periods(p_user_id uuid,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare v_period subscription_periods%rowtype; v_contract subscription_contracts%rowtype;
  v_granted integer:=0; v_balance integer;
begin
  if p_now is null then raise exception 'Missing reconciliation time'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  update subscription_periods set status='completed',completed_at=p_now,updated_at=p_now
    where user_id=p_user_id and status in ('scheduled','active') and ends_at<=p_now;
  update user_subscriptions set status='expired',updated_at=p_now
    where user_id=p_user_id and status='active' and ends_at<=p_now;
  update subscription_contracts set status='completed',updated_at=p_now
    where user_id=p_user_id and status in ('queued','active') and ends_at<=p_now;

  select * into v_period from subscription_periods where user_id=p_user_id and status='scheduled'
    and starts_at<=p_now and ends_at>p_now order by starts_at limit 1 for update;
  if found then
    select * into v_contract from subscription_contracts where id=v_period.contract_id;
    update user_subscriptions set status='inactive',updated_at=p_now
      where user_id=p_user_id and status='active';
    update credit_lots set expires_at=v_period.starts_at
      where user_id=p_user_id and credit_type in ('free','subscription')
        and (expires_at is null or expires_at>v_period.starts_at);
    insert into user_subscriptions(user_id,plan_id,status,started_at,ends_at,current_period_start,current_period_end,payment_reference,subscription_period_id)
      values(p_user_id,v_period.plan_id,'active',v_period.starts_at,v_period.ends_at,v_period.starts_at,v_period.ends_at,v_contract.provider_reference,v_period.id);
    insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
      values(p_user_id,'subscription',v_period.monthly_credits,v_period.monthly_credits,v_period.ends_at,'subscription-period:'||v_period.id)
      on conflict(user_id,credit_type,source_reference) do nothing;
    v_balance:=current_credit_balance(p_user_id);
    insert into credit_transactions(user_id,transaction_type,credits_delta,balance_after,source_type,source_id,idempotency_key)
      values(p_user_id,'subscription_grant',v_period.monthly_credits,v_balance,'subscription_period',v_period.id::text,'subscription-period:'||v_period.id)
      on conflict(idempotency_key) do nothing;
    update subscription_periods set status='active',activated_at=p_now,updated_at=p_now where id=v_period.id;
    update subscription_contracts set status='active',updated_at=p_now where id=v_period.contract_id;
    insert into user_notifications(user_id,type,title,message)
      values(p_user_id,'subscription_grant','Kredit bulanan tersedia',format('%s AI Credits tersedia sampai %s.',v_period.monthly_credits,v_period.ends_at));
    v_granted:=v_period.monthly_credits;
  end if;
  return jsonb_build_object('creditsAdded',v_granted,'balance',current_credit_balance(p_user_id));
end $$;

create or replace function public.reconcile_due_subscription_periods(p_now timestamptz default now(),p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid; v_count integer:=0;
begin
  for v_user in select user_id from subscription_periods
    where (status='scheduled' and starts_at<=p_now) or (status='active' and ends_at<=p_now)
    group by user_id order by min(starts_at) limit least(greatest(p_limit,1),100)
  loop
    perform reconcile_user_subscription_periods(v_user,p_now);
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('processed',v_count);
end $$;

create or replace function public.subscription_month_boundary(p_start timestamptz,p_months integer)
returns timestamptz language sql immutable set timezone='UTC' as $$
  select p_start + make_interval(months=>p_months)
$$;
revoke all on function public.subscription_month_boundary(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.subscription_month_boundary(timestamptz,integer) to service_role;

create or replace function public.settle_pakasir_payment(p_order_id uuid,p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare v_order payment_orders%rowtype; v_credits integer; v_months integer;
  v_start timestamptz:=now(); v_end timestamptz; v_contract uuid;
  v_result jsonb; v_balance integer; v_monthly_price bigint;
begin
  select * into v_order from payment_orders where id=p_order_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  if v_order.provider is distinct from 'pakasir' or v_order.provider_reference is distinct from p_provider_reference or p_provider_reference is null then
    raise exception 'Payment provider reference mismatch';
  end if;
  if v_order.status='paid' then
    return jsonb_build_object('duplicate',true,'creditsAdded',0,'balance',current_credit_balance(v_order.user_id));
  end if;
  if v_order.status<>'pending' then raise exception 'Payment order cannot be settled'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_order.user_id::text,0));
  v_credits:=coalesce(v_order.monthly_credits,v_order.credits,v_order.token_amount::integer);
  if v_credits is null or v_credits<=0 then raise exception 'Invalid credit amount'; end if;

  if v_order.order_type='subscription' then
    if v_order.plan_id is null then raise exception 'Missing subscription plan'; end if;
    v_months:=coalesce(v_order.duration_months,1);
    v_monthly_price:=coalesce(v_order.monthly_price_idr,v_order.amount_idr);
    if v_months not in (1,3,6,12) or v_order.amount_idr<>v_monthly_price*v_months then raise exception 'Invalid subscription snapshot'; end if;
    -- Include legacy paid coverage; free registration never delays activation.
    select greatest(v_start,coalesce(max(ends_at),v_start)) into v_start from (
      select c.ends_at from subscription_contracts c where c.user_id=v_order.user_id and c.status in ('active','queued')
      union all
      select s.ends_at from user_subscriptions s join subscription_plans p on p.id=s.plan_id
        where s.user_id=v_order.user_id and s.status='active' and p.code<>'free'
    ) coverage;
    if exists(select 1 from user_subscriptions s join subscription_plans p on p.id=s.plan_id
      where s.user_id=v_order.user_id and s.status='active' and p.code<>'free' and s.ends_at is null) then
      raise exception 'Existing paid subscription requires a finite end date';
    end if;
    v_end:=subscription_month_boundary(v_start,v_months);
    insert into subscription_contracts(user_id,plan_id,payment_order_id,provider_reference,duration_months,monthly_price_idr,monthly_credits,total_amount_idr,starts_at,ends_at)
      values(v_order.user_id,v_order.plan_id,v_order.id,p_provider_reference,v_months,v_monthly_price,v_credits,v_order.amount_idr,v_start,v_end) returning id into v_contract;
    insert into subscription_periods(contract_id,user_id,plan_id,sequence_number,starts_at,ends_at,monthly_credits)
      select v_contract,v_order.user_id,v_order.plan_id,n,subscription_month_boundary(v_start,n-1),subscription_month_boundary(v_start,n),v_credits
      from generate_series(1,v_months) n;
    v_result:=reconcile_user_subscription_periods(v_order.user_id);
    v_credits:=case when v_start>now() then 0 else coalesce((v_result->>'creditsAdded')::integer,0) end;
  else
    insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
      values(v_order.user_id,'topup',v_credits,v_credits,now()+interval '12 months','payment:'||v_order.id);
    insert into credit_transactions(user_id,transaction_type,credits_delta,balance_after,source_type,source_id,idempotency_key)
      values(v_order.user_id,'topup',v_credits,current_credit_balance(v_order.user_id),'payment_order',v_order.id::text,'pakasir:'||v_order.id);
  end if;
  update payment_orders set status='paid',payment_reference=p_provider_reference,paid_at=now(),updated_at=now() where id=v_order.id;
  v_balance:=current_credit_balance(v_order.user_id);
  insert into user_notifications(user_id,type,title,message)
    values(v_order.user_id,'payment_success','Pembayaran berhasil',case when v_contract is not null and v_start>now()
      then format('Paket terjadwal mulai %s.',v_start) else format('%s AI Credits sudah masuk ke saldo kamu.',v_credits) end);
  return jsonb_build_object('duplicate',false,'creditsAdded',v_credits,'balance',v_balance,'orderType',v_order.order_type,
    'contractId',v_contract,'contractStartsAt',case when v_contract is not null then v_start end,'contractEndsAt',v_end,'queued',v_contract is not null and v_start>now());
end $$;

create or replace function public.mark_expired_pakasir_order_cancelled(p_order_id uuid,p_provider_reference text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order payment_orders%rowtype;
begin
  select * into v_order from payment_orders where id=p_order_id for update;
  if not found or v_order.provider is distinct from 'pakasir' or p_provider_reference is null
    or v_order.provider_reference is distinct from p_provider_reference then raise exception 'Payment provider reference mismatch'; end if;
  if p_reason not in ('provider_expired','provider_cancelled') then raise exception 'Invalid cancellation reason'; end if;
  if v_order.status='pending' then
    update payment_orders set status='cancelled',cancelled_at=now(),cancellation_reason=p_reason,updated_at=now() where id=p_order_id;
    v_order.status:='cancelled';
  end if;
  return jsonb_build_object('status',v_order.status);
end $$;

-- Existing capacity triggers must also honor a paid period after catalog deactivation.
create or replace function public.enforce_alurin_entitlement()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan public.subscription_plans%rowtype; v_count integer; v_limit integer;
  v_threads integer; v_schedule boolean;
begin
  perform public.reconcile_user_subscription_periods(new.user_id);
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||':'||tg_table_name,0));
  select sp.* into v_plan from public.user_subscriptions us join public.subscription_plans sp on sp.id=us.plan_id
    where us.user_id=new.user_id and us.status='active' and (sp.is_active or us.subscription_period_id is not null)
      and us.started_at<=now() and (us.ends_at is null or us.ends_at>now()) order by us.started_at desc limit 1;
  if not found then select * into v_plan from public.subscription_plans where code='free' and is_active limit 1; end if;
  if not found then raise exception 'No subscription entitlement available'; end if;
  v_threads:=coalesce((to_jsonb(v_plan)->>'max_threads_accounts')::integer,case when v_plan.code='free' then 0 else 1 end);
  v_schedule:=coalesce((to_jsonb(v_plan)->>'can_schedule')::boolean,v_plan.code<>'free');
  if tg_table_name='persona_configs' then v_limit:=v_plan.max_personas;
  elsif tg_table_name='content_pillars' then
    v_limit:=coalesce((to_jsonb(v_plan)->>'content_pillars')::integer,(to_jsonb(v_plan)->>'max_content_pillars')::integer,1);
  elsif tg_table_name='social_accounts' then
    if new.platform<>'threads' then return new; end if;
    select count(*) into v_count from public.social_accounts where user_id=new.user_id and platform='threads';
    if v_threads<1 or v_count>=v_threads then raise exception 'Batas akun Threads pada paket kamu sudah tercapai.'; end if;
    return new;
  elsif tg_table_name='scheduled_jobs' then
    if not v_schedule or v_plan.code='free' then raise exception 'Schedule Post tersedia mulai dari paket Starter.'; end if;
    return new;
  else return new; end if;
  execute format('select count(*) from public.%I where user_id=$1',tg_table_name) into v_count using new.user_id;
  if v_count>=v_limit then raise exception 'Batas Persona atau Content Pillar pada paket kamu sudah tercapai.'; end if;
  return new;
end $$;
revoke all on function public.enforce_alurin_entitlement() from public,anon,authenticated;

-- User-facing wrapper uses server time and only reconciles the authenticated owner.
create or replace function public.ensure_subscription_current(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_user_id is null or (auth.uid() is distinct from p_user_id
    and coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role') then
    raise exception 'Unauthorized subscription reconciliation' using errcode='42501';
  end if;
  return reconcile_user_subscription_periods(p_user_id);
end $$;
revoke all on function public.ensure_subscription_current(uuid) from public,anon;
grant execute on function public.ensure_subscription_current(uuid) to authenticated,service_role;
revoke all on function public.grant_subscription_credit_lot() from public,anon,authenticated;
revoke all on function public.settle_pakasir_payment(uuid,text) from public,anon,authenticated;
revoke all on function public.reconcile_user_subscription_periods(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.reconcile_due_subscription_periods(timestamptz,integer) from public,anon,authenticated;
revoke all on function public.mark_expired_pakasir_order_cancelled(uuid,text,text) from public,anon,authenticated;
grant execute on function public.settle_pakasir_payment(uuid,text) to service_role;
grant execute on function public.reconcile_user_subscription_periods(uuid,timestamptz) to service_role;
grant execute on function public.reconcile_due_subscription_periods(timestamptz,integer) to service_role;
grant execute on function public.mark_expired_pakasir_order_cancelled(uuid,text,text) to service_role;
commit;
