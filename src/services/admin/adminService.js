const { isSupabaseAdminConfigured, supabaseAdmin } = require("../../config/supabase");
const { normalizePagination } = require("../../utils/pagination");

function createHttpError(message, status = 500, code = "ADMIN_SERVICE_ERROR") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function getAdminDb() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    throw createHttpError("Admin data access is not configured", 503, "ADMIN_DATA_UNAVAILABLE");
  }
  return supabaseAdmin;
}

function throwDataError(error) {
  if (error) throw createHttpError("Admin data could not be loaded", 503, "ADMIN_DATA_UNAVAILABLE");
}

function dateFilter(query, from, to, column = "created_at") {
  if (from) query = query.gte(column, from);
  if (to) query = query.lt(column, to);
  return query;
}

function pageArgs(query = {}) {
  const requestedPage = query.page === undefined ? 1 : Number(query.page);
  const requestedLimit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 1_000_000) {
    throw createHttpError("Invalid page number", 400, "ADMIN_INVALID_PAGINATION");
  }
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw createHttpError("Invalid page size", 400, "ADMIN_INVALID_PAGINATION");
  }
  const pagination = normalizePagination(query);
  return { from: pagination.from, to: pagination.to, limit: pagination.limit, page: pagination.page };
}

async function getOverview(query = {}) {
  const db = getAdminDb();
  const range = normalizeReportRange(query);
  if (!range.from && range.to) range.from = new Date(new Date(range.to).getTime() - 29 * 86400000).toISOString();
  if (range.from && !range.to) range.to = new Date(new Date(range.from).getTime() + 30 * 86400000).toISOString();
  const { data: report, error: reportError } = await db.rpc("admin_monitoring_overview", {
    p_from: range.from,
    p_to: range.to,
  });
  if (!reportError) {
    const financials = await getSubscriptionFinancialsForOverview({ db, from: range.from, to: range.to });
    return { ...report, metrics: { ...(report?.metrics || {}), ...financials.metrics }, subscriptionFinancials: financials };
  }
  if (reportError.code !== "42883" && !/admin_monitoring_overview.*not found/i.test(reportError.message || "")) throwDataError(reportError);
  const [registeredUsers, activeSubscriptions, paidOrders, aiRequests, scheduledJobs, publishedPosts, failedPosts] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("user_subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("payment_orders").select("id", { count: "exact", head: true }).eq("status", "paid"),
    db.from("ai_usage_logs").select("id", { count: "exact", head: true }),
    db.from("scheduled_jobs").select("id", { count: "exact", head: true }),
    db.from("published_posts").select("id", { count: "exact", head: true }).eq("publish_status", "success"),
    db.from("published_posts").select("id", { count: "exact", head: true }).eq("publish_status", "failed"),
  ]);
  for (const result of [registeredUsers, activeSubscriptions, paidOrders, aiRequests, scheduledJobs, publishedPosts, failedPosts]) throwDataError(result.error);
  const financials = await getSubscriptionFinancialsForOverview({ db, from: range.from, to: range.to });
  return {
    metrics: {
      registeredUsers: registeredUsers.count ?? 0,
      activeSubscriptions: activeSubscriptions.count ?? 0,
      paidOrders: paidOrders.count ?? 0,
      aiRequests: aiRequests.count ?? 0,
      scheduledJobs: scheduledJobs.count ?? 0,
      publishedPosts: publishedPosts.count ?? 0,
      failedPosts: failedPosts.count ?? 0,
      ...financials.metrics,
    },
    subscriptionFinancials: financials,
    generatedAt: new Date().toISOString(),
    coverage: { subscriptionRevenue: false, mrr: false, gatewayFees: false, actualAiCostIdr: false, lastActiveTimestamp: false, refundLedgerComplete: false },
    reportingSetupRequired: true,
  };
}

function accruedRevenue(amount, startsAt, endsAt, from, to) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const rangeStart = Math.max(start, from ? Date.parse(from) : start);
  const rangeEnd = Math.min(end, to ? Date.parse(to) : Date.now(), Date.now());
  if (rangeEnd <= rangeStart) return 0;
  return Number(amount || 0) * ((rangeEnd - rangeStart) / (end - start));
}

