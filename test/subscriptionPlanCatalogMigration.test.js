const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.subscription_plans (
        id uuid primary key default gen_random_uuid(),
        code text not null unique,
        name text not null,
        max_personas integer not null default 1,
        monthly_ai_credits integer not null default 100,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        daily_topic_generations integer not null default 0,
        daily_content_generations integer not null default 0,
        price numeric not null default 0,
        token_allowance bigint not null default 0,
        currency text not null default 'IDR',
        content_pillars integer not null default 1
      );
    `);

    const migration = fs.readFileSync(require.resolve('../supabase/migrations/20261021120000_align_subscription_plan_catalog.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Deployment retries must stay safe.

    const { rows } = await db.query(`
      select code, price::integer as price, max_personas, content_pillars,
        max_threads_accounts, can_schedule, monthly_ai_credits, token_allowance, is_active
      from public.subscription_plans order by case code
        when 'free' then 0 when 'starter' then 1 when 'creator' then 2 else 3 end
    `);
    assert.deepEqual(rows.map(({ code, price, max_personas, content_pillars, max_threads_accounts, can_schedule, monthly_ai_credits, token_allowance, is_active }) =>
      [code, price, max_personas, content_pillars, max_threads_accounts, can_schedule, monthly_ai_credits, Number(token_allowance), is_active]), [
      ['free', 0, 1, 1, 0, false, 6, 30000, true],
      ['starter', 29000, 2, 3, 1, true, 200, 1000000, true],
      ['creator', 59000, 5, 10, 1, true, 600, 3000000, true],
      ['pro', 99000, 10, 20, 1, true, 1200, 6000000, true],
    ]);
    console.log('ok - plan catalog migration persists the exact UI and entitlement limits idempotently');
  } finally {
    await db.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
