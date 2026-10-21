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
    await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261020120000_subscription_duration_pricing_and_reminders.sql'), 'utf8'));
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
    await db.query(`insert into payment_orders(id,user_id,plan_id,order_type,provider,provider_reference,amount_idr,token_amount,credits,status,monthly_price_idr,monthly_credits)
      values ($1,$2,$3,'subscription','pakasir','next',29000,100,100,'pending',29000,100)`, [nextOrder,user,plan]);
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
    for (const months of [1,3,6,12]) {
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
    const lifecycleFix = fs.readFileSync(require.resolve('../supabase/migrations/20261021130000_subscription_checkout_lifecycle_fixes.sql'), 'utf8');
    await db.query("insert into payment_orders(id,user_id,order_type,provider,status) values('00000000-0000-4000-8000-000000000800',$1,'subscription','pakasir','pending'),('00000000-0000-4000-8000-000000000801',$1,'subscription','pakasir','pending')", [user]);
    await db.exec(lifecycleFix);
    await db.exec(lifecycleFix);
    assert.equal((await db.query("select * from payment_orders where user_id=$1 and status='pending'", [user])).rows.length, 2, 'deploy preserves historical pending orders');
    // Returning to Free changes entitlements without repeatedly granting signup credits.
    await db.exec('create trigger grant_subscription_credit_lot_trigger after insert or update of status,plan_id,current_period_start,payment_reference on user_subscriptions for each row execute function grant_subscription_credit_lot()');
    const finalEnd = periods[3].ends_at;
    await db.query('select reconcile_user_subscription_periods($1,$2)', [user, finalEnd]);
    let active = (await db.query("select * from user_subscriptions where user_id=$1 and status='active'", [user])).rows;
    assert.equal(active.length, 1);
    assert.equal(active[0].plan_id, free, 'expired coverage falls back to Free');
    assert.equal(active[0].ends_at, null);
    const freeLots = (await db.query("select * from credit_lots where user_id=$1 and credit_type='free'", [user])).rows;
    await db.query('select reconcile_user_subscription_periods($1,$2)', [user, finalEnd]);
    assert.equal((await db.query("select * from user_subscriptions where user_id=$1 and status='active'", [user])).rows.length, 1);
    assert.equal((await db.query("select * from credit_lots where user_id=$1 and credit_type='free'", [user])).rows.length, freeLots.length);
    assert.equal((await db.query('select remaining_credits from credit_lots where id=$1', [topupLot.id])).rows[0].remaining_credits, 100);

    // Legacy paid subscriptions also expire through cron, without a prepaid period.
    const legacyUser = '00000000-0000-4000-8000-000000000700';
    await db.query('insert into profiles values ($1)', [legacyUser]);
    await db.query("insert into user_subscriptions(user_id,plan_id,status,started_at,ends_at) values($1,$2,'active',now()-interval '2 months',now()-interval '1 month')", [legacyUser,plan]);
    await db.query('select reconcile_due_subscription_periods(now(),100)');
    active = (await db.query("select * from user_subscriptions where user_id=$1 and status='active'", [legacyUser])).rows;
    assert.equal(active.length, 1);
    assert.equal(active[0].plan_id, free);

    // A returned Free user can buy again; monthly transitions retain paid access.
    const upgradeOrder = '00000000-0000-4000-8000-000000000703';
    await db.query(`insert into payment_orders(id,user_id,plan_id,order_type,provider,provider_reference,amount_idr,token_amount,credits,status,duration_months,monthly_price_idr,monthly_credits)
      values($1,$2,$3,'subscription','pakasir','upgrade',74000,200,200,'pending',3,29000,200)`, [upgradeOrder,legacyUser,plan]);
    await db.query("select settle_pakasir_payment($1,'upgrade')", [upgradeOrder]);
    active = (await db.query("select * from user_subscriptions where user_id=$1 and status='active'", [legacyUser])).rows;
    assert.equal(active.length, 1);
    assert.equal(active[0].plan_id, plan);
    const upgradePeriods = (await db.query('select * from subscription_periods where user_id=$1 order by starts_at', [legacyUser])).rows;
    await db.query('select reconcile_user_subscription_periods($1,$2)', [legacyUser,upgradePeriods[1].starts_at]);
    active = (await db.query("select * from user_subscriptions where user_id=$1 and status='active'", [legacyUser])).rows;
    assert.equal(active.length, 1);
    assert.equal(active[0].plan_id, plan, 'monthly boundary must not switch to Free');
    await db.query('select reconcile_user_subscription_periods($1,$2)', [legacyUser,upgradePeriods[2].ends_at]);
    active = (await db.query("select * from user_subscriptions where user_id=$1 and status='active'", [legacyUser])).rows;
    assert.equal(active.length, 1);
    assert.equal(active[0].plan_id, free);
    assert.equal((await db.query("select * from credit_lots where user_id=$1 and credit_type='free'", [legacyUser])).rows.length, 1, 'repeated downgrades must not refill signup credits');

    // Existing duplicate pending rows must not make deployment destructive or fail.
    // New pending orders and re-opening terminal orders must be serialized in DB.
    const pendingId = '00000000-0000-4000-8000-000000000701';
    const secondId = '00000000-0000-4000-8000-000000000702';
    const pendingSql = "insert into payment_orders(id,user_id,order_type,provider,status) values($1,$2,'subscription','pakasir','pending')";
    await db.query(pendingSql, [pendingId,legacyUser]);
    await assert.rejects(db.query(pendingSql, [secondId,legacyUser]), error => error.code === '23505');
    await db.query("update payment_orders set status='cancelled' where id=$1", [pendingId]);
    await db.query(pendingSql, [secondId,legacyUser]);
    await assert.rejects(db.query("update payment_orders set status='pending' where id=$1", [pendingId]), error => error.code === '23505');

    const queueMigration = fs.readFileSync(require.resolve('../supabase/migrations/20261021140000_queue_subscription_plan_changes.sql'), 'utf8');
    await db.exec(queueMigration);
    const pricingVersion = (await db.query('select version from subscription_pricing_config')).rows[0].version;
    await db.exec(queueMigration);
    const pricingRow = (await db.query('select * from subscription_pricing_config')).rows[0];
    assert.equal(pricingRow.version, pricingVersion, 'migration retries do not increment version again');
    assert.equal(pricingRow.published.plans.creator.prices['1'], 59000, 'migration preserves prices');

    const queueUser = '00000000-0000-4000-8000-000000000900';
    const creatorPlan = '00000000-0000-4000-8000-000000000901';
    const proPlan = '00000000-0000-4000-8000-000000000902';
    const creatorOrder = '00000000-0000-4000-8000-000000000903';
    const proOrder = '00000000-0000-4000-8000-000000000904';
    await db.query('insert into profiles values ($1)', [queueUser]);
    await db.query("insert into subscription_plans(id,code,name,monthly_ai_credits,is_active) values($1,'creator','Creator',600,true),($2,'pro','Pro',1200,true)", [creatorPlan,proPlan]);
    const currentEnd = (await db.query("insert into user_subscriptions(user_id,plan_id,status,started_at,ends_at) values($1,$2,'active',now()-interval '10 days',now()+interval '20 days') returning ends_at", [queueUser,plan])).rows[0].ends_at;
    const insertQueuedOrder = async (id, targetPlan, amount, credits) => db.query(`insert into payment_orders(id,user_id,plan_id,order_type,provider,provider_reference,amount_idr,token_amount,credits,status,duration_months,monthly_price_idr,monthly_credits)
      values($1::uuid,$2,$3,'subscription','pakasir',$1::text,$4,$5::integer,$5::integer,'pending',1,$4,$5::integer)`, [id,queueUser,targetPlan,amount,credits]);
    await insertQueuedOrder(creatorOrder,creatorPlan,59000,600);
    result = (await db.query('select settle_pakasir_payment($1,$2) result', [creatorOrder,creatorOrder])).rows[0].result;
    assert.equal(result.queued, true);
    assert.equal(result.creditsAdded, 0, 'buying an upgrade must not grant its credits early');
    assert.equal(new Date(result.contractStartsAt).getTime(), new Date(currentEnd).getTime());
    const creatorEnd = result.contractEndsAt;
    assert.equal((await db.query("select plan_id from user_subscriptions where user_id=$1 and status='active'", [queueUser])).rows[0].plan_id, plan, 'Starter stays active until its end');
    assert.equal((await db.query("select * from credit_lots where user_id=$1 and credit_type='subscription'", [queueUser])).rows.length, 0);
    assert.equal((await db.query('select settle_pakasir_payment($1,$2) result', [creatorOrder,creatorOrder])).rows[0].result.duplicate, true);

    // A second paid purchase appends after the already-paid Creator period.
    await insertQueuedOrder(proOrder,proPlan,99000,1200);
    result = (await db.query('select settle_pakasir_payment($1,$2) result', [proOrder,proOrder])).rows[0].result;
    assert.equal(result.queued, true);
    assert.equal(new Date(result.contractStartsAt).getTime(), new Date(creatorEnd).getTime());
    const proEnd = result.contractEndsAt;
    await db.query('select reconcile_user_subscription_periods($1,$2)', [queueUser,new Date(new Date(currentEnd).getTime()-1).toISOString()]);
    assert.equal((await db.query("select plan_id from user_subscriptions where user_id=$1 and status='active'", [queueUser])).rows[0].plan_id, plan, 'upgrades must not activate even one millisecond early');
    await db.query('select reconcile_user_subscription_periods($1,$2)', [queueUser,currentEnd]);
    active = (await db.query("select * from user_subscriptions where user_id=$1 and status='active'", [queueUser])).rows;
    assert.equal(active.length, 1);
    assert.equal(active[0].plan_id, creatorPlan);
    assert.equal((await db.query("select original_credits from credit_lots where user_id=$1 and credit_type='subscription'", [queueUser])).rows[0].original_credits, 600);
    await db.query('select reconcile_user_subscription_periods($1,$2)', [queueUser,currentEnd]);
    assert.equal((await db.query("select * from credit_lots where user_id=$1 and credit_type='subscription'", [queueUser])).rows.length, 1);
    await db.query('select reconcile_user_subscription_periods($1,$2)', [queueUser,creatorEnd]);
    active = (await db.query("select * from user_subscriptions where user_id=$1 and status='active'", [queueUser])).rows;
    assert.equal(active.length, 1);
    assert.equal(active[0].plan_id, proPlan);
    const proLot = (await db.query("select * from credit_lots where user_id=$1 and source_reference in (select 'subscription-period:'||id from subscription_periods where user_id=$1 and plan_id=$2)", [queueUser,proPlan])).rows[0];
    assert.equal(proLot.original_credits, 1200, 'Pro credits arrive at the Pro activation boundary');
    await db.query('select reconcile_user_subscription_periods($1,$2)', [queueUser,proEnd]);
    assert.equal((await db.query("select plan_id from user_subscriptions where user_id=$1 and status='active'", [queueUser])).rows[0].plan_id, free);
    assert.equal(pricingRow.published.renewalPolicy, 'queue_after_paid_coverage');
    assert.equal(pricingRow.draft.renewalPolicy, 'queue_after_paid_coverage');
    console.log('ok - SQL migration rerun, captured monthly grants, queued coverage, duplicate settlement, delayed activation, Free fallback and pending-order guard');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
