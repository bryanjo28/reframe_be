const assert = require("node:assert/strict");

const { recordUserAiUsage, normalizeUsageAmount } = require("../src/services/userUsageService");

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

function createFakeSupabase(existingRow = null) {
  const state = {
    existingRow,
    insertedPayload: null,
    updatedPayload: null,
  };

  return {
    state,
    from(tableName) {
      assert.equal(tableName, "user_usage");

      const query = {
        filters: {},
      };

      const selectChain = {
        eq(column, value) {
          query.filters[column] = value;
          return selectChain;
        },
        maybeSingle() {
          const match =
            state.existingRow &&
            state.existingRow.user_id === query.filters.user_id &&
            state.existingRow.period_month === query.filters.period_month
              ? state.existingRow
              : null;

          return Promise.resolve({ data: match, error: null });
        },
      };

      return {
        select() {
          return selectChain;
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
                        ...(state.existingRow || {}),
                        id: state.existingRow?.id || "usage-row-1",
                        user_id: state.existingRow?.user_id || query.filters.user_id,
                        period_month:
                          state.existingRow?.period_month || query.filters.period_month,
                        ai_credits_used:
                          (state.existingRow?.ai_credits_used || 0) + payload.ai_credits_used -
                          (state.existingRow?.ai_credits_used || 0),
                        ...payload,
                      };

                      state.existingRow = nextRow;
                      return Promise.resolve({ data: nextRow, error: null });
                    },
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
                single() {
                  const nextRow = {
                    id: "usage-row-1",
                    user_id: payload.user_id,
                    period_month: payload.period_month,
                    ai_credits_used: payload.ai_credits_used,
                    created_at: "2026-06-01T00:00:00.000Z",
                    updated_at: "2026-06-01T00:00:00.000Z",
                  };

                  state.existingRow = nextRow;
                  return Promise.resolve({ data: nextRow, error: null });
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
  await run("normalizeUsageAmount prefers total_tokens and falls back to prompt + completion", () => {
    assert.equal(
      normalizeUsageAmount({ total_tokens: 12, prompt_tokens: 3, completion_tokens: 4 }),
      12
    );
    assert.equal(normalizeUsageAmount({ prompt_tokens: 3, completion_tokens: 4 }), 7);
    assert.equal(normalizeUsageAmount(null), 0);
  });

  await run("recordUserAiUsage inserts a new monthly row", async () => {
    const supabase = createFakeSupabase();

    const result = await recordUserAiUsage({
      supabase,
      userId: "user-123",
      usage: { prompt_tokens: 5, completion_tokens: 7 },
      periodMonth: "2026-06-01",
      now: new Date("2026-06-07T00:00:00.000Z"),
    });

    assert.equal(supabase.state.insertedPayload.user_id, "user-123");
    assert.equal(supabase.state.insertedPayload.period_month, "2026-06-01");
    assert.equal(supabase.state.insertedPayload.ai_credits_used, 12);
    assert.equal(result.aiCreditsUsed, 12);
  });

  await run("recordUserAiUsage updates an existing monthly row", async () => {
    const supabase = createFakeSupabase({
      id: "usage-row-1",
      user_id: "user-123",
      period_month: "2026-06-01",
      ai_credits_used: 10,
    });

    const result = await recordUserAiUsage({
      supabase,
      userId: "user-123",
      usage: { total_tokens: 6 },
      periodMonth: "2026-06-01",
      now: new Date("2026-06-07T00:00:00.000Z"),
    });

    assert.equal(supabase.state.updatedPayload.ai_credits_used, 16);
    assert.equal(result.aiCreditsUsed, 16);
  });
})();
