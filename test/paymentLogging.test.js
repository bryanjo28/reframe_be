const assert = require('node:assert/strict');
const { createPakasirClient } = require('../src/services/pakasirService');
const { createPaymentsService } = require('../src/services/pakasirPaymentsService');

async function main() {
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    const id = '00000000-0000-4000-8000-000000000001';
    const expiry = '2099-01-01T00:00:00Z';
    const order = { id, user_id: 'owner', provider: 'pakasir', status: 'pending', amount_idr: 29000, payment_method: 'qris' };
    const db = { from() { return { select() { return this; }, eq() { return this; }, update(row) { Object.assign(order,row); return this; },
      async maybeSingle() { return { data: { ...order } }; }, then(resolve) { resolve({ error: null }); } }; },
      async rpc(name) {
        if (name === 'mark_expired_pakasir_order_cancelled') { order.status='cancelled'; return { data: { status: 'cancelled' } }; }
        order.status='paid'; return { data: { creditsAdded: 200, duplicate: false } };
      } };
    const gateway = { async create() { return { txn_id: 'txn', order_id: id, project: 'shop', amount: 29000,
      payment_method: 'qris', expired_at: expiry, qr_string: 'PRIVATE_QR_PAYLOAD', va_number: 'PRIVATE_VA' }; },
      async status() { return { txn_id: 'txn', order_id: id, amount: 29000, status: 'completed', is_sandbox: false }; } };
    const service = createPaymentsService({ db, gateway, env: { PAKASIR_SLUG: 'shop' } });
    await service.retryCheckout('owner',id);
    await service.checkOrder('owner',id);
    const logged = lines.join('\n');
    assert.match(logged, /checkout_ready/);
    assert.match(logged, /2099-01-01/);
    assert.match(logged, /provider_status/);
    assert.match(logged, /payment_settled/);
    assert.match(logged, /"creditsAdded":200/);
    assert.match(logged, new RegExp(id));
    assert.doesNotMatch(logged, /PRIVATE_QR_PAYLOAD|PRIVATE_VA/);
    order.status = 'pending';
    gateway.status = async () => ({ txn_id: 'txn', order_id: id, amount: 29000, status: 'canceled', is_sandbox: false });
    await service.handlePakasirWebhook({ order_id: id, txn_id: 'txn', amount: 29000, ignoredSecret: 'PRIVATE_WEBHOOK_BODY' }, 'PRIVATE_WEBHOOK_SECRET');
    assert.match(lines.join('\n'), /payment_cancelled/);
    assert.match(lines.join('\n'), /"operation":"webhook"/);

    const client = createPakasirClient({ env: { PAKASIR_SLUG: 'shop', PAKASIR_API_KEY: 'PRIVATE_API_KEY' },
      fetch: async () => ({ ok: false, status: 503, json: async () => { throw Error('PRIVATE_RESPONSE'); } }) });
    await assert.rejects(client.create(id,29000), { status: 502, code: 'PAKASIR_ERROR' });
    const errors = lines.join('\n');
    assert.match(errors, /"upstreamStatus":503/);
    assert.doesNotMatch(errors, /PRIVATE_API_KEY|PRIVATE_RESPONSE|PRIVATE_WEBHOOK_BODY|PRIVATE_WEBHOOK_SECRET/);
    console.log = originalLog;
    console.error = originalError;
    console.log('ok - payment logs correlate checkout expiry, provider status, settlement and upstream errors without secrets');
  } finally { console.log = originalLog; console.error = originalError; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
