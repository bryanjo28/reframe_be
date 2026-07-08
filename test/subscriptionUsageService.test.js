const assert = require("node:assert/strict");

const { consumeMonthlyAiCredits } = require("../src/services/subscriptionUsageService");

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

function createFakeSupabase({
  subscriptionRow = null,
  planRow = null,
  usageRow = null,
}) {
  const state = {
    usageRow,
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

          if (tableName === "user_usage") {
            const row = state.usageRow;
            return Promise.resolve({
              data: row
                ? {
                    id: row.id,
                    user_id: row.user_id,
                    period_month: row.period_month,
                    ai_credits_used: row.ai_credits_used,
                    created_at: row.created_at || null,
                    updated_at: row.updated_at || null,
                  }
                : null,
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
        insert(payload) {
          state.insertedPayload = payload;

          return {
            select() {
              return {
                single() {
                  const nextRow = {
                    id: "usage-row-1",
                    user_id: payload.user_id,
                    period_month: payload.period_month,
                    ai_credits_used: payload.ai_credits_used,
                    created_at: "2026-06-01T00:00:00.000Z",
                    updated_at: "2026-06-01T00:00:00.000Z",
                  };

                  state.usageRow = nextRow;
                  return Promise.resolve({ data: nextRow, error: null });
                },
              };
            },
          };
        },
        update(payload) {
          state.updatedPayload = payload;

          return {
            eq(column, value) {
              query.filters[column] = value;
              return {
                select() {
                  return {
                    single() {
                      const nextRow = {
                        ...(state.usageRow || {}),
                        id: state.usageRow?.id || "usage-row-1",
                        user_id: state.usageRow?.user_id || query.filters.user_id,
                        period_month:
                          state.usageRow?.period_month || query.filters.period_month,
                        ai_credits_used: payload.ai_credits_used,
                        updated_at: payload.updated_at,
                      };

                      state.usageRow = nextRow;
                      return Promise.resolve({ data: nextRow, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

(async () => {
  await run("consumeMonthlyAiCredits records usage when still within quota", async () => {
    const supabase = createFakeSupabase({
      subscriptionRow: {
        id: "sub-1",
        user_id: "user-123",
        plan_id: "plan-1",
        status: "active",
        started_at: "2026-06-01T00:00:00.000Z",
      },
      planRow: {
        id: "plan-1",
        code: "pro",
        name: "Pro",
        max_personas: 10,
        monthly_ai_credits: 100,
        is_active: true,
      },
      usageRow: {
        id: "usage-1",
        user_id: "user-123",
        period_month: "2026-06-01",
        ai_credits_used: 40,
      },
    });

    const result = await consumeMonthlyAiCredits({
      supabase,
      userId: "user-123",
      usage: { total_tokens: 12 },
      periodMonth: "2026-06-01",
      now: new Date("2026-06-07T00:00:00.000Z"),
    });

    assert.equal(supabase.state.updatedPayload.ai_credits_used, 52);
    assert.equal(result.remainingCredits, 48);
  });

  await run("consumeMonthlyAiCredits blocks usage when quota is exceeded", async () => {
    const supabase = createFakeSupabase({
      subscriptionRow: {
        id: "sub-1",
        user_id: "user-123",
        plan_id: "plan-1",
        status: "active",
        started_at: "2026-06-01T00:00:00.000Z",
      },
      planRow: {
        id: "plan-1",
        code: "basic",
        name: "Basic",
        max_personas: 2,
        monthly_ai_credits: 50,
        is_active: true,
      },
      usageRow: {
        id: "usage-1",
        user_id: "user-123",
        period_month: "2026-06-01",
        ai_credits_used: 45,
      },
    });

    let receivedError = null;
    try {
      await consumeMonthlyAiCredits({
        supabase,
        userId: "user-123",
        usage: { total_tokens: 10 },
        periodMonth: "2026-06-01",
        now: new Date("2026-06-07T00:00:00.000Z"),
      });
    } catch (error) {
      receivedError = error;
    }

    assert.ok(receivedError);
    assert.equal(receivedError.status, 402);
    assert.equal(receivedError.message, "Monthly AI credits exceeded");
    assert.equal(supabase.state.insertedPayload, null);
    assert.equal(supabase.state.updatedPayload, null);
  });
})();
