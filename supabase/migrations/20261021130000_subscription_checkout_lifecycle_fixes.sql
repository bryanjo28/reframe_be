begin;

-- Preserve historical pending orders; serialize all new pending subscriptions.
create or replace function public.guard_pending_subscription_order()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.order_type is distinct from 'subscription' or new.status is distinct from 'pending' then return new; end if;
  if tg_op='UPDATE' then
    if old.user_id=new.user_id and old.order_type='subscription' and old.status='pending' then return new; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
  if exists(select 1 from payment_orders where user_id=new.user_id
    and order_type='subscription' and status='pending' and id<>new.id) then
    raise exception 'pending_subscription_order_unique' using errcode='23505', constraint='pending_subscription_order_unique';
  end if;
  return new;
end $$;
revoke all on function public.guard_pending_subscription_order() from public,anon,authenticated;
drop trigger if exists guard_pending_subscription_order on public.payment_orders;
create trigger guard_pending_subscription_order before insert or update of user_id,order_type,status
  on public.payment_orders for each row execute function public.guard_pending_subscription_order();

create or replace function public.reconcile_user_subscription_periods(p_user_id uuid,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public set timezone='UTC' as $$
declare v_period subscription_periods%rowtype; v_contract subscription_contracts%rowtype;
  v_granted integer:=0; v_balance integer; v_free_plan uuid;
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

  -- Restore Free only when no paid or free subscription covers the current time.
  -- The existing grant trigger deduplicates signup credits by registration:user_id.
  if not exists(select 1 from user_subscriptions
    where user_id=p_user_id and status='active' and started_at<=p_now
      and (ends_at is null or ends_at>p_now)) then
    select id into v_free_plan from subscription_plans where code='free' and is_active limit 1;
    if v_free_plan is null then raise exception 'Active Free subscription plan not found'; end if;
    insert into user_subscriptions(user_id,plan_id,status,started_at,ends_at)
      values(p_user_id,v_free_plan,'active',p_now,null);
  end if;
  return jsonb_build_object('creditsAdded',v_granted,'balance',current_credit_balance(p_user_id));
end $$;

create or replace function public.reconcile_due_subscription_periods(p_now timestamptz default now(),p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid; v_count integer:=0;
begin
  for v_user in select user_id from (
    select user_id,starts_at as due_at from subscription_periods
      where (status='scheduled' and starts_at<=p_now) or (status='active' and ends_at<=p_now)
    union all
    select user_id,ends_at as due_at from user_subscriptions
      where status='active' and ends_at<=p_now
  ) due group by user_id order by min(due_at) limit least(greatest(p_limit,1),100)
  loop
    perform reconcile_user_subscription_periods(v_user,p_now);
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('processed',v_count);
end $$;

commit;
