const assert = require("node:assert/strict");

const { consumeDailyGenerationHit } = require("../src/services/dailyGenerationUsageService");

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

function createFakeSupabase({ subscriptionRow, planRow, dailyUsageRow = null }) {
  const state = {
    insertedPayload: null,
    updatedPayload: null,
  };

  return {
    state,
    from(tableName) {
      const query = { filters: {} };

      const selectChain = {
        eq(column, value) {
          query.filters[column] = value;
          return selectChain;
        },
        order() {
          return selectChain;
        },
        maybeSingle() {
          if (tableName === "user_subscriptions") {
            return Promise.resolve({ data: subscriptionRow, error: null });
          }

          if (tableName === "subscription_plans") {
            return Promise.resolve({ data: planRow, error: null });
          }

          if (tableName === "user_daily_usage") {
            return Promise.resolve({
              data: dailyUsageRow,
              error: null,
            });
          }

          return Promise.resolve({ data: null, error: null });
        },
      };

      return {
        select() {
          return selectChain;
        },
        update(payload) {
          state.updatedPayload = payload;
          return {
            eq() {
              return {
                select() {
                  return {
                    single: async () => ({
                      data: {
                        id: dailyUsageRow?.id || "daily-1",
                        user_id: query.filters.user_id,
                        usage_date: query.filters.usage_date,
                        usage_key: query.filters.usage_key,
                        request_count: payload.request_count,
                        created_at: dailyUsageRow?.created_at || "2026-06-07T00:00:00.000Z",
                        updated_at: payload.updated_at,
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
        insert(payload) {
          state.insertedPayload = payload;
          return {
            select() {
              return {
                single: async () => ({
                  data: {
                    id: "daily-1",
                    user_id: payload.user_id,
                    usage_date: payload.usage_date,
                    usage_key: payload.usage_key,
                    request_count: payload.request_count,
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
    },
  };
}

(async () => {
  await run("consumeDailyGenerationHit inserts a daily row when under limit", async () => {
    const supabase = createFakeSupabase({
      subscriptionRow: {
        id: "sub-1",
        user_id: "user-1",
        plan_id: "plan-1",
        status: "active",
      },
      planRow: {
        id: "plan-1",
        code: "pro",
        name: "PRO",
        max_personas: 3,
        monthly_ai_credits: 1000,
        daily_topic_generations: 5,
        daily_content_generations: 10,
        is_active: true,
      },
    });

    const result = await consumeDailyGenerationHit({
      supabase,
      userId: "user-1",
      usageKey: "generate_topic",
      now: new Date("2026-06-07T00:00:00.000Z"),
    });

    assert.equal(supabase.state.insertedPayload.user_id, "user-1");
    assert.equal(supabase.state.insertedPayload.usage_key, "generate_topic");
    assert.equal(supabase.state.insertedPayload.request_count, 1);
    assert.equal(result.dailyLimit, 5);
  });

  await run("consumeDailyGenerationHit blocks when daily limit is exceeded", async () => {
    const supabase = createFakeSupabase({
      subscriptionRow: {
        id: "sub-1",
        user_id: "user-1",
        plan_id: "plan-1",
        status: "active",
      },
      planRow: {
        id: "plan-1",
        code: "free",
        name: "FREE",
        max_personas: 1,
        monthly_ai_credits: 100,
        daily_topic_generations: 1,
        daily_content_generations: 1,
        is_active: true,
      },
      dailyUsageRow: {
        id: "daily-1",
        user_id: "user-1",
        usage_date: "2026-06-07",
        usage_key: "generate_content",
        request_count: 1,
      },
    });

    let receivedError = null;
    try {
      await consumeDailyGenerationHit({
        supabase,
        userId: "user-1",
        usageKey: "generate_content",
        now: new Date("2026-06-07T00:00:00.000Z"),
      });
    } catch (error) {
      receivedError = error;
    }

    assert.ok(receivedError);
    assert.equal(receivedError.status, 402);
    assert.equal(receivedError.message, "Daily generation limit exceeded");
    assert.equal(supabase.state.insertedPayload, null);
  });
})();