function emptySubscriptionFinancials(setupRequired = false) {
  return { asOf: new Date().toISOString(), setupRequired,
    metrics: { subscriptionCashCollectedIdr: 0, recognizedSubscriptionRevenueIdr: 0,
      remainingServiceObligationIdr: 0, monthlySubscriptionCreditsGranted: 0, subscriptionActualAiCostUsd: 0,
      subscriptionEstimatedAiCostIdr: 0, estimatedSubscriptionContributionIdr: 0 }, contracts: [], users: new Map() };
}

function isSubscriptionFinancialsSetupError(error) {
  return error?.code === 'SUBSCRIPTION_FINANCIALS_SETUP_REQUIRED' || /subscription_contracts.*(not found|does not exist|schema cache)/i.test(error?.message || '');
}

async function getSubscriptionFinancialsForOverview(options) {
  try { return await getSubscriptionFinancials(options); }
  catch (error) {
    if (isSubscriptionFinancialsSetupError(error)) return emptySubscriptionFinancials(true);
    throw error;
  }
}

async function getSubscriptionFinancials({ db = getAdminDb(), from = null, to = null, userIds = null } = {}) {
  let contractsQuery = db.from('subscription_contracts')
    .select('id,user_id,plan_id,payment_order_id,duration_months,monthly_credits,total_amount_idr,starts_at,ends_at,status,pricing_config_version')
    .order('starts_at', { ascending: false }).limit(10000);
  if (Array.isArray(userIds)) contractsQuery = userIds.length ? contractsQuery.in('user_id', userIds) : contractsQuery.in('user_id', ['00000000-0000-0000-0000-000000000000']);
  if (to) contractsQuery = contractsQuery.lt('starts_at', to);
  if (from) contractsQuery = contractsQuery.gt('ends_at', from);
  const { data: contracts, error } = await contractsQuery;
  if (error && (error.code === '42P01' || error.code === 'PGRST205' || /subscription_contracts.*(not found|does not exist|schema cache)/i.test(error.message || ''))) {
    throw createHttpError('Subscription finance migration is required', 503, 'SUBSCRIPTION_FINANCIALS_SETUP_REQUIRED');
  }
  throwDataError(error);
  const orderIds = [...new Set((contracts || []).map(row => row.payment_order_id).filter(Boolean))];
  const { data: orders, error: orderError } = orderIds.length
    ? await db.from('payment_orders').select('id,user_id,amount_idr,status,paid_at,payment_verification_source').in('id', orderIds)
    : { data: [], error: null };
  throwDataError(orderError);
  const paidOrders = new Map((orders || []).filter(order => order.status === 'paid').map(order => [order.id, order]));
  const contractIds = (contracts || []).map(row => row.id);
  const userIdList = [...new Set((contracts || []).map(row => row.user_id).filter(Boolean))];
  const planIdList = [...new Set((contracts || []).map(row => row.plan_id).filter(Boolean))];
  const { data: periods, error: periodError } = contractIds.length
    ? await db.from('subscription_periods').select('id,contract_id,monthly_credits,status').in('contract_id', contractIds)
    : { data: [], error: null };
  throwDataError(periodError);
  const periodIds = (periods || []).map(row => row.id);
  const { data: grants, error: grantsError } = periodIds.length
    ? await db.from('credit_transactions').select('source_id,credits_delta').eq('transaction_type', 'subscription_grant').in('source_id', periodIds.map(String))
    : { data: [], error: null };
  throwDataError(grantsError);
  const grantedByPeriod = new Map((grants || []).map(row => [String(row.source_id), Number(row.credits_delta || 0)]));
  const grantByContract = new Map();
  for (const period of periods || []) grantByContract.set(period.contract_id, (grantByContract.get(period.contract_id) || 0) + (grantedByPeriod.get(String(period.id)) || 0));
  const [{ data: profiles, error: profilesError }, { data: planRows, error: plansError }] = await Promise.all([
    userIdList.length ? db.from('profiles').select('id,full_name,account_name').in('id', userIdList) : { data: [], error: null },
    planIdList.length ? db.from('subscription_plans').select('id,code,name').in('id', planIdList) : { data: [], error: null },
  ]);
  throwDataError(profilesError || plansError);
  const profileById = new Map((profiles || []).map(row => [row.id, row]));
  const planById = new Map((planRows || []).map(row => [row.id, row]));
  const startBounds = (contracts || []).map(row => Date.parse(row.starts_at)).filter(Number.isFinite);
  const endBounds = (contracts || []).map(row => Date.parse(row.ends_at)).filter(Number.isFinite);
  let usageQuery = userIdList.length && startBounds.length && endBounds.length
    ? db.from('ai_usage_logs').select('user_id,created_at,actual_cost_usd,estimated_cost_idr,total_tokens,credits_charged')
      .in('user_id', userIdList).gte('created_at', new Date(Math.min(...startBounds)).toISOString())
      .lt('created_at', new Date(Math.max(...endBounds)).toISOString())
    : null;
  if (usageQuery && from) usageQuery = usageQuery.gte('created_at', from);
  if (usageQuery && to) usageQuery = usageQuery.lt('created_at', to);
  const { data: usageRows, error: usageError } = usageQuery ? await usageQuery.limit(10000) : { data: [], error: null };
  throwDataError(usageError);
  const usageByUser = new Map();
  for (const item of usageRows || []) {
    const rows = usageByUser.get(item.user_id) || [];
    rows.push({ ...item, _createdAtMs: Date.parse(item.created_at) });
    usageByUser.set(item.user_id, rows);
  }
  for (const rows of usageByUser.values()) rows.sort((left, right) => left._createdAtMs - right._createdAtMs);
  const usageForContract = (userId, startMs, endMs) => {
    const rows = usageByUser.get(userId) || [];
    let low = 0; let high = rows.length;
    while (low < high) { const mid = (low + high) >>> 1; if (rows[mid]._createdAtMs < startMs) low = mid + 1; else high = mid; }
    const found = [];
    for (let index = low; index < rows.length && rows[index]._createdAtMs < endMs; index += 1) found.push(rows[index]);
    return found;
  };
  const users = new Map();
  const rows = (contracts || []).map(contract => {
    const order = paidOrders.get(contract.payment_order_id);
    const amount = Number(order?.amount_idr ?? contract.total_amount_idr ?? 0);
    const recognized = order ? accruedRevenue(amount, contract.starts_at, contract.ends_at, from, to) : 0;
    const remaining = order ? Math.max(0, amount - accruedRevenue(amount, contract.starts_at, contract.ends_at, null, null)) : 0;
    const contractStart = Date.parse(contract.starts_at);
    const contractEnd = Date.parse(contract.ends_at);
    const usage = usageForContract(contract.user_id, contractStart, contractEnd);
    const actualAiCostUsd = usage.reduce((sum, item) => sum + Number(item.actual_cost_usd || 0), 0);
    const estimatedAiCostIdr = usage.reduce((sum, item) => sum + Number(item.estimated_cost_idr || 0), 0);
    const row = { ...contract, plan_code: planById.get(contract.plan_id)?.code || null, plan_name: planById.get(contract.plan_id)?.name || null,
      user_name: profileById.get(contract.user_id)?.full_name || profileById.get(contract.user_id)?.account_name || null,
      payment_status: order?.status || 'unpaid', payment_amount_idr: order ? amount : null,
      paid_at: order?.paid_at || null, payment_verification_source: order?.payment_verification_source || null,
      cash_collected_idr: order ? amount : 0, recognized_revenue_idr: recognized,
      remaining_service_obligation_idr: remaining, monthly_credits_granted: grantByContract.get(contract.id) || 0,
      credits_used: usage.reduce((sum, item) => sum + Number(item.credits_charged || 0), 0),
      total_tokens: usage.reduce((sum, item) => sum + Number(item.total_tokens || 0), 0),
      actual_ai_cost_usd: actualAiCostUsd, estimated_ai_cost_idr: estimatedAiCostIdr,
      estimated_contribution_profit_idr: recognized - estimatedAiCostIdr };
    const aggregate = users.get(contract.user_id) || { subscriptionCashCollectedIdr: 0, subscriptionRecognizedRevenueIdr: 0, remainingServiceObligationIdr: 0, monthlyCreditsGranted: 0, subscriptionDurationMonths: 0 };
    aggregate.subscriptionCashCollectedIdr += row.cash_collected_idr;
    aggregate.subscriptionRecognizedRevenueIdr += recognized;
    aggregate.remainingServiceObligationIdr += remaining;
    aggregate.monthlyCreditsGranted += row.monthly_credits_granted;
    aggregate.subscriptionDurationMonths = Math.max(aggregate.subscriptionDurationMonths, Number(contract.duration_months || 0));
    users.set(contract.user_id, aggregate);
    return row;
  });
  const cashCollected = rows.reduce((sum, row) => sum + (row.paid_at && (!from || row.paid_at >= from) && (!to || row.paid_at < to) ? row.cash_collected_idr : 0), 0);
  const recognizedRevenue = rows.reduce((sum, row) => sum + row.recognized_revenue_idr, 0);
  const remainingObligation = rows.reduce((sum, row) => sum + row.remaining_service_obligation_idr, 0);
  const monthlyCreditsGranted = rows.reduce((sum, row) => sum + row.monthly_credits_granted, 0);
  const actualAiCostUsd = rows.reduce((sum, row) => sum + row.actual_ai_cost_usd, 0);
  const estimatedAiCostIdr = rows.reduce((sum, row) => sum + row.estimated_ai_cost_idr, 0);
  return {
    asOf: new Date().toISOString(),
    metrics: { subscriptionCashCollectedIdr: cashCollected, recognizedSubscriptionRevenueIdr: recognizedRevenue,
      remainingServiceObligationIdr: remainingObligation, monthlySubscriptionCreditsGranted: monthlyCreditsGranted,
      subscriptionActualAiCostUsd: actualAiCostUsd, subscriptionEstimatedAiCostIdr: estimatedAiCostIdr,
      estimatedSubscriptionContributionIdr: recognizedRevenue - estimatedAiCostIdr },
    contracts: rows,
    users,
  };
}

