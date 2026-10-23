begin;

alter table public.credit_lots drop constraint if exists credit_lots_credit_type_check;
alter table public.credit_lots add constraint credit_lots_credit_type_check
  check (credit_type in ('free','subscription','topup','referral'));

create table if not exists public.referral_program_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  visible boolean not null default true,
  referrer_bonus_credits integer not null default 20 check (referrer_bonus_credits between 0 and 100000),
  referred_bonus_credits integer not null default 10 check (referred_bonus_credits between 0 and 100000),
  attribution_window_days integer not null default 30 check (attribution_window_days between 1 and 365),
  validation_days integer not null default 30 check (validation_days between 1 and 365),
  reward_expiration_days integer not null default 30 check (reward_expiration_days between 1 and 365),
  eligible_plan_codes text[] not null default array['starter','creator','pro']::text[],
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.referral_program_config(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{8,16}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.referral_clicks (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete cascade,
  clicked_at timestamptz not null default now()
);
create index if not exists referral_clicks_code_time_idx on public.referral_clicks(referral_code_id, clicked_at desc);

create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_code_id uuid not null references public.referral_codes(id),
  status text not null default 'registered' check (status in ('registered','awaiting_payment','pending_validation','rewarded','rejected','canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referrer_user_id <> referred_user_id)
);
create index if not exists referral_attributions_referrer_time_idx on public.referral_attributions(referrer_user_id, created_at desc);
create index if not exists referral_attributions_status_time_idx on public.referral_attributions(status, created_at desc);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null unique references public.referral_attributions(id) on delete cascade,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  payment_order_id uuid not null unique references public.payment_orders(id),
  plan_code text not null,
  payment_amount_idr bigint not null check (payment_amount_idr >= 0),
  referrer_bonus_credits integer not null check (referrer_bonus_credits >= 0),
  referred_bonus_credits integer not null check (referred_bonus_credits >= 0),
  reward_expiration_days integer not null check (reward_expiration_days between 1 and 365),
  validation_due_at timestamptz not null,
  status text not null default 'pending_validation' check (status in ('pending_validation','rewarded','rejected','canceled')),
  review_required boolean not null default false,
  review_reason text,
  granted_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists referral_rewards_due_idx on public.referral_rewards(status, validation_due_at) where status='pending_validation';
create index if not exists referral_rewards_created_idx on public.referral_rewards(created_at desc);

create table if not exists public.referral_credit_grants (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.referral_rewards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('referrer','referred')),
  credits integer not null check (credits > 0),
  credit_lot_id uuid not null unique references public.credit_lots(id),
  expires_at timestamptz not null,
  granted_at timestamptz not null default now(),
  unique(reward_id, recipient_role),
  unique(reward_id, user_id)
);

create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid references public.referral_attributions(id) on delete set null,
  reward_id uuid references public.referral_rewards(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists referral_events_attribution_time_idx on public.referral_events(attribution_id, created_at desc);

create or replace function public.initialize_referral_attribution()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into referral_events(attribution_id,actor_user_id,event_type,detail)
    values(new.id,new.referred_user_id,'registered',jsonb_build_object('referrerUserId',new.referrer_user_id));
  update referral_attributions set status='awaiting_payment',updated_at=now() where id=new.id;
  insert into referral_events(attribution_id,actor_user_id,event_type,detail)
    values(new.id,new.referred_user_id,'awaiting_payment',jsonb_build_object());
  insert into user_notifications(user_id,type,title,message)
    values(new.referrer_user_id,'referral_registered','Teman bergabung lewat referral','Temanmu sudah mendaftar lewat link referral. Bonus diberikan setelah pembelian paket pertama lolos validasi.');
  return new;
end;
$$;
drop trigger if exists initialize_referral_attribution_trigger on public.referral_attributions;
create trigger initialize_referral_attribution_trigger after insert on public.referral_attributions
for each row execute function public.initialize_referral_attribution();

alter table public.referral_program_config enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_clicks enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.referral_rewards enable row level security;
alter table public.referral_credit_grants enable row level security;
alter table public.referral_events enable row level security;
revoke all on public.referral_program_config, public.referral_codes, public.referral_clicks,
  public.referral_attributions, public.referral_rewards, public.referral_credit_grants,
  public.referral_events from public, anon, authenticated;
grant all on public.referral_program_config, public.referral_codes, public.referral_clicks,
  public.referral_attributions, public.referral_rewards, public.referral_credit_grants,
  public.referral_events to service_role;

create or replace function public.capture_first_referral_subscription()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_config referral_program_config%rowtype;
  v_plan_code text;
  v_attribution referral_attributions%rowtype;
  v_reward referral_rewards%rowtype;
begin
  if new.provider is distinct from 'pakasir' or new.order_type is distinct from 'subscription'
     or new.plan_id is null or new.status is distinct from 'paid' or old.status='paid' then
    return new;
  end if;

  select * into v_config from referral_program_config where singleton=true;
  if not found or not v_config.enabled then return new; end if;
  select code into v_plan_code from subscription_plans where id=new.plan_id;
  if v_plan_code is null or not (v_plan_code = any(v_config.eligible_plan_codes)) then return new; end if;
  if exists(select 1 from payment_orders p where p.user_id=new.user_id and p.order_type='subscription' and p.status='paid' and p.id<>new.id)
     or exists(select 1 from user_subscriptions s where s.user_id=new.user_id and s.payment_reference is not null and s.payment_reference is distinct from new.provider_reference) then
    return new;
  end if;

  select * into v_attribution from referral_attributions
    where referred_user_id=new.user_id and status in ('registered','awaiting_payment') for update;
  if not found or v_attribution.referrer_user_id=new.user_id then return new; end if;

  insert into referral_rewards(attribution_id,referred_user_id,payment_order_id,plan_code,payment_amount_idr,
    referrer_bonus_credits,referred_bonus_credits,reward_expiration_days,validation_due_at,status)
  values(v_attribution.id,new.user_id,new.id,v_plan_code,new.amount_idr,v_config.referrer_bonus_credits,
    v_config.referred_bonus_credits,v_config.reward_expiration_days,
    coalesce(new.paid_at,now()) + make_interval(days=>v_config.validation_days),'pending_validation')
  on conflict do nothing returning * into v_reward;

  if v_reward.id is not null then
    update referral_attributions set status='pending_validation',updated_at=now() where id=v_attribution.id;
    insert into referral_events(attribution_id,reward_id,event_type,detail)
      values(v_attribution.id,v_reward.id,'eligible_subscription_paid',jsonb_build_object('orderId',new.id,'planCode',v_plan_code));
    insert into user_notifications(user_id,type,title,message) values
      (v_attribution.referrer_user_id,'referral_pending','Referral sedang divalidasi','Temanmu telah membeli paket pertama. Bonus referral sedang melalui masa validasi.'),
      (new.user_id,'referral_pending','Bonus referral sedang divalidasi','Pembelian paket pertamamu memenuhi syarat. Bonus akan tersedia setelah masa validasi selesai.');
  end if;
  return new;
end;
$$;

drop trigger if exists capture_first_referral_subscription_trigger on public.payment_orders;
create trigger capture_first_referral_subscription_trigger
after update of status on public.payment_orders
for each row when (new.status='paid' and old.status is distinct from 'paid')
execute function public.capture_first_referral_subscription();

create or replace function public.handle_referral_payment_reversal()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_reward referral_rewards%rowtype;
begin
  if new.status not in ('refunded','cancelled','canceled','failed','expired') or old.status=new.status then return new; end if;
  select * into v_reward from referral_rewards where payment_order_id=new.id for update;
  if not found then return new; end if;
  if v_reward.status='pending_validation' then
    update referral_rewards set status='canceled',decision_reason='Payment was reversed before reward release',updated_at=now() where id=v_reward.id;
    update referral_attributions set status='canceled',updated_at=now() where id=v_reward.attribution_id;
    insert into referral_events(attribution_id,reward_id,event_type,detail)
      values(v_reward.attribution_id,v_reward.id,'payment_reversed',jsonb_build_object('paymentStatus',new.status));
  elsif v_reward.status='rewarded' then
    update referral_rewards set review_required=true,review_reason='Payment was reversed after reward release',updated_at=now() where id=v_reward.id;
    insert into referral_events(attribution_id,reward_id,event_type,detail)
      values(v_reward.attribution_id,v_reward.id,'refund_after_reward',jsonb_build_object('paymentStatus',new.status));
  end if;
  return new;
end;
$$;
drop trigger if exists handle_referral_payment_reversal_trigger on public.payment_orders;
create trigger handle_referral_payment_reversal_trigger
after update of status on public.payment_orders
for each row when (new.status in ('refunded','cancelled','canceled','failed','expired') and old.status is distinct from new.status)
execute function public.handle_referral_payment_reversal();

create or replace function public.process_due_referral_rewards(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=public as $$
declare v_reward referral_rewards%rowtype; v_attribution referral_attributions%rowtype;
  v_referrer_lot uuid; v_referred_lot uuid; v_expires timestamptz; v_balance integer; v_processed integer:=0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'Invalid referral processing limit'; end if;
  for v_reward in
    select * from referral_rewards where status='pending_validation' and review_required=false
      and validation_due_at<=now() order by validation_due_at for update skip locked limit p_limit
  loop
    perform 1 from payment_orders where id=v_reward.payment_order_id and status='paid' for update;
    if not found then
      update referral_rewards set status='canceled',decision_reason='Payment is no longer paid',updated_at=now() where id=v_reward.id;
      update referral_attributions set status='canceled',updated_at=now() where id=v_reward.attribution_id;
      insert into referral_events(attribution_id,reward_id,event_type,detail) values(v_reward.attribution_id,v_reward.id,'payment_not_paid_at_validation',jsonb_build_object());
      continue;
    end if;
    select * into v_attribution from referral_attributions where id=v_reward.attribution_id for update;
    if not found or v_attribution.referrer_user_id=v_reward.referred_user_id then
      update referral_rewards set status='rejected',decision_reason='Referral attribution is invalid',updated_at=now() where id=v_reward.id;
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_attribution.referrer_user_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended(v_reward.referred_user_id::text,0));
    v_expires:=now()+make_interval(days=>v_reward.reward_expiration_days);
    if v_reward.referrer_bonus_credits>0 then
      insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
      values(v_attribution.referrer_user_id,'referral',v_reward.referrer_bonus_credits,v_reward.referrer_bonus_credits,v_expires,'referral:'||v_reward.id::text||':referrer')
      on conflict(user_id,credit_type,source_reference) do nothing returning id into v_referrer_lot;
      if v_referrer_lot is null then select id into v_referrer_lot from credit_lots where user_id=v_attribution.referrer_user_id and credit_type='referral' and source_reference='referral:'||v_reward.id::text||':referrer'; end if;
      insert into referral_credit_grants(reward_id,user_id,recipient_role,credits,credit_lot_id,expires_at)
        values(v_reward.id,v_attribution.referrer_user_id,'referrer',v_reward.referrer_bonus_credits,v_referrer_lot,v_expires) on conflict do nothing;
      v_balance:=current_credit_balance(v_attribution.referrer_user_id);
      insert into credit_transactions(user_id,transaction_type,credits_delta,balance_after,source_type,source_id,idempotency_key)
        values(v_attribution.referrer_user_id,'referral_reward',v_reward.referrer_bonus_credits,v_balance,'referral_reward',v_reward.id::text,'referral:'||v_reward.id::text||':referrer') on conflict(idempotency_key) do nothing;
    end if;
    if v_reward.referred_bonus_credits>0 then
      insert into credit_lots(user_id,credit_type,original_credits,remaining_credits,expires_at,source_reference)
      values(v_reward.referred_user_id,'referral',v_reward.referred_bonus_credits,v_reward.referred_bonus_credits,v_expires,'referral:'||v_reward.id::text||':referred')
      on conflict(user_id,credit_type,source_reference) do nothing returning id into v_referred_lot;
      if v_referred_lot is null then select id into v_referred_lot from credit_lots where user_id=v_reward.referred_user_id and credit_type='referral' and source_reference='referral:'||v_reward.id::text||':referred'; end if;
      insert into referral_credit_grants(reward_id,user_id,recipient_role,credits,credit_lot_id,expires_at)
        values(v_reward.id,v_reward.referred_user_id,'referred',v_reward.referred_bonus_credits,v_referred_lot,v_expires) on conflict do nothing;
      v_balance:=current_credit_balance(v_reward.referred_user_id);
      insert into credit_transactions(user_id,transaction_type,credits_delta,balance_after,source_type,source_id,idempotency_key)
        values(v_reward.referred_user_id,'referral_reward',v_reward.referred_bonus_credits,v_balance,'referral_reward',v_reward.id::text,'referral:'||v_reward.id::text||':referred') on conflict(idempotency_key) do nothing;
    end if;
    update referral_rewards set status='rewarded',granted_at=now(),updated_at=now() where id=v_reward.id;
    update referral_attributions set status='rewarded',updated_at=now() where id=v_reward.attribution_id;
    insert into referral_events(attribution_id,reward_id,event_type,detail)
      values(v_reward.attribution_id,v_reward.id,'reward_granted',jsonb_build_object('referrerCredits',v_reward.referrer_bonus_credits,'referredCredits',v_reward.referred_bonus_credits));
    insert into user_notifications(user_id,type,title,message) values
      (v_attribution.referrer_user_id,'referral_reward','Bonus referral masuk',format('%s AI Credits bonus referral sudah masuk dan berlaku selama %s hari.',v_reward.referrer_bonus_credits,v_reward.reward_expiration_days)),
      (v_reward.referred_user_id,'referral_reward','Bonus referral masuk',format('%s AI Credits bonus referral sudah masuk dan berlaku selama %s hari.',v_reward.referred_bonus_credits,v_reward.reward_expiration_days));
    v_processed:=v_processed+1;
  end loop;
  return v_processed;
end;
$$;
revoke all on function public.capture_first_referral_subscription() from public,anon,authenticated;
revoke all on function public.handle_referral_payment_reversal() from public,anon,authenticated;
revoke all on function public.initialize_referral_attribution() from public,anon,authenticated;
revoke all on function public.process_due_referral_rewards(integer) from public,anon,authenticated;
grant execute on function public.process_due_referral_rewards(integer) to service_role;

commit;
