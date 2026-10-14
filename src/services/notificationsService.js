const { createHash } = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');

function notificationId(userId, type, eventKey) {
  const hex = createHash('sha256').update(JSON.stringify([userId, type, eventKey])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function buildActivityNotification({ userId, kind, eventKey, successCount = 0, failedCount = 0, scheduled = false, cancelled = false }) {
  const labels = { topic: 'topic', content: 'konten', threads: 'konten ke Threads' };
  if (!labels[kind] || !userId || !eventKey) throw new Error('Invalid activity notification');
  const status = scheduled ? 'scheduled' : cancelled ? 'cancelled' : failedCount ? (successCount ? 'partial' : 'failed') : 'success';
  const verb = kind === 'threads' ? 'diposting' : 'dibuat';
  const title = scheduled ? (kind === 'threads' ? 'Auto-post Threads dijadwalkan' : 'Generate konten dijadwalkan')
    : cancelled ? 'Auto-post Threads dibatalkan'
    : kind === 'threads' ? 'Hasil posting Threads' : kind === 'topic' ? 'Hasil generate topic' : 'Hasil generate konten';
  const message = scheduled ? `${successCount} ${labels[kind]} berhasil dijadwalkan.${failedCount ? ` ${failedCount} gagal dijadwalkan.` : ''}`
    : cancelled ? `Auto-post dibatalkan. ${successCount} konten berhasil diposting ke Threads sebelum pembatalan; ${failedCount} gagal.`
    : `${successCount} ${labels[kind]} berhasil ${verb}.${failedCount ? ` ${failedCount} gagal.` : ''}`;
  const type = `${kind}_${status}`;
  return { id: notificationId(userId, type, eventKey), user_id: userId, type, title, message };
}

async function notifyActivity(input, { client = supabaseAdmin, logger = console } = {}) {
  try {
    const row = buildActivityNotification(input);
    if (!client) throw new Error('Supabase admin client unavailable');
    const { error } = await client.from('user_notifications').insert(row);
    // Stable primary key makes repeated delivery of the same event idempotent.
    if (error && error.code !== '23505') throw error;
    return true;
  } catch (error) {
    // Notification failure must not turn saved content/published posts into a failed operation.
    logger.error('[notifications] Activity notification not saved', { kind: input.kind, code: error.code || 'NOTIFICATION_WRITE_FAILED' });
    return false;
  }
}

const NOTIFICATION_FIELDS = 'id,type,title,message,read_at,created_at';

function httpError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

async function listNotifications({ supabase, userId }) {
  const { data, error } = await supabase.from('user_notifications')
    .select(NOTIFICATION_FIELDS).eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(10);
  if (error) throw httpError('Gagal mengambil notifikasi.', 500, 'NOTIFICATIONS_FETCH_FAILED');
  return { notifications: data || [] };
}

async function markNotificationRead({ supabase, userId, id }) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw httpError('ID notifikasi tidak valid.', 400, 'VALIDATION_ERROR');
  }
  const { data, error } = await supabase.from('user_notifications')
    .update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
    .select(NOTIFICATION_FIELDS).maybeSingle();
  if (error) throw httpError('Gagal memperbarui notifikasi.', 500, 'NOTIFICATION_UPDATE_FAILED');
  if (!data) throw httpError('Notifikasi tidak ditemukan.', 404, 'NOTIFICATION_NOT_FOUND');
  return { notification: data };
}

module.exports = { buildActivityNotification, notifyActivity, listNotifications, markNotificationRead };
