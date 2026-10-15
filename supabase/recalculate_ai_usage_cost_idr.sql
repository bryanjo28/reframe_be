-- Recalculate existing estimates using the configured fixed exchange rate:
-- 1 USD = IDR 18,000. Future rows use the same rate in aiCreditsService.js.
update public.ai_usage_logs
set estimated_cost_idr = round(actual_cost_usd * 18000, 2)
where estimated_cost_idr is distinct from round(actual_cost_usd * 18000, 2);
