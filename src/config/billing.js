const TOKENS_PER_CREDIT = 5_000;
const INTERNAL_COST_IDR_PER_CREDIT = 50;

const AI_PRICING_USD_PER_MILLION = Object.freeze({
  input: 0.1,
  cachedInput: 0.01,
  output: 0.5,
});

const SUBSCRIPTION_PLANS = Object.freeze([
  { code: "free", name: "Free", priceIdr: 0, credits: 6, tokenAllowance: 30_000, maxPersonas: 1, maxContentPillars: 1, maxThreadsAccounts: 0, canSchedule: false },
  { code: "starter", name: "Starter", priceIdr: 29_000, credits: 200, tokenAllowance: 1_000_000, maxPersonas: 2, maxContentPillars: 3, maxThreadsAccounts: 1, canSchedule: true },
  { code: "creator", name: "Creator", priceIdr: 59_000, credits: 600, tokenAllowance: 3_000_000, maxPersonas: 5, maxContentPillars: 10, maxThreadsAccounts: 1, canSchedule: true },
  { code: "pro", name: "Pro", priceIdr: 99_000, credits: 1_200, tokenAllowance: 6_000_000, maxPersonas: 10, maxContentPillars: 20, maxThreadsAccounts: 1, canSchedule: true },
]);

const TOP_UP_PRODUCTS = Object.freeze([
  { code: "mini", name: "Mini", priceIdr: 15_000, credits: 100, tokenAllowance: 500_000 },
  { code: "basic", name: "Basic", priceIdr: 29_000, credits: 250, tokenAllowance: 1_250_000 },
  { code: "plus", name: "Plus", priceIdr: 49_000, credits: 500, tokenAllowance: 2_500_000 },
  { code: "max", name: "Max", priceIdr: 89_000, credits: 1_000, tokenAllowance: 5_000_000 },
]);

const MAX_AI_OUTPUT_TOKENS = Math.max(1, Number(process.env.MAX_AI_OUTPUT_TOKENS || 4_000));
const MAX_AI_CREDITS_PER_REQUEST = Math.max(1, Number(process.env.MAX_AI_CREDITS_PER_REQUEST || 10));

module.exports = {
  AI_PRICING_USD_PER_MILLION,
  INTERNAL_COST_IDR_PER_CREDIT,
  MAX_AI_CREDITS_PER_REQUEST,
  MAX_AI_OUTPUT_TOKENS,
  SUBSCRIPTION_PLANS,
  TOKENS_PER_CREDIT,
  TOP_UP_PRODUCTS,
};
