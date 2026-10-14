const assert = require("node:assert/strict");
const { assertCapacity, assertScheduleAccess, assertThreadsAccess, normalizeEntitlements } = require("../src/services/entitlementsService");

function run(name, fn) {
  return Promise.resolve().then(fn).then(() => console.log(`ok - ${name}`)).catch((error) => { console.error(`not ok - ${name}`); console.error(error); process.exitCode = 1; });
}

function fakeDb({ code = "free", count = 0, endsAt = null } = {}) {
  const definitions = {
    free: { max_personas: 1, max_content_pillars: 1, max_threads_accounts: 0, can_schedule: false },
    starter: { max_personas: 2, max_content_pillars: 3, max_threads_accounts: 1, can_schedule: true },
    creator: { max_personas: 5, max_content_pillars: 10, max_threads_accounts: 1, can_schedule: true },
    pro: { max_personas: 10, max_content_pillars: 20, max_threads_accounts: 1, can_schedule: true },
  };
  return { from(table) {
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, maybeSingle: async () => {
      if (table === "user_subscriptions") return { data: { id: "sub-1", user_id: "user-1", plan_id: `${code}-id`, status: "active", started_at: "2026-01-01T00:00:00Z", ends_at: endsAt }, error: null };
      if (table === "subscription_plans") return { data: { id: `${code}-id`, code, name: code, is_active: true, ...definitions[code] }, error: null };
      return { data: null, error: null };
    }, then(resolve) { return Promise.resolve({ count, error: null }).then(resolve); } };
    return query;
  } };
}

run("plan entitlements use the final persona and pillar limits", () => {
  assert.deepEqual(normalizeEntitlements({ code: "creator" }), { planCode: "creator", planName: "Creator", maxPersonas: 5, maxContentPillars: 10, maxThreadsAccounts: 1, canSchedule: true });
});

run("free cannot connect Threads or schedule", async () => {
  const db = fakeDb({ code: "free" });
  await assert.rejects(assertThreadsAccess({ supabase: db, userId: "user-1" }), { code: "THREADS_PLAN_REQUIRED", status: 403 });
  await assert.rejects(assertScheduleAccess({ supabase: db, userId: "user-1" }), { code: "SCHEDULE_PLAN_REQUIRED", status: 403 });
});

run("creator blocks an eleventh pillar without deleting existing data", async () => {
  await assert.rejects(assertCapacity({ supabase: fakeDb({ code: "creator", count: 10 }), userId: "user-1", resource: "content_pillar" }), { code: "CONTENT_PILLAR_LIMIT_EXCEEDED", status: 403 });
});

run("starter can connect one Threads account and schedule", async () => {
  const db = fakeDb({ code: "starter" });
  assert.equal((await assertThreadsAccess({ supabase: db, userId: "user-1" })).maxThreadsAccounts, 1);
  assert.equal((await assertScheduleAccess({ supabase: db, userId: "user-1" })).canSchedule, true);
});
