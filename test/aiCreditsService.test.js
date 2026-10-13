const assert = require("assert");
const {
  calculateCosts,
  creditsForTokens,
  estimateReservation,
  normalizeProviderUsage,
} = require("../src/services/aiCreditsService");

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

test("10,000 tokens cost exactly 2 credits", () => assert.equal(creditsForTokens(10_000), 2));
test("10,001 tokens round up to 3 credits", () => assert.equal(creditsForTokens(10_001), 3));
test("a non-empty usage has a minimum of one credit", () => assert.equal(creditsForTokens(1), 1));
test("cached input tokens are included once in total tokens", () => {
  const usage = normalizeProviderUsage({ prompt_tokens: 8_000, completion_tokens: 2_000, total_tokens: 10_000, prompt_tokens_details: { cached_tokens: 6_000 } });
  assert.deepEqual(usage, { inputTokens: 8_000, cachedInputTokens: 6_000, outputTokens: 2_000, totalTokens: 10_000, isEstimated: false });
});
test("cached input receives the discounted actual API rate", () => {
  const costs = calculateCosts({ prompt_tokens: 8_000, completion_tokens: 2_000, total_tokens: 10_000, prompt_tokens_details: { cached_tokens: 6_000 } });
  assert.equal(costs.estimatedCostIdr, 100);
  assert.equal(costs.actualCostUsd, 0.00126);
});
test("reservation estimate respects configured maximum", () => {
  const estimate = estimateReservation({ messages: [{ content: "halo" }], maxTokens: 1200 });
  assert.equal(estimate.credits, 1);
  assert.equal(estimate.maxOutputTokens, 1200);
});