function normalizeReportRange({ from, to } = {}) {
  const parse = (value, name) => {
    if (value === undefined || value === null || value === "") return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw createHttpError(`Invalid ${name} date`, 400, "ADMIN_INVALID_FILTER");
    return date.toISOString();
  };
  const start = parse(from, "from");
  const end = parse(to, "to");
  if (start && end && start >= end) throw createHttpError("The from date must be before the to date", 400, "ADMIN_INVALID_FILTER");
  if (start && end && new Date(end).getTime() - new Date(start).getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw createHttpError("Reporting date range cannot exceed 366 days", 400, "ADMIN_INVALID_FILTER");
  }
  return { from: start, to: end };
}

const PROFITABILITY_SORTS = new Set(["highest_revenue", "highest_ai_cost", "highest_token_usage", "highest_credit_usage", "lowest_profit", "highest_profit", "negative_profit"]);

async function getProfitability({ from, to, plan = "", sort = "highest_revenue", page = 1, limit = 25, userId = null, query = "" } = {}) {
  const db = getAdminDb();
  const range = normalizeReportRange({ from, to });
  const paging = pageArgs({ page, limit });
  const safeSort = PROFITABILITY_SORTS.has(sort) ? sort : "highest_revenue";
  const safePlan = ["free", "starter", "creator", "pro"].includes(plan) ? plan : null;
  const { data, error } = await db.rpc("admin_user_profitability", {
    p_from: range.from,
    p_to: range.to,
    p_plan: safePlan,
    p_sort: safeSort,
    p_page: paging.page,
    p_limit: paging.limit,
    p_user_id: userId,
    p_query: String(query).trim().slice(0, 100).replace(/[%_]/g, " ") || null,
  });
  if (error) {
    if (error.code === "42883" || /admin_user_profitability.*not found/i.test(error.message || "")) {
      throw createHttpError("Admin reporting database setup is required", 503, "ADMIN_REPORTING_NOT_READY");
    }
    throwDataError(error);
  }
  if (!data || !Array.isArray(data.items) || !data.items.length) return data;
  const userIds = data.items.map((row) => row.id).filter(Boolean);
  if (!userIds.length) return data;
  let subscriptionFinance = emptySubscriptionFinancials();
  try { subscriptionFinance = await getSubscriptionFinancials({ db, from: range.from, to: range.to, userIds }); }
  catch (error) { if (!isSubscriptionFinancialsSetupError(error)) throw error; }
  const [attributions, grants, referralLots] = await Promise.all([
    db.from('referral_attributions').select('referred_user_id,referrer_user_id,status').in('referred_user_id', userIds),
    db.from('referral_credit_grants').select('user_id,credits').in('user_id', userIds),
    db.from('credit_lots').select('user_id,remaining_credits,expires_at').eq('credit_type', 'referral').in('user_id', userIds),
  ]);
  if (attributions.error || grants.error || referralLots.error) throwDataError(attributions.error || grants.error || referralLots.error);
  const referredBy = new Map((attributions.data || []).map((row) => [row.referred_user_id, row]));
  const grantedByUser = new Map();
  for (const grant of grants.data || []) grantedByUser.set(grant.user_id, (grantedByUser.get(grant.user_id) || 0) + Number(grant.credits || 0));
  const availableByUser = new Map();
  for (const lot of referralLots.data || []) {
    if (lot.expires_at && new Date(lot.expires_at).getTime() <= Date.now()) continue;
    availableByUser.set(lot.user_id, (availableByUser.get(lot.user_id) || 0) + Number(lot.remaining_credits || 0));
  }
  return { ...data, items: data.items.map((row) => {
    const attribution = referredBy.get(row.id);
    const issued = grantedByUser.get(row.id) || 0;
    return { ...row, acquisition_source: attribution ? 'referral' : 'organic',
      referrer_user_id: attribution?.referrer_user_id || null,
      referral_status: attribution?.status || null,
      referral_credits_issued: issued,
      referral_credits_available: availableByUser.get(row.id) || 0,
      referral_reward_cost_idr_estimate: issued * 50,
      subscription_cash_collected_idr: subscriptionFinance.users.get(row.id)?.subscriptionCashCollectedIdr || 0,
      subscription_recognized_revenue_idr: subscriptionFinance.users.get(row.id)?.subscriptionRecognizedRevenueIdr || 0,
      remaining_service_obligation_idr: subscriptionFinance.users.get(row.id)?.remainingServiceObligationIdr || 0,
      monthly_credits_granted: subscriptionFinance.users.get(row.id)?.monthlyCreditsGranted || 0,
      subscription_duration_months: subscriptionFinance.users.get(row.id)?.subscriptionDurationMonths || 0 };
  }) };
}

