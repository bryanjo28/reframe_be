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
  if (!reportError) return report;
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
  return {
    metrics: {
      registeredUsers: registeredUsers.count ?? 0,
      activeSubscriptions: activeSubscriptions.count ?? 0,
      paidOrders: paidOrders.count ?? 0,
      aiRequests: aiRequests.count ?? 0,
      scheduledJobs: scheduledJobs.count ?? 0,
      publishedPosts: publishedPosts.count ?? 0,
      failedPosts: failedPosts.count ?? 0,
    },
    generatedAt: new Date().toISOString(),
    coverage: { subscriptionRevenue: false, mrr: false, gatewayFees: false, actualAiCostIdr: false, lastActiveTimestamp: false, refundLedgerComplete: false },
    reportingSetupRequired: true,
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
  return data;
}

async function getUsers({ query = "", plan = "", status = "", from, to, page = 1, limit = 25 } = {}) {
  const db = getAdminDb();
  const paging = pageArgs({ page, limit });
  const range = normalizeReportRange({ from, to });
  const report = await getProfitability({ ...range, plan, sort: "highest_revenue", page: paging.page, limit: paging.limit, query });
  let items = report?.items || [];
  if (status) items = items.filter((item) => (status === "active" ? item.plan_code !== "free" : item.plan_code === "free"));
  const ids = items.map((item) => item.id);
  const { data: accounts, error } = ids.length
    ? await db.from("social_accounts").select("user_id,expires_at").in("user_id", ids).eq("platform", "threads")
    : { data: [], error: null };
  throwDataError(error);
  const connected = new Set((accounts || []).filter((row) => !row.expires_at || new Date(row.expires_at) > new Date()).map((row) => row.user_id));
  return {
    ...report,
    items: items.map((row) => ({
      ...row,
      name: row.full_name || row.account_name,
      accountName: row.account_name,
      plan: row.plan_name,
      planCode: row.plan_code,
      subscriptionStatus: row.plan_code === "free" ? "free" : "active",
      creditsAvailable: row.credits_remaining,
      creditsConsumed: row.credits_used,
      totalTokens: row.total_tokens,
      totalPaidIdr: row.known_net_revenue_idr,
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
    profile: { ...profileResult.data, email: user?.email || null },
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

module.exports = { getAiUsage, getAuditLogs, getErrorLogs, getOverview, getProfitability, getScheduledPosts, getTransactions, getUserDetails, getUsers, normalizeReportRange };
