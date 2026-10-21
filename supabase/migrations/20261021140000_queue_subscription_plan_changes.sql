begin;

-- Change only policy metadata; keep published prices and draft edits intact.
update public.subscription_pricing_config set
  published=case when published->>'renewalPolicy'='same_plan_only'
    then jsonb_set(published,'{renewalPolicy}','"queue_after_paid_coverage"'::jsonb) else published end,
  draft=case when draft->>'renewalPolicy'='same_plan_only'
    then jsonb_set(draft,'{renewalPolicy}','"queue_after_paid_coverage"'::jsonb) else draft end,
  version=version+case when published->>'renewalPolicy'='same_plan_only' then 1 else 0 end,
  updated_at=now()
where published->>'renewalPolicy'='same_plan_only' or draft->>'renewalPolicy'='same_plan_only';

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
    -- Append every paid purchase after existing paid coverage, even if the plan differs.
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

revoke all on function public.settle_pakasir_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.settle_pakasir_payment(uuid,text) to service_role;

commit;
