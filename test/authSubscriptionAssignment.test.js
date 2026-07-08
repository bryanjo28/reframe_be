const assert = require("node:assert/strict");
const path = require("node:path");

function run(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function loadAuthServiceWithMockSupabaseAdmin({ existingSubscription = null, freePlan = null }) {
  const configPath = require.resolve("../src/config/supabase");
  const authServicePath = require.resolve("../src/services/authService");

  delete require.cache[authServicePath];
  delete require.cache[configPath];

  const state = {
    insertedPayload: null,
  };

  const supabaseAdminMock = {
    from(table) {
      const query = {
        filters: {},
        select() {
          return query;
        },
        eq(column, value) {
          query.filters[column] = value;
          return query;
        },
        maybeSingle: async () => {
          if (table === "user_subscriptions") {
            return { data: existingSubscription, error: null };
          }

          if (table === "subscription_plans") {
            return { data: freePlan, error: null };
          }

          return { data: null, error: null };
        },
        insert(payload) {
          state.insertedPayload = payload;
          return {
            select() {
              return {
                single: async () => ({
                  data: {
                    id: "sub-1",
                    user_id: payload.user_id,
                    plan_id: payload.plan_id,
                    status: payload.status,
                    started_at: "2026-06-07T00:00:00.000Z",
                    ends_at: null,
                    created_at: "2026-06-07T00:00:00.000Z",
                    updated_at: "2026-06-07T00:00:00.000Z",
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };

      return query;
    },
  };

  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      createSupabaseUserClient: () => {
        throw new Error("not used in this test");
      },
      isSupabaseAdminConfigured: true,
      isSupabaseConfigured: true,
      supabase: null,
      supabaseAdmin: supabaseAdminMock,
    },
  };

  const authService = require("../src/services/authService");

  return {
    authService,
    state,
  };
}

(async () => {
  await run("ensureFreeSubscriptionForUser creates free subscription when missing", async () => {
    const { authService, state } = loadAuthServiceWithMockSupabaseAdmin({
      existingSubscription: null,
      freePlan: {
        id: "plan-free",
        code: "free",
        name: "FREE",
        max_personas: 1,
        monthly_ai_credits: 100,
        is_active: true,
      },
    });

    const result = await authService.ensureFreeSubscriptionForUser({
      userId: "user-123",
    });

    assert.equal(state.insertedPayload.user_id, "user-123");
    assert.equal(state.insertedPayload.plan_id, "plan-free");
    assert.equal(state.insertedPayload.status, "active");
    assert.equal(result.plan_id, "plan-free");
  });

  await run("ensureFreeSubscriptionForUser skips insert when active subscription exists", async () => {
    const existingSubscription = {
      id: "sub-existing",
      user_id: "user-123",
      plan_id: "plan-pro",
      status: "active",
      started_at: "2026-06-01T00:00:00.000Z",
      ends_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };

    const { authService, state } = loadAuthServiceWithMockSupabaseAdmin({
      existingSubscription,
      freePlan: {
        id: "plan-free",
        code: "free",
        name: "FREE",
        max_personas: 1,
        monthly_ai_credits: 100,
        is_active: true,
      },
    });

    const result = await authService.ensureFreeSubscriptionForUser({
      userId: "user-123",
    });

    assert.equal(state.insertedPayload, null);
    assert.equal(result.id, "sub-existing");
  });
})();
