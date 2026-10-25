const { createHash, createHmac, randomUUID } = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');
const { redactMessage } = require('./admin/adminErrorLogService');

function enabled(env) {
  return String(env.HERMES_ALERT_ENABLED).toLowerCase() === 'true';
}

function sanitize(value, env) {
  let result = String(value || 'Backend error');
  for (const [key, secret] of Object.entries(env)) {
    if (/TOKEN|SECRET|PASSWORD|KEY/i.test(key) && secret && String(secret).length >= 6) {
      result = result.split(String(secret)).join('[REDACTED]');
    }
  }
  return redactMessage(result).replace(/https?:\/\/\S+/gi, '[URL REDACTED]');
}

async function rpc(db, name, args) {
  const query = db.rpc(name, args);
  const result = await (typeof query.abortSignal === 'function' ? query.abortSignal(AbortSignal.timeout(3000)) : query);
  if (result.error) throw new Error('Alert database operation failed');
  return result.data;
}

// Never propagate reporter failures into application operations.
async function reportError({ source, error, context = {} }, { db = supabaseAdmin, env = process.env } = {}) {
  if (!enabled(env) || !db) return;
  try {
    const safeContext = {};
    for (const key of ['scheduled_job_id', 'content_output_id', 'request_id', 'sequence_number', 'status_code']) {
      const value = context[key];
      if (typeof value === 'number' && Number.isFinite(value)) safeContext[key] = value;
      else if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) safeContext[key] = value;
    }
    const payload = {
      event_id: randomUUID(), event_type: 'production_error', service: 'griv-backend',
      environment: env.NODE_ENV === 'production' ? 'production' : 'development',
      timestamp: new Date().toISOString(), severity: 'error',
      source: /^[a-zA-Z0-9_.-]{1,80}$/.test(source) ? source : 'backend',
      error: { code: /^[a-zA-Z0-9_.:-]{1,100}$/.test(error?.code || '') ? error.code : 'BACKEND_ERROR', message: sanitize(error?.message || error, env) },
      context: safeContext, occurrences: 1,
    };
    const { request_id: ignoredRequestId, ...incidentContext } = safeContext;
    const fingerprint = createHash('sha256').update(JSON.stringify([payload.source, payload.error, incidentContext])).digest('hex');
    await rpc(db, 'enqueue_error_alert', { p_fingerprint: fingerprint, p_payload: payload });
  } catch (_) { console.error('[error-alert] Could not persist alert'); }
}

async function dispatchErrorAlerts({ db = supabaseAdmin, env = process.env, fetchFn = fetch } = {}) {
  if (!enabled(env) || !db || !env.HERMES_ALERT_URL || !env.HERMES_ALERT_SECRET) return;
  try {
    const url = new URL(env.HERMES_ALERT_URL);
    if (url.protocol !== 'https:' || url.username || url.password) return;
    const rows = await rpc(db, 'claim_error_alerts', {});
    for (const row of rows || []) {
      let success = false;
      try {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const body = JSON.stringify(row.payload);
        const signature = createHmac('sha256', env.HERMES_ALERT_SECRET).update(timestamp + '.' + body).digest('hex');
        const response = await fetchFn(url.toString(), {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
          headers: { 'Content-Type': 'application/json', 'X-Griv-Timestamp': timestamp, 'X-Griv-Signature': 'sha256=' + signature }, body,
        });
        success = response.ok;
        await response.body?.cancel();
      } catch (_) { /* Failed sends are rescheduled in the durable outbox. */ }
      await rpc(db, 'finish_error_alert', { p_id: row.id, p_lock_token: row.lock_token, p_success: success });
    }
  } catch (_) { console.error('[error-alert] Could not drain alert queue'); }
}

module.exports = { reportError, dispatchErrorAlerts };
