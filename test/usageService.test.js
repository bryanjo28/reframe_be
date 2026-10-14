const assert = require("node:assert/strict");

const {
  getMonthlyAiCreditsUsed,
  sumAiUsageCredits,
} = require("../src/services/usageService");

function run(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

(async () => {
  await run("monthly AI credit usage sums charged ledger debits", () => {
    assert.equal(
      sumAiUsageCredits([
        { credits_delta: -2 },
        { credits_delta: -3 },
        { credits_delta: 0 },
      ]),
      5
    );
  });

  await run("monthly AI credit usage queries every AI debit in the requested month", async () => {
    const filters = [];
    const query = {
      select(columns) {
        assert.equal(columns, "credits_delta");
        return query;
      },
      eq(column, value) {
        filters.push(["eq", column, value]);
        return query;
      },
      gte(column, value) {
        filters.push(["gte", column, value]);
        return query;
      },
      lt(column, value) {
        filters.push(["lt", column, value]);
        return Promise.resolve({
          data: [{ credits_delta: -2 }, { credits_delta: -1 }],
          error: null,
        });
      },
    };

    const used = await getMonthlyAiCreditsUsed({
      supabase: {
        from(table) {
          assert.equal(table, "credit_transactions");
          return query;
        },
      },
      userId: "user-1",
      periodMonth: "2026-10-01",
    });

    assert.equal(used, 3);
    assert.deepEqual(filters, [
      ["eq", "user_id", "user-1"],
      ["eq", "transaction_type", "ai_usage"],
      ["gte", "created_at", "2026-10-01T00:00:00.000Z"],
      ["lt", "created_at", "2026-11-01T00:00:00.000Z"],
    ]);
  });
})();
