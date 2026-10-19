const crypto = require('crypto');
const { pakasir } = require('./pakasirService');
const { getPaymentMethod } = require('../config/paymentMethods');
const { supabaseAdmin, isSupabaseAdminConfigured } = require('../config/supabase');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(message, status = 500, code) { return Object.assign(new Error(message), { status, code }); }

function createPaymentsService({ db, gateway = pakasir, env = process.env } = {}) {
  const database = () => {
    if (db) return db;
    if (!isSupabaseAdminConfigured || !supabaseAdmin) throw fail('Supabase admin belum dikonfigurasi.');
    return supabaseAdmin;
  };
  function validId(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw fail('ID tidak valid.', 400);
  }
  async function loadOrder(id, userId) {
    validId(id);
    let query = database().from('payment_orders').select('*').eq('id', id);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.maybeSingle();
    if (error) throw fail(error.message);
    if (!data || data.provider !== 'pakasir') throw fail('Order tidak ditemukan.', 404);
    return data;
  }
  async function assertPaidPlan(userId) {
    const { getActiveUserSubscription } = require('./subscriptionUsageService');
    const active = await getActiveUserSubscription({ supabase: database(), userId });
    if (!active || active.plan.code === 'free') throw fail('Topup membutuhkan plan berbayar aktif.', 403, 'PAID_PLAN_REQUIRED');
  }
  async function checkout(order) {
    // Reuse the original order after timeout: Pakasir create is idempotent.
    const method = order.payment_method || 'qris';
    getPaymentMethod(method);
    const payment = await gateway.create(order.id, Number(order.amount_idr), method);
    if (typeof payment.txn_id !== 'string' || !payment.txn_id || payment.order_id !== order.id ||
        Number(payment.amount) !== Number(order.amount_idr) || payment.project !== env.PAKASIR_SLUG?.trim() ||
        payment.payment_method !== method ||
        (method === 'qris' ? typeof payment.qr_string !== 'string' || !payment.qr_string.trim() :
          typeof payment.va_number !== 'string' || !payment.va_number.trim())) {
      throw fail('Detail transaksi Pakasir tidak sesuai.', 502, 'PAYMENT_VERIFICATION_FAILED');
    }
    const { error } = await database().from('payment_orders').update({ provider_reference: payment.txn_id, updated_at: new Date().toISOString() }).eq('id', order.id).eq('status', 'pending');
    if (error) throw fail(error.message);
    return { ...order, payment_method: method, provider_reference: payment.txn_id, checkoutAvailable: true,
      checkoutUrl: method === 'qris' ? `https://app.pakasir.com/pay-v2/${encodeURIComponent(payment.txn_id)}?qris_only=1` : null,
      checkoutToken: null, payment, message: 'Lanjutkan pembayaran melalui Pakasir.' };
  }
  async function createOrder(userId, input) {
    gateway.configured();
    const body = typeof input === 'string' ? { packageId: input } : input || {};
    const { packageId, planId } = body;
    const method = getPaymentMethod(body.method);
    if (Boolean(packageId) === Boolean(planId)) throw fail('Isi salah satu packageId atau planId.', 400);
    validId(packageId || planId);
    const subscription = Boolean(planId);
    if (!subscription) await assertPaidPlan(userId);
    const { data: product, error } = await database().from(subscription ? 'subscription_plans' : 'token_packages')
      .select(subscription ? 'id,price,monthly_ai_credits,is_active,code' : 'id,price_idr,token_amount,is_active')
      .eq('id', planId || packageId).maybeSingle();
    if (error) throw fail(error.message);
    if (!product?.is_active || (subscription && product.code === 'free')) throw fail('Paket tidak tersedia.', 404);
    const amount = Number(subscription ? product.price : product.price_idr);
    const credits = Number(subscription ? product.monthly_ai_credits : product.token_amount);
    if (!Number.isSafeInteger(amount) || amount < method.minAmount || amount > method.maxAmount || !Number.isSafeInteger(credits) || credits <= 0) throw fail('Harga atau kredit paket tidak valid untuk metode pembayaran ini.', 400);
    const { data: order, error: insertError } = await database().from('payment_orders').insert({
      id: crypto.randomUUID(), user_id: userId, package_id: packageId || null, plan_id: planId || null,
      order_type: subscription ? 'subscription' : 'topup', amount_idr: amount,
      token_amount: credits, credits, status: 'pending', provider: 'pakasir',
      payment_method: method.code,
    }).select('*').single();
    if (insertError) throw fail(insertError.message);
    try { return await checkout(order); }
    catch (error) {
      // The local order exists even when the provider response times out.
      // Return its ID so the caller can recover without buying a second order.
      return { ...order, checkoutAvailable: false, checkoutUrl: null, checkoutToken: null,
        retryEndpoint: `/api/payments/orders/${order.id}/checkout`,
        message: 'Order tersimpan. Coba kembali checkout menggunakan order yang sama.' };
    }
  }
  async function retryCheckout(userId, id) {
    const order = await loadOrder(id, userId);
    if (order.status !== 'pending') throw fail('Order sudah tidak menunggu pembayaran.', 409);
    return checkout(order);
  }
  async function verify(order, refresh = false) {
    if (order.status === 'paid') return { ...order, duplicate: true, credited: false };
    if (order.status !== 'pending') return { ...order, credited: false };
    if (!order.provider_reference) order = await checkout(order);
    const verified = await gateway.status(order.provider_reference, { refresh });
    if (verified.txn_id !== order.provider_reference || verified.order_id !== order.id ||
        Number(verified.amount) !== Number(order.amount_idr) || typeof verified.is_sandbox !== 'boolean' ||
        (verified.is_sandbox && env.PAKASIR_ALLOW_SANDBOX !== 'true')) {
      throw fail('Verifikasi pembayaran Pakasir gagal.', 502, 'PAYMENT_VERIFICATION_FAILED');
    }
    if (verified.status === 'completed') {
      const { data, error } = await database().rpc('settle_pakasir_payment', { p_order_id: order.id, p_provider_reference: verified.txn_id });
      if (error) throw fail(error.message);
      return { ...data, id: order.id, status: 'paid', credited: !data?.duplicate };
    }
    if (verified.status === 'canceled') {
      const { error } = await database().from('payment_orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', order.id).eq('status', 'pending');
      if (error) throw fail(error.message);
    } else if (verified.status !== 'pending') throw fail('Status Pakasir tidak dikenal.', 502);
    return { id: order.id, status: verified.status === 'canceled' ? 'cancelled' : 'pending', credited: false };
  }
  async function checkOrder(userId, id) { return verify(await loadOrder(id, userId)); }
  async function handlePakasirWebhook(payload, secret) {
    if (env.PAKASIR_WEBHOOK_SECRET) {
      const expected = Buffer.from(env.PAKASIR_WEBHOOK_SECRET);
      const received = Buffer.from(typeof secret === 'string' ? secret : '');
      if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw fail('Webhook secret tidak valid.', 401);
    }
    const order = await loadOrder(payload?.order_id);
    if (payload.txn_id !== order.provider_reference || Number(payload.amount) !== Number(order.amount_idr)) throw fail('Webhook tidak sesuai order.', 400);
    const result = await verify(order, true);
    if (result.status === 'pending') throw fail('Pembayaran belum terverifikasi. Coba kembali.', 503);
    return result;
  }
  return { createOrder, checkOrder, retryCheckout, handlePakasirWebhook };
}
module.exports = { createPaymentsService, ...createPaymentsService() };
