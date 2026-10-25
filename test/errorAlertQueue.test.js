const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
async function main() {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const sql = fs.readFileSync(require.resolve('../supabase/hermes_alert_outbox.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const payload = { event_id: '00000000-0000-4000-8000-000000000001', occurrences: 1 };
    const enqueue = () => db.query('select enqueue_error_alert($1,$2::jsonb)', ['same', JSON.stringify(payload)]);
    await enqueue(); await enqueue();
    let rows = (await db.query('select * from error_alert_outbox')).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].payload.occurrences, 2);
    const row = (await db.query('select * from claim_error_alerts()')).rows[0];
    assert.equal(row.attempts, 1);
    assert.equal((await db.query('select * from claim_error_alerts()')).rows.length, 0);
    await db.query('select finish_error_alert($1,$2,true)', [row.id, payload.event_id]);
    assert.equal((await db.query('select status from error_alert_outbox')).rows[0].status, 'sending');
    await db.query('select finish_error_alert($1,$2,false)', [row.id, row.lock_token]);
    rows = (await db.query('select * from error_alert_outbox')).rows;
    assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].bucket, null);
    assert.equal((await db.query('select * from claim_error_alerts()')).rows.length, 0);
    await db.exec("update error_alert_outbox set next_attempt_at=now()-interval '1 minute'");
    const retry = (await db.query('select * from claim_error_alerts()')).rows[0];
    assert.equal(retry.id, row.id); assert.equal(retry.attempts, 2);
    await db.exec("update error_alert_outbox set locked_until=now()-interval '1 minute'");
    const reclaimed = (await db.query('select * from claim_error_alerts()')).rows[0];
    assert.notEqual(reclaimed.lock_token, retry.lock_token);
    await db.exec("update error_alert_outbox set attempts=5,locked_until=now()-interval '1 minute'");
    await db.query('select * from claim_error_alerts()');
    assert.equal((await db.query('select status from error_alert_outbox')).rows[0].status, 'failed');
    payload.event_id = '00000000-0000-4000-8000-000000000002';
    await enqueue();
    const final = (await db.query('select * from claim_error_alerts()')).rows[0];
    await db.query('select finish_error_alert($1,$2,true)', [final.id, final.lock_token]);
    assert.equal((await db.query('select status from error_alert_outbox where id=$1', [final.id])).rows[0].status, 'sent');
    await db.exec('set role authenticated');
    await assert.rejects(enqueue(), /permission denied/);
    await assert.rejects(db.query('select * from error_alert_outbox'), /permission denied/);
    console.log('ok - Hermes SQL deduplication, leases, retry limits and access control');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
