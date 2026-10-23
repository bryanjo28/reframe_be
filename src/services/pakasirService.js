const { withRequestTimeout } = require('../utils/requestTimeout');
const { getPaymentMethod } = require('../config/paymentMethods');
const { paymentLog, paymentErrorFields } = require('../utils/paymentLogger');

function paymentError(message, status = 502, code = 'PAKASIR_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

// Limits apply per Node process. Multi-replica deployments need a shared limiter.
function createPakasirClient({ env = process.env, fetch: fetcher = (...args) => fetch(...args), now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let createQueue = Promise.resolve();
  let nextCreateAt = 0;
  let cancelQueue = Promise.resolve();
  let nextCancelAt = 0;
  const statuses = new Map();
  function configured() {
    if (!env.PAKASIR_API_KEY?.trim() || !env.PAKASIR_SLUG?.trim()) {
      throw paymentError('Isi PAKASIR_API_KEY dan PAKASIR_SLUG di environment.', 503, 'PAKASIR_NOT_CONFIGURED');
    }
  }
  async function request(path, options = {}) {
    configured();
    const operation = path.split('/')[0];
    const startedAt = Date.now();
    paymentLog('gateway_request_started', { operation });
    try { return await withRequestTimeout(async signal => {
      const response = await fetcher(`https://app.pakasir.com/api/v2/${path}`, {
        ...options, signal,
        headers: { 'X-Api-Key': env.PAKASIR_API_KEY.trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const data = await response.json().catch(() => null);
      paymentLog('gateway_response', { operation, upstreamStatus: response.status,
        responseValid: Boolean(data && typeof data === 'object'), durationMs: Date.now() - startedAt });
      if (!response.ok || !data || typeof data !== 'object') {
        throw Object.assign(paymentError('Request Pakasir gagal. Silakan coba kembali.', response.status === 429 ? 429 : 502), { upstreamStatus: response.status });
      }
      return data;
    }); } catch (error) {
      paymentLog('gateway_request_failed', { operation, durationMs: Date.now() - startedAt, ...paymentErrorFields(error) });
      throw error;
    }
  }
  function create(orderId, amount, method = 'qris') {
    configured();
    getPaymentMethod(method);
    const job = createQueue.then(async () => {
      if (nextCreateAt > now()) await sleep(nextCreateAt - now());
      nextCreateAt = now() + 510;
      const payment = await request(`create-transaction/${encodeURIComponent(env.PAKASIR_SLUG.trim())}/${encodeURIComponent(orderId)}`, {
        method: 'POST', body: JSON.stringify({ method, amount }),
      });
      // Live v2 uses expires_at; retain the documented expired_at contract internally.
      return { ...payment, expired_at: payment.expired_at ?? payment.expires_at };
    });
    createQueue = job.catch(() => {});
    return job;
  }
  function status(txnId, { refresh = false } = {}) {
    configured();
    const existing = statuses.get(txnId);
    if (existing?.pending) return existing.promise;
    if (existing && now() < existing.until && !refresh) return existing.promise;
    for (const [key, entry] of statuses) if (!entry.pending && now() >= entry.until) statuses.delete(key);
    const entry = { pending: true, until: Infinity };
    entry.promise = (async () => {
      if (existing && now() < existing.until) await sleep(existing.until - now());
      return request(`transaction-status/${encodeURIComponent(env.PAKASIR_SLUG.trim())}/${encodeURIComponent(txnId)}`, { method: 'GET' });
    })()
      .finally(() => { entry.pending = false; entry.until = now() + 4100; });
    statuses.set(txnId, entry);
    return entry.promise;
  }
  function cancel(txnId) {
    configured();
    const job = cancelQueue.then(async () => {
      if (nextCancelAt > now()) await sleep(nextCancelAt - now());
      nextCancelAt = now() + 510;
      const data = await request(`cancel-transaction/${encodeURIComponent(env.PAKASIR_SLUG.trim())}/${encodeURIComponent(txnId)}`, { method: 'POST' });
      if (typeof data.message !== 'string' || !data.message.trim()) throw paymentError('Respons pembatalan Pakasir tidak valid.');
      // A subsequent status request must observe the cancellation.
      statuses.delete(txnId);
      return data;
    });
    cancelQueue = job.catch(() => {});
    return job;
  }
  return { configured, create, status, cancel };
}

module.exports = { createPakasirClient, pakasir: createPakasirClient() };
