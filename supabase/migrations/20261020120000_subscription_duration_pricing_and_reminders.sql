-- Additive multi-duration pricing configuration and expiry reminders.
-- Existing subscription plans, payment orders, credits, and subscriptions are preserved.
begin;

create table if not exists public.subscription_pricing_config (
  singleton boolean primary key default true check (singleton),
  version integer not null default 1 check (version > 0),
  draft jsonb not null,
  published jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  published_at timestamptz not null default now()
);

insert into public.subscription_pricing_config(singleton, version, draft, published)
values (
  true,
  1,
  '{"defaultDurationMonths":3,"enabledDurations":[1,3,12],"expiryReminderDays":[7,3,1],"renewalPolicy":"same_plan_only","plans":{"starter":{"prices":{"1":29000,"3":74000,"12":249000},"monthlyAiCredits":200},"creator":{"prices":{"1":59000,"3":149000,"12":499000},"monthlyAiCredits":600},"pro":{"prices":{"1":99000,"3":249000,"12":839000},"monthlyAiCredits":1200}}}'::jsonb,
  '{"defaultDurationMonths":3,"enabledDurations":[1,3,12],"expiryReminderDays":[7,3,1],"renewalPolicy":"same_plan_only","plans":{"starter":{"prices":{"1":29000,"3":74000,"12":249000},"monthlyAiCredits":200},"creator":{"prices":{"1":59000,"3":149000,"12":499000},"monthlyAiCredits":600},"pro":{"prices":{"1":99000,"3":249000,"12":839000},"monthlyAiCredits":1200}}}'::jsonb
)
on conflict (singleton) do nothing;

alter table public.payment_orders
  add column if not exists pricing_config_version integer,
  add column if not exists payment_verification_source text;

alter table public.subscription_contracts
  add column if not exists pricing_config_version integer;

create index if not exists subscription_contracts_expiry_scan_idx
  on public.subscription_contracts(ends_at) where status in ('active','queued');
create index if not exists subscription_contracts_user_start_idx
  on public.subscription_contracts(user_id,starts_at) where status in ('active','queued');
create index if not exists payment_pending_subscription_user_idx
  on public.payment_orders(user_id) where status='pending' and order_type='subscription';

create table if not exists public.subscription_expiry_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contract_id uuid not null references public.subscription_contracts(id) on delete cascade,
  days_before integer not null check (days_before in (7,3,1)),
  sent_at timestamptz not null default now(),
  unique (contract_id, days_before)
);
create index if not exists subscription_expiry_reminders_user_idx
  on public.subscription_expiry_reminders(user_id, sent_at desc);

alter table public.subscription_pricing_config enable row level security;
alter table public.subscription_expiry_reminders enable row level security;
revoke all on public.subscription_pricing_config, public.subscription_expiry_reminders from anon, authenticated;
grant all on public.subscription_pricing_config, public.subscription_expiry_reminders to service_role;

