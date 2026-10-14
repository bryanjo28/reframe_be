const assert = require("node:assert/strict");

require("dotenv").config();

const {
  listSubscriptionPlans,
  mapSubscriptionPlanRow,
} = require("../src/services/subscriptionPlansService");

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
  await run("subscription plan responses expose the database pillar limit", () => {
    const result = mapSubscriptionPlanRow({
      id: "plan-1",
      code: "free",
      name: "Free",
      max_personas: 1,
      content_pillars: 4,
      monthly_ai_credits: 100,
      is_active: true,
    });

    assert.equal(result.maxContentPillars, 4);
    assert.equal(Object.hasOwn(result, "maxThreadsAccounts"), false);
    assert.equal(Object.hasOwn(result, "canSchedule"), false);
  });

  await run("subscription plan list queries the current pillar limit column", async () => {
    let selectedColumns = null;
    const query = {
      select(columns) {
        selectedColumns = columns;
        return query;
      },
      eq() {
        return query;
      },
      order() {
        return Promise.resolve({ data: [], error: null });
      },
    };

    await listSubscriptionPlans({
      supabase: { from: () => query },
    });

    assert.match(selectedColumns, /(?:^|,\s*)content_pillars(?:,|$)/);
    assert.doesNotMatch(selectedColumns, /max_content_pillars/);
    assert.doesNotMatch(selectedColumns, /max_threads_accounts/);
    assert.doesNotMatch(selectedColumns, /can_schedule/);
  });
})();