async function getUsers({ query = "", plan = "", status = "", from, to, page = 1, limit = 25 } = {}) {
  const db = getAdminDb();
  const paging = pageArgs({ page, limit });
  const range = normalizeReportRange({ from, to });
  const report = await getProfitability({ ...range, plan, sort: "highest_revenue", page: paging.page, limit: paging.limit, query });
  let items = report?.items || [];
  if (status) items = items.filter((item) => (status === "active" ? item.plan_code !== "free" : item.plan_code === "free"));
  const ids = items.map((item) => item.id);
  const [accountsResult, loginsResult] = await Promise.all([
    ids.length
    ? db.from("social_accounts").select("user_id,expires_at").in("user_id", ids).eq("platform", "threads")
    : { data: [], error: null },
    ids.length ? db.rpc("admin_user_last_logins", { p_user_ids: ids }) : { data: [], error: null },
  ]);
  throwDataError(accountsResult.error);
  throwDataError(loginsResult.error);
  const accounts = accountsResult.data;
  const lastLogins = new Map((loginsResult.data || []).map((row) => [row.user_id, row.last_login_at]));
  const connected = new Set((accounts || []).filter((row) => !row.expires_at || new Date(row.expires_at) > new Date()).map((row) => row.user_id));
  return {
    ...report,
    items: items.map((row) => ({
      ...row,
      name: row.full_name || row.account_name,
      accountName: row.account_name,
      lastLoginAt: lastLogins.get(row.id) || null,
      plan: row.plan_name,
      planCode: row.plan_code,
      subscriptionStatus: row.plan_code === "free" ? "free" : "active",
      creditsAvailable: row.credits_remaining,
      creditsConsumed: row.credits_used,
      totalTokens: row.total_tokens,
      totalPaidIdr: Number(row.known_net_revenue_idr || 0) + Number(row.subscription_cash_collected_idr || 0),
      threadsConnected: connected.has(row.id),
    })),
    total: status ? items.length : report.total,
    page: paging.page,
    limit: paging.limit,
  };
}

