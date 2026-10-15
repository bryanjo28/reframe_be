-- Additive, read-only reporting RPC for the existing Alurin billing and AI tables.
-- Apply only after reviewing the paired backend changes. No user or financial data is mutated.
create index if not exists admin_ai_usage_created_user_idx on public.ai_usage_logs (created_at, user_id);
create index if not exists admin_credit_transactions_type_created_user_idx on public.credit_transactions (transaction_type, created_at, user_id);
create index if not exists admin_credit_lots_created_user_idx on public.credit_lots (created_at, user_id);
create index if not exists admin_profiles_created_idx on public.profiles (created_at);
create index if not exists admin_published_posts_created_user_status_idx on public.published_posts (created_at, user_id, publish_status);
create index if not exists admin_payment_orders_paid_created_user_idx on public.payment_orders ((coalesce(paid_at, created_at)), status, user_id);

create or replace function public.admin_user_profitability(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_plan text default null,
  p_sort text default 'highest_revenue',
  p_page integer default 1,
  p_limit integer default 25,
  p_user_id uuid default null,
  p_query text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_total bigint;
  v_rows jsonb;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;

  with
  plans as (
    select distinct on (us.user_id) us.user_id, us.status, us.ends_at, sp.code, sp.name
    from public.user_subscriptions us
    join public.subscription_plans sp on sp.id = us.plan_id
    where us.status = 'active' and (us.ends_at is null or us.ends_at > now())
    order by us.user_id, us.started_at desc
  ),
  payments as (
    select po.user_id,
      coalesce(sum(po.amount_idr) filter (where po.status in ('paid','refunded')), 0)::numeric as paid_idr,
      coalesce(sum(po.amount_idr) filter (where po.status = 'refunded'), 0)::numeric as refunded_idr
    from public.payment_orders po
    where (p_from is null or coalesce(po.paid_at, po.created_at) >= p_from)
      and (p_to is null or coalesce(po.paid_at, po.created_at) < p_to)
    group by po.user_id
  ),
  usage as (
    select l.user_id,
      coalesce(sum(l.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(l.cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(l.output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(l.total_tokens), 0)::bigint as total_tokens,
      coalesce(sum(l.credits_charged), 0)::bigint as log_credits_used,
      coalesce(sum(l.estimated_cost_idr), 0)::numeric as estimated_ai_cost_idr,
      coalesce(sum(l.actual_cost_usd), 0)::numeric as actual_ai_cost_usd,
      count(*)::bigint as request_count,
      max(l.created_at) as last_ai_activity
    from public.ai_usage_logs l
    where (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to)
    group by l.user_id
  ),
  credits as (
    select cl.user_id,
      coalesce(sum(cl.original_credits) filter (where (p_from is null or cl.created_at >= p_from) and (p_to is null or cl.created_at < p_to)), 0)::bigint as credits_granted,
      coalesce(sum(cl.remaining_credits) filter (where cl.expires_at is null or cl.expires_at > now()), 0)::bigint as credits_remaining,
      count(*)::bigint as lot_count
    from public.credit_lots cl
    group by cl.user_id
  ),
  credit_use as (
    select ct.user_id, abs(coalesce(sum(ct.credits_delta), 0))::bigint as credits_used
    from public.credit_transactions ct
    where ct.transaction_type = 'ai_usage'
      and (p_from is null or ct.created_at >= p_from) and (p_to is null or ct.created_at < p_to)
    group by ct.user_id
  ),
  legacy_wallet as (select user_id, balance from public.token_wallets),
  base as (
    select p.id, p.account_name, p.full_name, p.created_at,
      coalesce(pl.code, 'free') as plan_code, coalesce(pl.name, 'Free') as plan_name,
      coalesce(pay.paid_idr, 0) as top_up_paid_idr,
      coalesce(pay.refunded_idr, 0) as refunded_idr,
      coalesce(pay.paid_idr - pay.refunded_idr, 0) as known_net_revenue_idr,
      coalesce(cr.credits_granted, 0) as credits_granted,
      case when coalesce(cr.lot_count,0)>0 then coalesce(cr.credits_remaining,0) else coalesce(w.balance,0) end as credits_remaining,
      coalesce(cu.credits_used, u.log_credits_used, 0) as credits_used,
      coalesce(u.input_tokens, 0) as input_tokens,
      coalesce(u.cached_input_tokens, 0) as cached_input_tokens,
      coalesce(u.output_tokens, 0) as output_tokens,
      coalesce(u.total_tokens, 0) as total_tokens,
      coalesce(u.estimated_ai_cost_idr, 0) as estimated_ai_cost_idr,
      coalesce(u.actual_ai_cost_usd, 0) as actual_ai_cost_usd,
      coalesce(u.request_count, 0) as request_count,
      u.last_ai_activity
    from public.profiles p
    left join plans pl on pl.user_id = p.id
    left join payments pay on pay.user_id = p.id
    left join usage u on u.user_id = p.id
    left join credits cr on cr.user_id = p.id
    left join credit_use cu on cu.user_id = p.id
    left join legacy_wallet w on w.user_id = p.id
    where (p_plan is null or coalesce(pl.code, 'free') = p_plan)
      and (p_user_id is null or p.id = p_user_id)
      and (p_query is null or p.full_name ilike '%' || p_query || '%' or p.account_name ilike '%' || p_query || '%')
  ),
  scored as (
    select *, (known_net_revenue_idr - estimated_ai_cost_idr) as estimated_contribution_before_gateway_fees_idr,
      case when known_net_revenue_idr > 0
        then round((known_net_revenue_idr - estimated_ai_cost_idr) / known_net_revenue_idr * 100, 2)
        else null end as estimated_margin_before_gateway_fees_pct
    from base
  )
  select count(*) into v_total from scored;

  with
  plans as (
    select distinct on (us.user_id) us.user_id, sp.code, sp.name
    from public.user_subscriptions us join public.subscription_plans sp on sp.id = us.plan_id
    where us.status = 'active' and (us.ends_at is null or us.ends_at > now())
    order by us.user_id, us.started_at desc
  ),
  payments as (
    select user_id,
      coalesce(sum(amount_idr) filter (where status in ('paid','refunded')), 0)::numeric as paid_idr,
      coalesce(sum(amount_idr) filter (where status = 'refunded'), 0)::numeric as refunded_idr
    from public.payment_orders
    where (p_from is null or coalesce(paid_at, created_at) >= p_from) and (p_to is null or coalesce(paid_at, created_at) < p_to)
    group by user_id
  ),
  usage as (
    select user_id, coalesce(sum(input_tokens),0)::bigint input_tokens,
      coalesce(sum(cached_input_tokens),0)::bigint cached_input_tokens,
      coalesce(sum(output_tokens),0)::bigint output_tokens,
      coalesce(sum(total_tokens),0)::bigint total_tokens,
      coalesce(sum(credits_charged),0)::bigint log_credits_used,
      coalesce(sum(estimated_cost_idr),0)::numeric estimated_ai_cost_idr,
      coalesce(sum(actual_cost_usd),0)::numeric actual_ai_cost_usd,
      count(*)::bigint request_count, max(created_at) last_ai_activity
    from public.ai_usage_logs
    where (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
    group by user_id
  ),
  credits as (
    select user_id, coalesce(sum(original_credits) filter (where (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)),0)::bigint credits_granted,
      coalesce(sum(remaining_credits) filter (where expires_at is null or expires_at > now()),0)::bigint credits_remaining,
      count(*)::bigint lot_count
    from public.credit_lots group by user_id
  ),
  credit_use as (
    select user_id, abs(coalesce(sum(credits_delta),0))::bigint credits_used
    from public.credit_transactions where transaction_type='ai_usage'
      and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to) group by user_id
  ),
  legacy_wallet as (select user_id, balance from public.token_wallets),
  scored as (
    select p.id, p.account_name, p.full_name, p.created_at, coalesce(pl.code,'free') plan_code, coalesce(pl.name,'Free') plan_name,
      coalesce(pay.paid_idr,0) top_up_paid_idr, coalesce(pay.refunded_idr,0) refunded_idr,
      coalesce(pay.paid_idr-pay.refunded_idr,0) known_net_revenue_idr,
      coalesce(cr.credits_granted,0) credits_granted,
      case when coalesce(cr.lot_count,0)>0 then coalesce(cr.credits_remaining,0) else coalesce(w.balance,0) end credits_remaining,
      coalesce(cu.credits_used,u.log_credits_used,0) credits_used,
      coalesce(u.input_tokens,0) input_tokens, coalesce(u.cached_input_tokens,0) cached_input_tokens,
      coalesce(u.output_tokens,0) output_tokens, coalesce(u.total_tokens,0) total_tokens,
      coalesce(u.estimated_ai_cost_idr,0) estimated_ai_cost_idr, coalesce(u.actual_ai_cost_usd,0) actual_ai_cost_usd,
      coalesce(u.request_count,0) request_count, u.last_ai_activity,
      coalesce(pay.paid_idr-pay.refunded_idr,0)-coalesce(u.estimated_ai_cost_idr,0) estimated_contribution_before_gateway_fees_idr
    from public.profiles p left join plans pl on pl.user_id=p.id left join payments pay on pay.user_id=p.id
      left join usage u on u.user_id=p.id left join credits cr on cr.user_id=p.id left join credit_use cu on cu.user_id=p.id left join legacy_wallet w on w.user_id=p.id
    where (p_plan is null or coalesce(pl.code,'free')=p_plan)
      and (p_user_id is null or p.id=p_user_id)
      and (p_query is null or p.full_name ilike '%' || p_query || '%' or p.account_name ilike '%' || p_query || '%')
  ),
  ordered as (
    select * from scored order by
      case when p_sort in ('highest_revenue','revenue') then known_net_revenue_idr end desc nulls last,
      case when p_sort in ('highest_ai_cost','ai_cost') then estimated_ai_cost_idr end desc nulls last,
      case when p_sort in ('highest_token_usage','tokens') then total_tokens end desc nulls last,
      case when p_sort in ('highest_credit_usage','credits') then credits_used end desc nulls last,
      case when p_sort in ('lowest_profit','negative_profit') then estimated_contribution_before_gateway_fees_idr end asc nulls last,
      case when p_sort='highest_profit' then estimated_contribution_before_gateway_fees_idr end desc nulls last,
      created_at desc
    offset (v_page-1)*v_limit limit v_limit
  )
  select coalesce(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb) into v_rows from ordered;

  return jsonb_build_object('items',v_rows,'total',v_total,'page',v_page,'limit',v_limit,
    'financialCoverage',jsonb_build_object('subscriptionRevenue',false,'gatewayFees',false,'historicalExchangeRates',false,
      'actualAiCostIdr',false,'refundLedgerComplete',false),
    'notes',jsonb_build_array('Recorded revenue includes top-up payment_orders only; no canonical subscription payment ledger exists.',
      'AI cost is the persisted internal estimate in IDR; stored provider cost is reported in USD because historical exchange rates are unavailable.',
      'Contribution is estimated before gateway fees and excludes unrecorded refunds and other variable costs.'));
end;
$$;

revoke all on function public.admin_user_profitability(timestamptz,timestamptz,text,text,integer,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_user_profitability(timestamptz,timestamptz,text,text,integer,integer,uuid,text) to service_role;

create or replace function public.admin_monitoring_overview(
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_start date := coalesce((p_from at time zone 'UTC')::date, (now() at time zone 'UTC')::date - 29);
  v_end date := coalesce(((p_to - interval '1 microsecond') at time zone 'UTC')::date, (now() at time zone 'UTC')::date);
begin
  if current_user <> 'service_role' then raise insufficient_privilege using message = 'service_role required'; end if;
  if p_from is not null and p_to is not null and p_from >= p_to then raise invalid_parameter_value using message = 'Invalid reporting range'; end if;
  if v_end < v_start then raise invalid_parameter_value using message = 'Invalid reporting range'; end if;
  if v_end - v_start > 365 then raise invalid_parameter_value using message = 'Reporting range cannot exceed 366 days'; end if;

  with
  day_list as (
    select d.activity_date::date as activity_date from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') as d(activity_date)
  ),
  revenue_daily as (
    select (coalesce(paid_at,created_at) at time zone 'UTC')::date activity_date, sum(amount_idr)::numeric amount
    from public.payment_orders where status='paid'
      and (p_from is null or coalesce(paid_at,created_at)>=p_from) and (p_to is null or coalesce(paid_at,created_at)<p_to)
    group by 1
  ),
  usage_daily as (
    select (created_at at time zone 'UTC')::date activity_date,
      sum(estimated_cost_idr)::numeric estimated_idr, sum(total_tokens)::bigint tokens,
      sum(input_tokens)::bigint input_tokens, sum(cached_input_tokens)::bigint cached_tokens,
      sum(output_tokens)::bigint output_tokens, sum(credits_charged)::bigint credits,
      sum(actual_cost_usd)::numeric stored_cost_usd,
      count(*)::bigint requests
    from public.ai_usage_logs where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
    group by 1
  ),
  registrations as (
    select (created_at at time zone 'UTC')::date activity_date, count(*)::bigint users
    from public.profiles where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to) group by 1
  ),
  active_users as (
    select user_id from public.ai_usage_logs where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
    union select user_id from public.content_outputs where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
    union select user_id from public.published_posts where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
  ),
  subscription_tiers as (
    select sp.code, sp.name, count(distinct us.user_id)::bigint users
    from public.user_subscriptions us join public.subscription_plans sp on sp.id=us.plan_id
    where us.status='active' and (us.ends_at is null or us.ends_at>now()) group by sp.code,sp.name
  ),
  revenue_products as (
    select tp.code, tp.name, sum(po.amount_idr)::numeric amount
    from public.payment_orders po left join public.token_packages tp on tp.id=po.package_id
    where po.status='paid' and (p_from is null or coalesce(po.paid_at,po.created_at)>=p_from)
      and (p_to is null or coalesce(po.paid_at,po.created_at)<p_to)
    group by tp.code,tp.name
  ),
  feature_usage as (
    select feature, sum(total_tokens)::bigint tokens, sum(estimated_cost_idr)::numeric estimated_cost_idr, count(*)::bigint requests
    from public.ai_usage_logs where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
    group by feature
  ),
  scheduled_metrics as (
    select count(*) filter(where scheduled_at is not null and status in ('draft','approved'))::bigint scheduled_posts
    from public.content_outputs where (p_from is null or coalesce(scheduled_at,created_at)>=p_from) and (p_to is null or coalesce(scheduled_at,created_at)<p_to)
  ),
  posted_metrics as (
    select count(*) filter(where publish_status='success')::bigint published,
      count(*) filter(where publish_status='failed')::bigint failed,
      count(*) filter(where publish_status in ('success','failed'))::bigint completed
    from public.published_posts where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
  )
  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'registeredUsers',(select count(*) from public.profiles),
      'newRegistrations',(select coalesce(sum(users),0) from registrations),
      'activeUsers',(select count(*) from active_users),
      'activeSubscriptions',(select count(distinct user_id) from public.user_subscriptions where status='active' and (ends_at is null or ends_at>now())),
      'freeToPaidConversionRate',case when (select count(*) from public.profiles)>0 then round((select count(distinct user_id)::numeric from public.user_subscriptions where status='active' and (ends_at is null or ends_at>now()))/(select count(*)::numeric from public.profiles)*100,2) else null end,
      'payingUsers',(select count(distinct user_id) from public.payment_orders where status='paid' and (p_from is null or coalesce(paid_at,created_at)>=p_from) and (p_to is null or coalesce(paid_at,created_at)<p_to)),
      'paidTopUpRevenueIdr',(select coalesce(sum(amount_idr),0) from public.payment_orders where status='paid' and (p_from is null or coalesce(paid_at,created_at)>=p_from) and (p_to is null or coalesce(paid_at,created_at)<p_to)),
      'estimatedContributionBeforeGatewayFeesIdr',(select coalesce(sum(amount_idr),0) from public.payment_orders where status='paid' and (p_from is null or coalesce(paid_at,created_at)>=p_from) and (p_to is null or coalesce(paid_at,created_at)<p_to))-(select coalesce(sum(estimated_idr),0) from usage_daily),
      'storedProviderCostUsdRateUnverified',(select coalesce(sum(stored_cost_usd),0) from usage_daily),
      'aiRequests',(select coalesce(sum(requests),0) from usage_daily),
      'totalTokens',(select coalesce(sum(tokens),0) from usage_daily),
      'inputTokens',(select coalesce(sum(input_tokens),0) from usage_daily),
      'cachedInputTokens',(select coalesce(sum(cached_tokens),0) from usage_daily),
      'outputTokens',(select coalesce(sum(output_tokens),0) from usage_daily),
      'creditsConsumed',(select coalesce(sum(credits),0) from usage_daily),
      'estimatedAiCostIdr',(select coalesce(sum(estimated_idr),0) from usage_daily),
      'averageEstimatedCostIdrPerRequest',case when (select coalesce(sum(requests),0) from usage_daily)>0 then (select sum(estimated_idr)/sum(requests) from usage_daily) else null end,
      'scheduledPosts',(select scheduled_posts from scheduled_metrics),
      'publishedPosts',(select published from posted_metrics),
      'failedPosts',(select failed from posted_metrics),
      'publishingSuccessRate',case when (select completed from posted_metrics)>0 then round((select published::numeric/completed*100 from posted_metrics),2) else null end,
      'freeUsers',(select count(*) from public.profiles p where not exists(select 1 from public.user_subscriptions us where us.user_id=p.id and us.status='active' and (us.ends_at is null or us.ends_at>now()))),
      'starterSubscribers',(select users from subscription_tiers where code='starter'),
      'creatorSubscribers',(select users from subscription_tiers where code='creator'),
      'proSubscribers',(select users from subscription_tiers where code='pro')
    ),
    'trends',jsonb_build_object(
      'daily',coalesce((select jsonb_agg(jsonb_build_object('date',d.activity_date,'revenueIdr',coalesce(r.amount,0),'estimatedAiCostIdr',coalesce(u.estimated_idr,0),'tokens',coalesce(u.tokens,0),'newUsers',coalesce(g.users,0)) order by d.activity_date)
        from day_list d left join revenue_daily r using(activity_date) left join usage_daily u using(activity_date) left join registrations g using(activity_date)),'[]'::jsonb),
      'revenueByProduct',coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(name,'Unknown top-up'),'revenueIdr',amount) order by amount desc) from revenue_products),'[]'::jsonb),
      'aiByFeature',coalesce((select jsonb_agg(jsonb_build_object('feature',feature,'tokens',tokens,'estimatedCostIdr',estimated_cost_idr,'requests',requests) order by tokens desc) from feature_usage),'[]'::jsonb),
      'activeSubscribersByPlan',coalesce((select jsonb_agg(jsonb_build_object('plan',name,'users',users) order by users desc) from subscription_tiers),'[]'::jsonb)
    ),
    'coverage',jsonb_build_object('subscriptionRevenue',false,'mrr',false,'gatewayFees',false,'actualAiCostIdr',false,'lastActiveTimestamp',false,'refundLedgerComplete',false),
    'generatedAt',now()
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_monitoring_overview(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.admin_monitoring_overview(timestamptz,timestamptz) to service_role;
