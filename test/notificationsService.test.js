const assert = require('node:assert/strict');
const { buildActivityNotification, notifyActivity, listNotifications, markNotificationRead } = require('../src/services/notificationsService');

async function main() {
  const input = { userId: 'user-1', kind: 'topic', eventKey: 'request-1', successCount: 3 };
  const row = buildActivityNotification(input);
  assert.equal(row.message, '3 topic berhasil dibuat.');
  assert.equal(row.type, 'topic_success');
  assert.equal(buildActivityNotification(input).id, row.id);
  assert.notEqual(buildActivityNotification({ ...input, userId: 'user-2' }).id, row.id);
  assert.equal(buildActivityNotification({ ...input, kind: 'threads', successCount: 2, failedCount: 1 }).type, 'threads_partial');
  assert.match(buildActivityNotification({ ...input, kind: 'threads', scheduled: true }).message, /dijadwalkan/);
  assert.equal(buildActivityNotification({ ...input, kind: 'threads', cancelled: true }).type, 'threads_cancelled');
  let writes = 0;
  const ids = new Set();
  const client = { from(table) {
    assert.equal(table, 'user_notifications');
    return { async insert(payload) {
      if (ids.has(payload.id)) return { error: { code: '23505' } };
      ids.add(payload.id); writes += 1; return { error: null };
    } };
  } };
  assert.equal(await notifyActivity(input, { client }), true);
  assert.equal(await notifyActivity(input, { client }), true);
  assert.equal(writes, 1);
  assert.equal(await notifyActivity(input, { client: null, logger: { error() {} } }), false);
  const filters = [];
  let storedRow = { id: row.id, read_at: null };
  const query = {
    select() { return this; },
    eq(key, value) { filters.push([key, value]); return this; },
    order(key, options) { assert.equal(key, 'created_at'); assert.equal(options.ascending, false); return this; },
    async limit(value) { assert.equal(value, 20); return { data: [], error: null }; },
    update(value) { assert.ok(Date.parse(value.read_at)); return this; },
    async maybeSingle() { return { data: storedRow, error: null }; },
  };
  const db = { from(table) { assert.equal(table, 'user_notifications'); return query; } };
  assert.deepEqual(await listNotifications({ supabase: db, userId: 'user-1' }), { notifications: [] });
  assert.deepEqual(filters.pop(), ['user_id', 'user-1']);
  assert.equal((await markNotificationRead({ supabase: db, userId: 'user-1', id: row.id })).notification.id, row.id);
  assert.deepEqual(filters.splice(0), [['id', row.id], ['user_id', 'user-1']]);
  storedRow = null;
  await assert.rejects(markNotificationRead({ supabase: db, userId: 'user-1', id: row.id }), { status: 404 });
  await assert.rejects(markNotificationRead({ supabase: db, userId: 'user-1', id: 'invalid' }), { status: 400 });
  console.log('ok - activity notifications use existing schema, reflect outcomes, and deduplicate events');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