create or replace function public.publish_subscription_pricing(p_config jsonb, p_admin_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_version integer; v_previous jsonb;
begin
  if current_user <> 'service_role' then raise insufficient_privilege using message='service_role required'; end if;
  if p_admin_user_id is null then raise exception 'Admin user is required'; end if;
  if jsonb_typeof(p_config) <> 'object' or jsonb_typeof(p_config->'plans') <> 'object'
    or (p_config->>'defaultDurationMonths')::integer not in (1,3,12)
    or jsonb_typeof(p_config->'enabledDurations') <> 'array' then
    raise exception 'Invalid subscription pricing configuration';
  end if;
  select published into v_previous from public.subscription_pricing_config where singleton=true for update;
  update public.subscription_pricing_config
    set published=p_config, version=version+1, published_at=now(), updated_at=now()
    where singleton=true returning version into v_version;
  if v_version is null then raise exception 'Subscription pricing configuration is missing'; end if;
  update public.subscription_plans sp set
    price=(p_config->'plans'->sp.code->'prices'->>'1')::integer,
    monthly_ai_credits=(p_config->'plans'->sp.code->>'monthlyAiCredits')::integer
    where sp.code in ('starter','creator','pro');
  insert into public.admin_audit_logs(admin_user_id,action,target_type,target_id,previous_values,new_values,reason)
    values(p_admin_user_id,'subscription.pricing.publish','subscription_pricing_config','default',v_previous,p_config,
      format('Published subscription pricing version %s.',v_version));
  return jsonb_build_object('version',v_version,'publishedAt',now());
end $$;
revoke all on function public.publish_subscription_pricing(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.publish_subscription_pricing(jsonb,uuid) to service_role;

create or replace function public.settle_pakasir_payment(p_order_id uuid, p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare
  v_order payment_orders%rowtype;
  v_credits integer;
  v_months integer;
  v_start timestamptz := now();
  v_end timestamptz;
  v_contract uuid;
  v_result jsonb;
  v_balance integer;
  v_monthly_price bigint;
  v_current_plan text;
  v_new_plan text;
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
    v_monthly_price:=coalesce(v_order.monthly_price_idr,0);
    -- Keep honoring already-created legacy six-month pending orders; new API
    -- orders only allow the 1, 3, and 12 month choices.
    if v_months not in (1,3,6,12) or v_monthly_price<=0 or v_order.amount_idr<=0 then
      raise exception 'Invalid subscription purchase snapshot';
    end if;
    select code into v_new_plan from subscription_plans where id=v_order.plan_id;
    if v_new_plan is null or v_new_plan='free' then raise exception 'Invalid paid subscription plan'; end if;
    select sp.code into v_current_plan
      from user_subscriptions us join subscription_plans sp on sp.id=us.plan_id
      where us.user_id=v_order.user_id and us.status='active' and sp.code<>'free'
        and us.started_at<=now() and (us.ends_at is null or us.ends_at>now())
      order by us.started_at desc limit 1;
    if v_current_plan is not null and v_current_plan<>v_new_plan then
      raise exception 'Plan changes are available after the current paid period ends' using errcode='P0001';
    end if;

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
    insert into subscription_contracts(user_id,plan_id,payment_order_id,provider_reference,duration_months,monthly_price_idr,monthly_credits,total_amount_idr,starts_at,ends_at,pricing_config_version)
      values(v_order.user_id,v_order.plan_id,v_order.id,p_provider_reference,v_months,v_monthly_price,v_credits,v_order.amount_idr,v_start,v_end,v_order.pricing_config_version) returning id into v_contract;
    insert into subscription_periods(contract_id,user_id,plan_id,sequence_number,starts_at,ends_at,monthly_credits)
      select v_contract,v_order.user_id,v_order.plan_id,n,subscription_month_boundary(v_start,n-1),subscription_month_boundary(v_start,n),v_credits
      from generate_series(1,v_months) n;
    v_result:=reconcile_user_subscription_periods(v_order.user_id);
    v_credits:=case when v_start>now() then 0 else coalesce((v_result->>'creditsAdded')::integer,0) end;
  else
    insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
      values(v_order.user_id,'topup',v_credits,v_credits,now()+interval '12 months','payment:'||v_order.id);
    insert into credit_transactions(user_id,transaction_type,credits_delta,balance_after,source_type,source_id,idempotency_key)
      values(v_order.user_id,'topup',v_credits,current_credit_balance(v_order.user_id),'payment_order',v_order.id::text,'pakasir:'||v_order.id)
      on conflict(idempotency_key) do nothing;
  end if;

  update payment_orders set status='paid',payment_reference=p_provider_reference,paid_at=now(),
    payment_verification_source='pakasir_status_api',updated_at=now() where id=v_order.id;
  v_balance:=current_credit_balance(v_order.user_id);
  insert into user_notifications(user_id,type,title,message)
    values(v_order.user_id,'payment_success','Pembayaran berhasil',case when v_contract is not null and v_start>now()
      then format('Paket terjadwal mulai %s.',v_start) else format('%s AI Credits sudah masuk ke saldo kamu.',v_credits) end);
  return jsonb_build_object('duplicate',false,'creditsAdded',v_credits,'balance',v_balance,'orderType',v_order.order_type,
    'contractId',v_contract,'contractStartsAt',case when v_contract is not null then v_start end,'contractEndsAt',v_end,'queued',v_contract is not null and v_start>now());
end $$;

create or replace function public.process_subscription_expiry_reminders(p_now timestamptz default now(), p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_contract record; v_days integer; v_count integer:=0; v_config jsonb;
begin
  select published into v_config from subscription_pricing_config where singleton=true;
  for v_contract in
    select c.id,c.user_id,c.ends_at,p.name plan_name
      from subscription_contracts c join subscription_plans p on p.id=c.plan_id
      where c.status in ('active','queued') and c.ends_at>p_now
        and c.ends_at<=p_now+interval '8 days'
        and not exists (select 1 from subscription_contracts later where later.user_id=c.user_id
          and later.status in ('active','queued') and later.starts_at>=c.ends_at)
      order by c.ends_at limit least(greatest(p_limit,1),1000)
  loop
    for v_days in select jsonb_array_elements_text(coalesce(v_config->'expiryReminderDays','[7,3,1]'::jsonb))::integer loop
      if v_contract.ends_at<=p_now+make_interval(days=>v_days)
        and v_contract.ends_at>p_now+make_interval(days=>v_days-1) then
        insert into subscription_expiry_reminders(user_id,contract_id,days_before)
          values(v_contract.user_id,v_contract.id,v_days) on conflict(contract_id,days_before) do nothing;
        if found then
          insert into user_notifications(user_id,type,title,message)
            values(v_contract.user_id,'subscription_expiry',format('Langganan %s berakhir %s hari lagi',v_contract.plan_name,v_days),
              format('Paket %s akan berakhir pada %s. Perpanjang manual dengan QRIS agar layanan berbayar tetap aktif.',v_contract.plan_name,to_char(v_contract.ends_at,'DD Mon YYYY')));
          v_count:=v_count+1;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('sent',v_count);
end $$;

revoke all on function public.process_subscription_expiry_reminders(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.process_subscription_expiry_reminders(timestamptz,integer) to service_role;
commit;
