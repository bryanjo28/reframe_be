const FIELDS = new Set([
  'operation', 'orderId', 'orderType', 'method', 'amountIdr', 'status',
  'providerExpiresAt', 'checkoutAvailable', 'creditsAdded', 'duplicate', 'queued',
  'contractStartsAt', 'contractEndsAt', 'durationMs', 'upstreamStatus',
  'responseValid', 'errorCode', 'httpStatus', 'processed', 'failed',
]);

function paymentLog(event, fields = {}) {
  // Allowlist metadata only: never serialize request bodies, provider responses,
  // QR strings, VA numbers, credentials, or arbitrary exception messages.
  try {
    const entry = { timestamp: new Date().toISOString(), event };
    for (const [key, value] of Object.entries(fields)) {
      if (FIELDS.has(key) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
        || typeof value === 'string' && value.length <= 160)) entry[key] = value;
    }
    const write = event.endsWith('_failed') ? console.error : console.log;
    write(`[payment] ${JSON.stringify(entry)}`);
  } catch { /* Logging must not interrupt payment processing. */ }
}

function paymentErrorFields(error) {
  const code = String(error?.code || 'PAYMENT_ERROR');
  return {
    errorCode: /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : 'PAYMENT_ERROR',
    httpStatus: Number(error?.status) || 500,
    upstreamStatus: Number(error?.upstreamStatus) || undefined,
  };
}

module.exports = { paymentLog, paymentErrorFields };