async function getUserDetails({ userId, from, to } = {}) {
  const db = getAdminDb();
  const profileId = String(userId || "");
  const range = normalizeReportRange({ from, to });
  const profileRequest = db.from("profiles").select("id,account_name,full_name,created_at,role").eq("id", profileId).maybeSingle();
  const countRequest = (table, column = "created_at", applyRange = true) => {
    let request = db.from(table).select("id", { count: "exact", head: true }).eq("user_id", profileId);
    if (applyRange) request = dateFilter(request, range.from, range.to, column);
    return request;
  };
  const [profileResult, report, emailResult, personaCount, pillarCount, topicCount, outputCount, scheduledCount, aiHistory, creditHistory, payments, scheduledHistory, lots, legacyWallet] = await Promise.all([
    profileRequest,
    getProfitability({ ...range, userId: profileId, page: 1, limit: 1 }),
    db.auth.admin.getUserById(profileId),
    countRequest("persona_configs"), countRequest("content_pillars"), countRequest("content_topics"), countRequest("content_outputs"),
    countRequest("content_outputs", "created_at", false).not("scheduled_at", "is", null),
    (() => { let q = db.from("ai_usage_logs").select("id,request_id,feature,model,input_tokens,cached_input_tokens,output_tokens,total_tokens,credits_charged,estimated_cost_idr,actual_cost_usd,status,created_at").eq("user_id", profileId).order("created_at", { ascending: false }).limit(10); return dateFilter(q, range.from, range.to); })(),
    (() => { let q = db.from("credit_transactions").select("id,transaction_type,credits_delta,balance_after,source_type,created_at").eq("user_id", profileId).order("created_at", { ascending: false }).limit(10); return dateFilter(q, range.from, range.to); })(),
    (() => { let q = db.from("payment_orders").select("id,amount_idr,credits,status,provider,paid_at,created_at").eq("user_id", profileId).order("created_at", { ascending: false }).limit(10); return dateFilter(q, range.from, range.to, "paid_at"); })(),
    (() => { let q = db.from("content_outputs").select("id,status,scheduled_at,retry_count,created_at").eq("user_id", profileId).not("scheduled_at", "is", null).order("scheduled_at", { ascending: false }).limit(10); return dateFilter(q, range.from, range.to); })(),
    db.from("credit_lots").select("credit_type,original_credits,remaining_credits,reserved_credits,expires_at").eq("user_id", profileId),
    db.from("token_wallets").select("balance,updated_at").eq("user_id", profileId).maybeSingle(),
  ]);
  throwDataError(profileResult.error);
  if (!profileResult.data) return null;
  for (const result of [personaCount, pillarCount, topicCount, outputCount, scheduledCount, aiHistory, creditHistory, payments, scheduledHistory, lots, legacyWallet]) throwDataError(result.error);
  const creditTotals = { free: 0, subscription: 0, topup: 0, totalAvailable: 0 };
  for (const lot of (lots.data || [])) {
    if (lot.expires_at && new Date(lot.expires_at) <= new Date()) continue;
    const type = ["free", "subscription", "topup"].includes(lot.credit_type) ? lot.credit_type : "subscription";
    creditTotals[type] += Number(lot.remaining_credits || 0);
    creditTotals.totalAvailable += Number(lot.remaining_credits || 0);
  }
  if (!(lots.data || []).length) creditTotals.totalAvailable = Number(legacyWallet.data?.balance || 0);
  const user = emailResult?.data?.user;
  return {
    profile: { ...profileResult.data, email: user?.email || null, lastLoginAt: user?.last_sign_in_at || null },
    profitability: report?.items?.[0] || null,
    credits: creditTotals,
    activity: {
      personaCount: personaCount.count ?? 0, pillarCount: pillarCount.count ?? 0,
      topicCount: topicCount.count ?? 0, generatedContentCount: outputCount.count ?? 0,
      scheduledPostCount: scheduledCount.count ?? 0,
      aiRequests: aiHistory.data || [], creditTransactions: creditHistory.data || [],
      paymentTransactions: payments.data || [], scheduledPosts: scheduledHistory.data || [],
    },
    limitations: ["User email is supplied by Supabase Auth.", "Subscription payment ledger, historical credit grants by category, refunds, and payment gateway fees are not complete in the current schema.", "AI cost in IDR is an internal estimate; historical exchange rates are unavailable."],
  };
}

