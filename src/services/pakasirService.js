const { withRequestTimeout } = require('../utils/requestTimeout');
const { getPaymentMethod } = require('../config/paymentMethods');

function paymentError(message, status = 502, code = 'PAKASIR_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

// Limits apply per Node process. Multi-replica deployments need a shared limiter.
function createPakasirClient({ env = process.env, fetch: fetcher = (...args) => fetch(...args), now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let createQueue = Promise.resolve();
  let nextCreateAt = 0;
  const statuses = new Map();
  function configured() {
    if (!env.PAKASIR_API_KEY?.trim() || !env.PAKASIR_SLUG?.trim()) {
      throw paymentError('Isi PAKASIR_API_KEY dan PAKASIR_SLUG di environment.', 503, 'PAKASIR_NOT_CONFIGURED');
    }
  }
  async function request(path, options = {}) {
    configured();
    return withRequestTimeout(async signal => {
      const response = await fetcher(`https://app.pakasir.com/api/v2/${path}`, {
        ...options, signal,
        headers: { 'X-Api-Key': env.PAKASIR_API_KEY.trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data !== 'object') {
        throw paymentError('Request Pakasir gagal. Silakan coba kembali.', response.status === 429 ? 429 : 502);
      }
      return data;
    });
  }
  function create(orderId, amount, method = 'qris') {
    configured();
    getPaymentMethod(method);
    const job = createQueue.then(async () => {
      if (nextCreateAt > now()) await sleep(nextCreateAt - now());
      nextCreateAt = now() + 510;
      return request(`create-transaction/${encodeURIComponent(env.PAKASIR_SLUG.trim())}/${encodeURIComponent(orderId)}`, {
        method: 'POST', body: JSON.stringify({ method, amount }),
      });
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
  return { configured, create, status };
}

module.exports = { createPakasirClient, pakasir: createPakasirClient() };
