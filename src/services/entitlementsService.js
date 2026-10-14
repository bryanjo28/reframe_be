const { SUBSCRIPTION_PLANS } = require("../config/billing");
const { getActiveUserSubscription } = require("./subscriptionUsageService");

const LIMIT_MESSAGE = "Batas Persona atau Content Pillar pada paket kamu sudah tercapai. Upgrade paket untuk menambahkan lebih banyak.";
const SCHEDULE_MESSAGE = "Schedule Post tersedia mulai dari paket Starter. Upgrade untuk menjadwalkan konten Threads kamu secara otomatis.";
const THREADS_MESSAGE = "Connect Threads tersedia mulai dari paket Starter. Upgrade paket untuk menghubungkan akun Threads.";

function httpError(message, status, code, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { code, upgradePlan: true, ...details };
  return error;
}

function fallbackPlan(code = "free") {
  return SUBSCRIPTION_PLANS.find((plan) => plan.code === code) || SUBSCRIPTION_PLANS[0];
}

function normalizeEntitlements(plan = {}) {
  const fallback = fallbackPlan(String(plan.code || "free").toLowerCase());
  return {
    planCode: fallback.code,
    planName: plan.name || fallback.name,
    maxPersonas: Number(plan.maxPersonas ?? plan.max_personas ?? fallback.maxPersonas),
    maxContentPillars: Number(
      plan.maxContentPillars ??
      plan.content_pillars ??
      plan.max_content_pillars ??
      fallback.maxContentPillars
    ),
    maxThreadsAccounts: Number(plan.maxThreadsAccounts ?? plan.max_threads_accounts ?? fallback.maxThreadsAccounts),
    canSchedule: Boolean(plan.canSchedule ?? plan.can_schedule ?? fallback.canSchedule),
  };
}

async function getUserEntitlements({ supabase, userId }) {
  const active = await getActiveUserSubscription({ supabase, userId });
  return { ...normalizeEntitlements(active?.plan), subscription: active?.subscription || null };
}

async function countOwned({ supabase, table, userId }) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw httpError(error.message, 500, "ENTITLEMENT_COUNT_FAILED", { table });
  return count || 0;
}

async function assertCapacity({ supabase, userId, resource }) {
  const entitlements = await getUserEntitlements({ supabase, userId });
  const isPersona = resource === "persona";
  const table = isPersona ? "persona_configs" : "content_pillars";
  const limit = isPersona ? entitlements.maxPersonas : entitlements.maxContentPillars;
  const currentCount = await countOwned({ supabase, table, userId });
  if (currentCount >= limit) {
    throw httpError(LIMIT_MESSAGE, 403, isPersona ? "PERSONA_LIMIT_EXCEEDED" : "CONTENT_PILLAR_LIMIT_EXCEEDED", { limit, currentCount, resource, entitlements });
  }
  return { entitlements, limit, currentCount, remaining: limit - currentCount };
}

async function assertThreadsAccess({ supabase, userId }) {
  const entitlements = await getUserEntitlements({ supabase, userId });
  if (entitlements.maxThreadsAccounts < 1) throw httpError(THREADS_MESSAGE, 403, "THREADS_PLAN_REQUIRED", { entitlements });
  return entitlements;
}

async function assertScheduleAccess({ supabase, userId }) {
  const entitlements = await getUserEntitlements({ supabase, userId });
  if (!entitlements.canSchedule || !entitlements.subscription) throw httpError(SCHEDULE_MESSAGE, 403, "SCHEDULE_PLAN_REQUIRED", { entitlements });
  return entitlements;
}

module.exports = { LIMIT_MESSAGE, SCHEDULE_MESSAGE, THREADS_MESSAGE, assertCapacity, assertScheduleAccess, assertThreadsAccess, getUserEntitlements, normalizeEntitlements };
