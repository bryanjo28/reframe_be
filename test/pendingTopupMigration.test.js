const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table payment_orders(id uuid primary key default gen_random_uuid(),user_id uuid not null,order_type text,status text,provider_expires_at timestamptz);
      insert into payment_orders(user_id,order_type,status) values
        ('00000000-0000-4000-8000-000000000001','topup','pending'),
        ('00000000-0000-4000-8000-000000000001','topup','pending');`);
    const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261021150000_limit_pending_topup_orders.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    assert.equal((await db.query('select * from payment_orders')).rows.length, 2, 'existing orders are preserved');
    const insert = "insert into payment_orders(user_id,order_type,status) values($1,$2,'pending') returning id";
    const oldUser = '00000000-0000-4000-8000-000000000001';
    const user = '00000000-0000-4000-8000-000000000002';
    await assert.rejects(db.query(insert, [oldUser,'topup']), error => error.code === '23505');
    await db.query(insert, [user,'subscription']);
    const first = (await db.query(insert, [user,'topup'])).rows[0].id;
    await assert.rejects(db.query(insert, [user,'topup']), error => error.code === '23505');
    await db.query("update payment_orders set status='paid' where id=$1", [first]);
    const second = (await db.query(insert, [user,'topup'])).rows[0].id;
    await assert.rejects(db.query("update payment_orders set status='pending' where id=$1", [first]), error => error.code === '23505');
    await db.query("update payment_orders set status='cancelled' where id=$1", [second]);
    await db.query(insert, [user,'topup']);
    await assert.rejects(db.query("update payment_orders set user_id=$1 where user_id=$2", [user,oldUser]), error => error.code === '23505');
    const expirySql = fs.readFileSync(require.resolve('../supabase/migrations/20261021160000_release_expired_topup_slots.sql'), 'utf8');
    await db.exec(expirySql);
    await db.exec(expirySql);
    const expiryUser = '00000000-0000-4000-8000-000000000003';
    const expired = (await db.query(insert, [expiryUser,'topup'])).rows[0].id;
    await db.query("update payment_orders set provider_expires_at=now()-interval '1 second' where id=$1", [expired]);
    const live = (await db.query(insert, [expiryUser,'topup'])).rows[0].id;
    assert.equal((await db.query('select status from payment_orders where id=$1', [expired])).rows[0].status, 'pending');
    await assert.rejects(db.query(insert, [expiryUser,'topup']), error => error.code === '23505');
    await assert.rejects(db.query("update payment_orders set provider_expires_at=now()+interval '1 hour' where id=$1", [expired]), error => error.code === '23505');
    await assert.rejects(db.query('update payment_orders set provider_expires_at=null where id=$1', [expired]), error => error.code === '23505');
    await db.query("update payment_orders set provider_expires_at=now() where id=$1", [live]);
    await db.query(insert, [expiryUser,'topup']);
    await db.query("update payment_orders set status='paid' where id=$1", [expired]);
    assert.equal((await db.query('select status from payment_orders where id=$1', [expired])).rows[0].status, 'paid', 'late settlement remains possible');
    const capSql = fs.readFileSync(require.resolve('../supabase/migrations/20261021170000_allow_three_pending_topups.sql'), 'utf8');
    await db.exec(capSql);
    await db.exec(capSql);
    const capUser = '00000000-0000-4000-8000-000000000004';
    const capIds = [];
    await db.query(insert, [capUser,'subscription']);
    for (let i=0;i<3;i++) capIds.push((await db.query(insert, [capUser,'topup'])).rows[0].id);
    await assert.rejects(db.query(insert, [capUser,'topup']), error => error.code === '23505');
    await db.query("update payment_orders set provider_expires_at=now() where id=$1", [capIds[0]]);
    await db.query(insert, [capUser,'topup']);
    await assert.rejects(db.query('update payment_orders set provider_expires_at=null where id=$1', [capIds[0]]), error => error.code === '23505');
    await db.query("update payment_orders set status='paid' where id=$1", [capIds[1]]);
    await db.query(insert, [capUser,'topup']);
    await assert.rejects(db.query(insert, [capUser,'topup']), error => error.code === '23505');
    await db.query("update payment_orders set status='cancelled' where id=$1", [capIds[2]]);
    await db.query(insert, [capUser,'topup']);
    await assert.rejects(db.query("update payment_orders set status='pending' where id=$1", [capIds[2]]), error => error.code === '23505');
    console.log('ok - pending topup guard preserves history, allows three payable orders, isolates subscriptions, and releases expired/paid/cancelled slots');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
