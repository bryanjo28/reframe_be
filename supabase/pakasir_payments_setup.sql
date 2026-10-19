-- Run AFTER token_wallet_payments_setup.sql and billing_credits_refactor.sql.
begin;
alter table public.payment_orders alter column package_id drop not null;
alter table public.payment_orders add column if not exists plan_id uuid references public.subscription_plans(id);
alter table public.payment_orders add column if not exists order_type text not null default 'topup'
  check (order_type in ('topup','subscription'));
create unique index if not exists pakasir_transaction_reference_unique
  on public.payment_orders(provider_reference) where provider='pakasir' and provider_reference is not null;

create or replace function public.settle_pakasir_payment(p_order_id uuid,p_provider_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_order payment_orders%rowtype;
  v_credits integer;
  v_balance integer;
  v_subscription_id uuid;
  v_start timestamptz := now();
  v_end timestamptz := now()+interval '1 month';
  v_source text;
begin
  select * into v_order from payment_orders where id=p_order_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  if v_order.provider is distinct from 'pakasir' or v_order.provider_reference is distinct from p_provider_reference or p_provider_reference is null then
    raise exception 'Payment provider reference mismatch';
  end if;
  if v_order.status='paid' then
    return jsonb_build_object('duplicate',true,'balance',current_credit_balance(v_order.user_id));
  end if;
  if v_order.status<>'pending' then raise exception 'Payment order cannot be settled'; end if;
  -- Serialize separate orders for the same user, including concurrent plan purchases.
  -- Share the credit lock used by reserve_ai_credits and settle_ai_credits.
  perform pg_advisory_xact_lock(hashtextextended(v_order.user_id::text,0));
  perform 1 from profiles where id=v_order.user_id for update;
  v_credits:=coalesce(v_order.credits,v_order.token_amount::integer);
  if v_credits<=0 then raise exception 'Invalid credit amount'; end if;

  if v_order.order_type='subscription' then
    if v_order.plan_id is null then raise exception 'Missing subscription plan'; end if;
    -- A paid purchase starts a new monthly period. Previous unused subscription
    -- credits expire; independently purchased topup credits remain available.
    update user_subscriptions set status='inactive',ends_at=v_start,current_period_end=v_start,updated_at=v_start
      where user_id=v_order.user_id and status='active';
    update credit_lots set expires_at=v_start
      where user_id=v_order.user_id and credit_type in ('free','subscription') and (expires_at is null or expires_at>v_start);
    insert into user_subscriptions(user_id,plan_id,status,started_at,ends_at,current_period_start,current_period_end,payment_reference)
      values(v_order.user_id,v_order.plan_id,'active',v_start,v_end,v_start,v_end,p_provider_reference)
      returning id into v_subscription_id;
    -- The existing grant trigger creates this lot. Use the credits captured at
    -- checkout even if the catalog changed while the order was pending.
    v_source:='subscription:'||v_subscription_id::text||':'||v_start::date::text;
    insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
      values(v_order.user_id,'subscription',v_credits,v_credits,v_end,v_source)
      on conflict(user_id,credit_type,source_reference) do update
        set original_credits=excluded.original_credits,remaining_credits=excluded.remaining_credits,expires_at=excluded.expires_at;
  else
    insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
      values(v_order.user_id,'topup',v_credits,v_credits,v_start+interval '12 months','payment:'||v_order.id::text);
  end if;
  update payment_orders set status='paid',payment_reference=p_provider_reference,paid_at=v_start,updated_at=v_start where id=p_order_id;
  v_balance:=current_credit_balance(v_order.user_id);
  insert into credit_transactions(user_id,transaction_type,credits_delta,balance_after,source_type,source_id,idempotency_key)
    values(v_order.user_id,case when v_order.order_type='subscription' then 'subscription_grant' else 'topup' end,
      v_credits,v_balance,'payment_order',v_order.id::text,'pakasir:'||v_order.id::text);
  insert into user_notifications(user_id,type,title,message)
    values(v_order.user_id,'payment_success','Pembayaran berhasil',format('%s AI Credits sudah masuk ke saldo kamu.',v_credits));
  return jsonb_build_object('duplicate',false,'creditsAdded',v_credits,'balance',v_balance,'orderType',v_order.order_type);
end $$;
revoke all on function public.settle_pakasir_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.settle_pakasir_payment(uuid,text) to service_role;
commit;