async function getTransactions({ query = "", status = "", from, to, page = 1, limit = 25 } = {}) {
  const db = getAdminDb();
  const paging = pageArgs({ page, limit });
  let request = db.from("payment_orders")
    .select("id,user_id,package_id,amount_idr,token_amount,credits,status,provider,provider_reference,payment_reference,paid_at,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(paging.from, paging.to);
  if (status) request = request.eq("status", status);
  request = dateFilter(request, from, to);
  const search = String(query).trim().slice(0, 100);
  if (search) request = request.or(`id.eq.${search},provider_reference.ilike.%${search}%`);
  const { data, count, error } = await request;
  throwDataError(error);
  const userIds = [...new Set((data || []).map((row) => row.user_id))];
  const packageIds = [...new Set((data || []).map((row) => row.package_id))];
  const [{ data: profiles, error: profileError }, { data: packages, error: packageError }] = await Promise.all([
    userIds.length ? db.from("profiles").select("id,account_name,full_name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    packageIds.length ? db.from("token_packages").select("id,name,code").in("id", packageIds) : Promise.resolve({ data: [], error: null }),
  ]);
  throwDataError(profileError); throwDataError(packageError);
  const profileMap = new Map((profiles || []).map((row) => [row.id, row]));
  const packageMap = new Map((packages || []).map((row) => [row.id, row]));
  return {
    items: (data || []).map((row) => ({
      id: row.id, userId: row.user_id,
      user: profileMap.get(row.user_id)?.full_name || profileMap.get(row.user_id)?.account_name || row.user_id,
      accountName: profileMap.get(row.user_id)?.account_name || "",
      product: packageMap.get(row.package_id)?.name || "Unknown product",
      type: "top_up", amountIdr: Number(row.amount_idr || 0), credits: Number(row.credits ?? row.token_amount ?? 0),
      status: row.status, provider: row.provider, providerReference: row.provider_reference || row.payment_reference || null,
      paidAt: row.paid_at, createdAt: row.created_at,
    })),
    total: count ?? 0, page: paging.page, limit: paging.limit,
  };
}

async function getAiUsage({ query = "", feature = "", status = "", from, to, page = 1, limit = 25 } = {}) {
  const db = getAdminDb();
  const paging = pageArgs({ page, limit });
  let request = db.from("ai_usage_logs")
    .select("id,user_id,request_id,feature,model,input_tokens,cached_input_tokens,output_tokens,total_tokens,estimated_cost_idr,actual_cost_usd,credits_charged,status,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(paging.from, paging.to);
  if (feature) request = request.eq("feature", feature);
  if (status) request = request.eq("status", status);
  request = dateFilter(request, from, to);
  const search = String(query).trim().slice(0, 100);
  if (search) request = request.or(`user_id.eq.${search},request_id.ilike.%${search}%`);
  const { data, count, error } = await request;
  throwDataError(error);
  const ids = [...new Set((data || []).map((row) => row.user_id))];
  const { data: profiles, error: profileError } = ids.length ? await db.from("profiles").select("id,account_name,full_name").in("id", ids) : { data: [], error: null };
  throwDataError(profileError);
  const profileMap = new Map((profiles || []).map((row) => [row.id, row]));
  return {
    items: (data || []).map((row) => ({
      id: row.id, requestId: row.request_id, userId: row.user_id,
      user: profileMap.get(row.user_id)?.full_name || profileMap.get(row.user_id)?.account_name || row.user_id,
      accountName: profileMap.get(row.user_id)?.account_name || "", feature: row.feature, model: row.model,
      inputTokens: Number(row.input_tokens || 0), cachedInputTokens: Number(row.cached_input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0), totalTokens: Number(row.total_tokens || 0),
      estimatedCostIdr: Number(row.estimated_cost_idr || 0), actualCostUsd: Number(row.actual_cost_usd || 0),
      creditsCharged: Number(row.credits_charged || 0), status: row.status, createdAt: row.created_at,
    })),
    total: count ?? 0, page: paging.page, limit: paging.limit,
  };
}

async function getScheduledPosts({ query = "", status = "", from, to, page = 1, limit = 25 } = {}) {
  const db = getAdminDb();
  const paging = pageArgs({ page, limit });
  const outcomes = new Set(["success", "failed", "processing", "uncertain"]);
  let request = outcomes.has(status)
    ? db.from("published_posts").select("id,user_id,social_account_id,content_output_id,publish_status,posted_at,publish_error_message,created_at", { count: "exact" }).eq("publish_status", status)
    : db.from("content_outputs").select("id,user_id,content,scheduled_at,status,retry_count,created_at", { count: "exact" }).not("scheduled_at", "is", null);
  if (status && !outcomes.has(status)) request = request.eq("status", status);
  request = request.order("created_at", { ascending: false }).range(paging.from, paging.to);
  request = dateFilter(request, from, to);
  const search = String(query).trim().slice(0, 100);
  if (search) request = request.or(`user_id.eq.${search},id.eq.${search}`);
  const { data, count, error } = await request;
  throwDataError(error);
  const ids = [...new Set((data || []).map((row) => row.user_id))];
  const [{ data: profiles, error: profileError }, { data: accounts, error: accountsError }, { data: contentRows, error: contentError }] = await Promise.all([
    ids.length ? db.from("profiles").select("id,account_name,full_name").in("id", ids) : Promise.resolve({ data: [], error: null }),
    outcomes.has(status) && data?.length ? db.from("social_accounts").select("id,user_id,expires_at").in("id", data.map((row) => row.social_account_id).filter(Boolean)) : Promise.resolve({ data: [], error: null }),
    outcomes.has(status) && data?.length ? db.from("content_outputs").select("id,content").in("id", data.map((row) => row.content_output_id).filter(Boolean)) : Promise.resolve({ data: [], error: null }),
  ]);
  throwDataError(profileError); throwDataError(accountsError); throwDataError(contentError);
  const profileMap = new Map((profiles || []).map((row) => [row.id, row]));
  const contentMap = new Map((contentRows || []).map((row) => [row.id, row.content]));
  return {
    items: (data || []).map((row) => ({
      id: row.id, userId: row.user_id,
      user: profileMap.get(row.user_id)?.full_name || profileMap.get(row.user_id)?.account_name || row.user_id,
      content: row.content || contentMap.get(row.content_output_id) || null,
      status: row.publish_status || row.status,
      scheduledAt: row.scheduled_at || null, publishedAt: row.posted_at || null,
      error: row.publish_error_message || null, attempts: Number(row.retry_count || 0),
      threadsConnected: (accounts || []).some((account) => account.user_id === row.user_id && (!account.expires_at || new Date(account.expires_at) > new Date())),
    })),
    total: count ?? 0, page: paging.page, limit: paging.limit,
  };
}

async function getAuditLogs({ page = 1, limit = 25 } = {}) {
  const db = getAdminDb();
  const paging = pageArgs({ page, limit });
  const { data, count, error } = await db.from("admin_audit_logs")
    .select("id,admin_user_id,action,target_type,target_id,previous_values,new_values,reason,result_status,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(paging.from, paging.to);
  throwDataError(error);
  return { items: data || [], total: count ?? 0, page: paging.page, limit: paging.limit };
}

async function getErrorLogs({ from, to, status = "", query = "", page = 1, limit = 25 } = {}) {
  const db = getAdminDb();
  const paging = pageArgs({ page, limit });
  let request = db.from("admin_error_logs")
    .select("id,request_id,user_id,method,path,status_code,error_code,error_name,message,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(paging.from, paging.to);
  if (/^5\d\d$/.test(String(status))) request = request.eq("status_code", Number(status));
  const search = String(query).trim().slice(0, 100);
  if (search) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) {
      request = request.eq("request_id", search);
    } else {
      request = request.ilike("error_code", `%${search.replace(/[%_,()]/g, "")}%`);
    }
  }
  request = dateFilter(request, from, to);
  const { data, count, error } = await request;
  throwDataError(error);
  return { items: data || [], total: count ?? 0, page: paging.page, limit: paging.limit };
}

async function getFeedback({ from, to, query = "", page = 1, limit = 25 } = {}) {
  const db = getAdminDb();
  const paging = pageArgs({ page, limit });
  let request = db.from("feedback_submissions")
    .select("id,user_id,user_email,user_name,message,page_path,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(paging.from, paging.to);
  const search = String(query).trim().slice(0, 100).replace(/[%_,()]/g, " ").trim();
  if (search) request = request.or(`message.ilike.%${search}%,user_email.ilike.%${search}%,user_name.ilike.%${search}%`);
  request = dateFilter(request, from, to);
  const { data, count, error } = await request;
  throwDataError(error);
  return { items: data || [], total: count ?? 0, page: paging.page, limit: paging.limit };
}

module.exports = { getAiUsage, getAuditLogs, getErrorLogs, getFeedback, getOverview, getProfitability, getScheduledPosts, getSubscriptionFinancials, getTransactions, getUserDetails, getUsers, normalizeReportRange };
