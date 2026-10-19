const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table profiles(id uuid primary key);
      create table subscription_plans(id uuid primary key, code text, name text, monthly_ai_credits integer, is_active boolean,
        max_personas integer default 2, content_pillars integer default 3,
        max_content_pillars integer default 3, max_threads_accounts integer default 1, can_schedule boolean default true);
      create table persona_configs(id uuid default gen_random_uuid(),user_id uuid);
      create table scheduled_jobs(id uuid default gen_random_uuid(),user_id uuid);
      create table social_accounts(id uuid default gen_random_uuid(),user_id uuid,platform text);
      create table payment_orders(id uuid primary key, user_id uuid references profiles, plan_id uuid, order_type text,
        provider text, provider_reference text, payment_reference text, amount_idr bigint, token_amount bigint, credits integer,
        status text, paid_at timestamptz, updated_at timestamptz);
      create table user_subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid, plan_id uuid,
        status text, started_at timestamptz, ends_at timestamptz, current_period_start timestamptz,
        current_period_end timestamptz, payment_reference text, updated_at timestamptz);
      create table credit_lots(id uuid primary key default gen_random_uuid(), user_id uuid, credit_type text,
        original_credits integer, remaining_credits integer, expires_at timestamptz, source_reference text,
        unique(user_id,credit_type,source_reference));
      create table credit_transactions(id uuid default gen_random_uuid(), user_id uuid, transaction_type text,
        credits_delta integer, balance_after integer, source_type text, source_id text, idempotency_key text unique);
      create table user_notifications(user_id uuid, type text, title text, message text);
      create function current_credit_balance(p_user_id uuid) returns integer language sql as
        'select coalesce(sum(remaining_credits),0)::integer from credit_lots where user_id=p_user_id and (expires_at is null or expires_at>now())';
    `);
    const legacy=fs.readFileSync(require.resolve('../supabase/billing_credits_refactor.sql'),'utf8');
    await db.exec(legacy.slice(legacy.indexOf('create or replace function public.enforce_alurin_entitlement()'),legacy.indexOf('revoke all on function public.enforce_alurin_entitlement()')));
    await db.exec('create trigger enforce_persona_entitlement before insert on persona_configs for each row execute function enforce_alurin_entitlement()');
    await db.exec('create trigger enforce_schedule_entitlement before insert on scheduled_jobs for each row execute function enforce_alurin_entitlement()');
    const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261019010000_prepaid_multi_month_subscriptions.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // deployment retry is safe
    const user = '00000000-0000-4000-8000-000000000001';
    const plan = '00000000-0000-4000-8000-000000000002';
    const order = '00000000-0000-4000-8000-000000000003';
    await db.query('insert into profiles values ($1)', [user]);
    await db.query("insert into subscription_plans(id,code,name,monthly_ai_credits,is_active) values ($1,'starter','Starter',999,true)", [plan]);
    await db.query(`insert into payment_orders(id,user_id,plan_id,order_type,provider,provider_reference,amount_idr,token_amount,credits,status,duration_months,monthly_price_idr,monthly_credits)
      values ($1,$2,$3,'subscription','pakasir','txn',87000,200,200,'pending',3,29000,200)`, [order,user,plan]);
    let result = (await db.query("select settle_pakasir_payment($1,'txn') as result", [order])).rows[0].result;
    assert.equal(result.creditsAdded, 200);
    assert.equal(result.queued, false);
    assert.equal((await db.query('select * from subscription_periods')).rows.length, 3);
    assert.equal((await db.query('select * from credit_transactions')).rows.length, 1);
    const free='00000000-0000-4000-8000-000000000090';
    await db.query("insert into subscription_plans(id,code,name,monthly_ai_credits,is_active,max_personas) values($1,'free','Free',6,true,1)",[free]);
    await db.query('update subscription_plans set is_active=false where id=$1',[plan]);
    await db.query('insert into persona_configs(user_id) values ($1)',[user]);
    await db.query('insert into persona_configs(user_id) values ($1)',[user]);
    await db.query('insert into scheduled_jobs(user_id) values ($1)',[user]);
    await assert.rejects(db.query('insert into persona_configs(user_id) values ($1)',[user]),/Batas Persona/);
    assert.equal((await db.query("select settle_pakasir_payment($1,'txn') as result", [order])).rows[0].result.duplicate, true);
    const nextOrder = '00000000-0000-4000-8000-000000000004';
    await db.query(`insert into payment_orders(id,user_id,plan_id,order_type,provider,provider_reference,amount_idr,token_amount,credits,status)
      values ($1,$2,$3,'subscription','pakasir','next',29000,100,100,'pending')`, [nextOrder,user,plan]);
    result = (await db.query("select settle_pakasir_payment($1,'next') as result", [nextOrder])).rows[0].result;
    assert.equal(result.queued, true);
    assert.equal(result.creditsAdded, 0);
    // Payment gets cancelled idempotently without granting any subscription.
    const expiredOrder='00000000-0000-4000-8000-000000000099';
    await db.query(`insert into payment_orders(id,user_id,order_type,provider,provider_reference,amount_idr,token_amount,status)
      values($1,$2,'subscription','pakasir','expired',29000,200,'pending')`,[expiredOrder,user]);
    for(let i=0;i<2;i++) {
      assert.equal((await db.query("select mark_expired_pakasir_order_cancelled($1,'expired','provider_expired') result",[expiredOrder])).rows[0].result.status,'cancelled');
    }
    await assert.rejects(db.query("select settle_pakasir_payment($1,'expired')",[expiredOrder]),/cannot be settled/);
    const periods = (await db.query('select * from subscription_periods order by starts_at')).rows;
    assert.equal(new Date(periods[3].starts_at).getTime(), new Date(periods[2].ends_at).getTime());
    await db.query('select reconcile_user_subscription_periods($1,$2)', [user, periods[2].starts_at]);
    assert.equal((await db.query('select * from credit_transactions')).rows.length, 2);
    assert.equal((await db.query("select * from subscription_periods where status='active'")).rows.length, 1);
    await db.query('select reconcile_user_subscription_periods($1,$2)', [user, periods[2].starts_at]);
    assert.equal((await db.query('select * from credit_transactions')).rows.length, 2);
    result = (await db.query("select mark_expired_pakasir_order_cancelled($1,'txn','provider_expired') as result", [order])).rows[0].result;
    assert.equal(result.status, 'paid');
    // Public wrapper cannot grant to a different authenticated user or accept a fake clock.
    await assert.rejects(db.query('select ensure_subscription_current($1)',[user]), /Unauthorized/);
    await db.exec("set request.jwt.claim.role='service_role'");
    await db.query('select ensure_subscription_current($1)',[user]);
    for (const months of [1,6,12]) {
      const u = `00000000-0000-4000-8000-${String(months+100).padStart(12,'0')}`;
      const o = `00000000-0000-4000-8000-${String(months+200).padStart(12,'0')}`;
      await db.query('insert into profiles values ($1)',[u]);
      await db.query(`insert into payment_orders(id,user_id,plan_id,order_type,provider,provider_reference,amount_idr,token_amount,credits,status,duration_months,monthly_price_idr,monthly_credits)
        values($1::uuid,$2,$3,'subscription','pakasir',$1::text,$4,200,200,'pending',$5,29000,200)`,[o,u,plan,29000*months,months]);
      await db.query('select settle_pakasir_payment($1,$2)',[o,o]);
      assert.equal((await db.query('select * from subscription_periods where user_id=$1',[u])).rows.length,months);
    }
    const topup='00000000-0000-4000-8000-000000000005';
    await db.query(`insert into payment_orders(id,user_id,order_type,provider,provider_reference,amount_idr,token_amount,credits,status)
      values($1,$2,'topup','pakasir','topup',15000,100,100,'pending')`,[topup,user]);
    await db.query("select settle_pakasir_payment($1,'topup')",[topup]);
    const topupLot=(await db.query("select * from credit_lots where user_id=$1 and credit_type='topup'",[user])).rows[0];
    assert.equal(topupLot.remaining_credits,100);
    await db.query('select reconcile_user_subscription_periods($1,$2)',[user,periods[3].starts_at]);
    assert.equal((await db.query('select * from credit_lots where id=$1',[topupLot.id])).rows[0].remaining_credits,100);
    // Test the same boundary function used by settlement for leap-year month ends.
    const boundaries=(await db.query("select subscription_month_boundary('2028-01-31T12:00:00Z',n) ends_at from generate_series(1,3) n")).rows;
    assert.deepEqual(boundaries.map(row=>new Date(row.ends_at).toISOString()),['2028-02-29T12:00:00.000Z','2028-03-31T12:00:00.000Z','2028-04-30T12:00:00.000Z']);
    console.log('ok - SQL migration rerun, captured monthly grants, queued coverage, duplicate settlement, delayed activation and paid-safe cancellation');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
