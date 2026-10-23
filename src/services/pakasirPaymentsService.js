const crypto = require('crypto');
const { paymentLog, paymentErrorFields } = require('../utils/paymentLogger');
const { pakasir } = require('./pakasirService');
const { getPaymentMethod } = require('../config/paymentMethods');
const { supabaseAdmin, isSupabaseAdminConfigured } = require('../config/supabase');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(message, status = 500, code) { return Object.assign(new Error(message), { status, code }); }

function createPaymentsService({ db, gateway = pakasir, env = process.env, now = Date.now } = {}) {
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
    paymentLog('checkout_started', { orderId: order.id, method, amountIdr: Number(order.amount_idr) });
    const payment = await gateway.create(order.id, Number(order.amount_idr), method);
    if (typeof payment.txn_id !== 'string' || !payment.txn_id || payment.order_id !== order.id ||
        Number(payment.amount) !== Number(order.amount_idr) || payment.project !== env.PAKASIR_SLUG?.trim() ||
        payment.payment_method !== method || !Number.isFinite(Date.parse(payment.expired_at)) ||
        (method === 'qris' ? typeof payment.qr_string !== 'string' || !payment.qr_string.trim() :
          typeof payment.va_number !== 'string' || !payment.va_number.trim())) {
      throw fail('Detail transaksi Pakasir tidak sesuai.', 502, 'PAYMENT_VERIFICATION_FAILED');
    }
    const instructions = {
      payment_qr_string: method === 'qris' ? payment.qr_string : null,
      payment_va_number: method === 'qris' ? null : payment.va_number,
    };
    const { error } = await database().from('payment_orders').update({
      provider_reference: payment.txn_id, provider_expires_at: payment.expired_at,
      ...instructions, updated_at: new Date().toISOString(),
    }).eq('id', order.id).eq('status', 'pending');
    if (error) throw fail(error.message);
    paymentLog('checkout_ready', { orderId: order.id, method, amountIdr: Number(order.amount_idr),
      providerExpiresAt: payment.expired_at, checkoutAvailable: true });
    return { ...order, durationMonths: order.duration_months, monthlyCredits: order.monthly_credits,
      providerExpiresAt: payment.expired_at, provider_expires_at: payment.expired_at,
      ...instructions, payment_method: method, provider_reference: payment.txn_id, checkoutAvailable: true,
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
    const orderType = subscription ? 'subscription' : 'topup';
    const pendingCode = subscription ? 'PENDING_SUBSCRIPTION_ORDER_EXISTS' : 'PENDING_TOPUP_ORDER_EXISTS';
    const pendingMessage = subscription
      ? 'Masih ada order subscription yang pending. Lanjutkan order tersebut atau tunggu konfirmasi pembatalan Pakasir.'
      : 'Maksimal 3 order top up yang belum kedaluwarsa atau checkout-nya belum selesai. Lanjutkan salah satu order tersebut atau tunggu masa pembayarannya habis.';
    const duration = Object.hasOwn(body, 'durationMonths') ? body.durationMonths : 1;
    if ((subscription && ![1, 3, 12].includes(duration)) || (!subscription && Object.hasOwn(body, 'durationMonths'))) {
      throw fail('Durasi subscription harus 1, 3, atau 12 bulan.', 400, 'INVALID_SUBSCRIPTION_DURATION');
    }
    if (!subscription) await assertPaidPlan(userId);
    let pendingQuery = database().from('payment_orders')
      .select('id').eq('user_id', userId).eq('order_type', orderType).eq('status', 'pending');
    if (!subscription) pendingQuery = pendingQuery.or(`provider_expires_at.is.null,provider_expires_at.gt.${new Date(now()).toISOString()}`);
    const { data: pendingOrders, error: pendingError } = subscription
      ? await pendingQuery.limit(1).maybeSingle()
      : await pendingQuery.limit(3);
    if (pendingError) throw fail('Pending payment order could not be checked.', 503);
    if (subscription ? Boolean(pendingOrders) : (pendingOrders || []).length >= 3) throw fail(pendingMessage, 409, pendingCode);
    const { data: product, error } = await database().from(subscription ? 'subscription_plans' : 'token_packages')
      .select(subscription ? 'id,price,monthly_ai_credits,is_active,code' : 'id,price_idr,token_amount,is_active')
      .eq('id', planId || packageId).maybeSingle();
    if (error) throw fail(error.message);
    if (!product?.is_active || (subscription && product.code === 'free')) throw fail('Paket tidak tersedia.', 404);
    let pricing = null;
    let currentPlan = null;
    if (subscription) {
      const pricingService = require('./subscriptionPricingService').createSubscriptionPricingService({ db: database() });
      pricing = await pricingService.getPublished();
      const configuredPlan = pricing.plans?.[product.code];
      if (!configuredPlan || !pricing.enabledDurations?.includes(duration)) throw fail('Durasi ini sedang tidak tersedia.', 409, 'SUBSCRIPTION_DURATION_UNAVAILABLE');
      const { data: current, error: currentError } = await database().from('user_subscriptions')
        .select('plan_id,ends_at,started_at,status')
        .eq('user_id', userId).eq('status', 'active').lte('started_at', new Date(now()).toISOString())
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (currentError) throw fail('Status langganan tidak dapat diperiksa.', 503);
      if (current?.plan_id) {
        const { data: currentPlanRow, error: planError } = await database().from('subscription_plans').select('code').eq('id', current.plan_id).maybeSingle();
        if (planError || !currentPlanRow) throw fail('Paket aktif tidak dapat diverifikasi.', 503);
        currentPlan = currentPlanRow.code;
      }
      if (current && currentPlan !== 'free' && !current.ends_at) {
        throw fail('Tanggal berakhir paket aktif belum tersedia. Hubungi admin sebelum membeli paket berikutnya.', 409, 'SUBSCRIPTION_END_DATE_REQUIRED');
      }
    }
    const monthlyPrice = Number(subscription ? pricing.plans[product.code].prices['1'] : product.price);
    const amount = subscription ? Number(pricing.plans[product.code].prices[String(duration)]) : Number(product.price_idr);
    const credits = Number(subscription ? pricing.plans[product.code].monthlyAiCredits : product.token_amount);
    if (!Number.isSafeInteger(amount) || amount < method.minAmount || amount > method.maxAmount || !Number.isSafeInteger(credits) || credits <= 0) throw fail('Harga atau kredit paket tidak valid untuk metode pembayaran ini.', 400);
    const { data: order, error: insertError } = await database().from('payment_orders').insert({
      id: crypto.randomUUID(), user_id: userId, package_id: packageId || null, plan_id: planId || null,
      order_type: orderType, amount_idr: amount,
      token_amount: credits, credits, status: 'pending', provider: 'pakasir',
      payment_method: method.code,
      ...(subscription ? { duration_months: duration, monthly_price_idr: monthlyPrice, monthly_credits: credits, pricing_config_version: pricing.version } : {}),
    }).select('*').single();
    if (insertError) {
      const pendingConstraint = subscription ? 'pending_subscription_order_unique' : 'pending_topup_order_unique';
      if (insertError.code === '23505' && `${insertError.message} ${insertError.details || ''}`.includes(pendingConstraint)) {
        throw fail(pendingMessage, 409, pendingCode);
      }
      throw fail(insertError.message);
    }
    paymentLog('order_created', { orderId: order.id, orderType, method: method.code, amountIdr: amount, status: 'pending' });
    try { return await checkout(order); }
    catch (error) {
      paymentLog('checkout_failed', { orderId: order.id, checkoutAvailable: false, ...paymentErrorFields(error) });
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
    if (order.order_type === 'topup' && order.provider_expires_at && Date.parse(order.provider_expires_at) <= now()) {
      throw fail('Waktu pembayaran top up sudah habis. Buat order baru; status pembayaran lama tetap akan diperiksa.', 409, 'TOPUP_PAYMENT_WINDOW_EXPIRED');
    }
    return checkout(order);
  }
  async function verify(order, refresh = false) {
    if (order.status === 'paid') return { ...order, duplicate: true, credited: false };
    if (order.status !== 'pending') return { ...order, credited: false };
    if (!order.provider_reference) order = await checkout(order);
    const due = order.provider_expires_at && Date.parse(order.provider_expires_at) <= now();
    const verified = await gateway.status(order.provider_reference, { refresh: refresh || Boolean(due) });
    if (verified.txn_id !== order.provider_reference || verified.order_id !== order.id ||
        Number(verified.amount) !== Number(order.amount_idr) || typeof verified.is_sandbox !== 'boolean' ||
        (verified.is_sandbox && env.PAKASIR_ALLOW_SANDBOX !== 'true')) {
      throw fail('Verifikasi pembayaran Pakasir gagal.', 502, 'PAYMENT_VERIFICATION_FAILED');
    }
    paymentLog('provider_status', { orderId: order.id,
      status: ['pending', 'completed', 'canceled'].includes(verified.status) ? verified.status : 'unknown',
      providerExpiresAt: order.provider_expires_at });
    if (verified.status === 'completed') {
      const { data, error } = await database().rpc('settle_pakasir_payment', { p_order_id: order.id, p_provider_reference: verified.txn_id });
      if (error) throw fail(error.message);
      paymentLog('payment_settled', { orderId: order.id, status: 'paid', creditsAdded: Number(data?.creditsAdded || 0),
        duplicate: Boolean(data?.duplicate), queued: Boolean(data?.queued),
        contractStartsAt: data?.contractStartsAt, contractEndsAt: data?.contractEndsAt });
      return { ...data, id: order.id, status: 'paid', credited: !data?.duplicate && Number(data?.creditsAdded || 0) > 0 };
    }
    // Expiry controls the payment UI and polling freshness. Only Pakasir's
    // confirmed status may settle or cancel the local order.
    if (verified.status === 'canceled') {
      const { data, error } = await database().rpc('mark_expired_pakasir_order_cancelled', {
        p_order_id: order.id, p_provider_reference: order.provider_reference,
        p_reason: 'provider_cancelled',
      });
      if (error) throw fail(error.message);
      paymentLog('payment_cancelled', { orderId: order.id, status: data?.status });
      return { ...data, id: order.id, credited: false, providerExpiresAt: order.provider_expires_at };
    } else if (verified.status !== 'pending') throw fail('Status Pakasir tidak dikenal.', 502);
    const method = order.payment_method || 'qris';
    const qris = method === 'qris';
    return { id: order.id, status: 'pending', credited: false,
      providerExpiresAt: order.provider_expires_at || null, payment_method: method,
      checkoutUrl: qris ? `https://app.pakasir.com/pay-v2/${encodeURIComponent(order.provider_reference)}?qris_only=1` : null,
      payment: {
        txn_id: order.provider_reference, payment_method: method, amount: Number(order.amount_idr),
        expired_at: order.provider_expires_at || null,
        qr_string: qris ? order.payment_qr_string || null : null,
        va_number: qris ? null : order.payment_va_number || null,
      },
    };
  }
  async function reconcileExpiredPayments({ limit = 100 } = {}) {
    const nowIso = new Date(now()).toISOString();
    const retryBefore = new Date(now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await database().from('payment_orders').select('*')
      .eq('provider', 'pakasir').eq('status', 'pending')
      .or(`provider_expires_at.lte.${nowIso},and(provider_expires_at.is.null,created_at.lte.${retryBefore})`)
      .order('updated_at', { ascending: true, nullsFirst: true }).order('created_at')
      .limit(Math.min(100, Math.max(1, limit)));
    if (error) throw fail(error.message);
    const summary = { processed: 0, failed: 0 };
    for (const order of data || []) {
      let failed = false;
      // Re-create with the original ID after an ambiguous gateway timeout; never
      // cancel an unverified transaction that might already have been paid.
      try {
        const recoverableOrder = order.provider_expires_at ? order : await checkout(order);
        await verify(recoverableOrder, true);
      }
      catch (error) { failed = true; paymentLog('reconcile_order_failed', { orderId: order.id, ...paymentErrorFields(error) }); }
      // Rotate attempted pending orders, including provider failures, so a full
      // batch of unresolved payments cannot starve later orders on every run.
      try {
        const { error: attemptError } = await database().from('payment_orders')
          .update({ updated_at: new Date(now()).toISOString() }).eq('id', order.id).eq('status', 'pending');
        if (attemptError) failed = true;
      } catch { failed = true; }
      if (failed) summary.failed++;
      else summary.processed++;
    }
    if ((data || []).length) paymentLog('reconcile_finished', summary);
    return summary;
  }
  async function checkOrder(userId, id) {
    const result = await verify(await loadOrder(id, userId));
    // Terminal reads may contain the full database row; never offer stale payment instructions.
    const { payment_qr_string, payment_va_number, ...detail } = result;
    return detail.status === 'pending' ? detail : { ...detail, checkoutUrl: null, payment: null };
  }
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
  function loggedOperation(operation, handler, orderIdFromArgs) {
    return async (...args) => {
      const candidate = orderIdFromArgs?.(args);
      const context = typeof candidate === 'string' && UUID.test(candidate) ? { orderId: candidate } : {};
      const startedAt = Date.now();
      paymentLog('operation_started', { operation, ...context });
      try {
        const result = await handler(...args);
        paymentLog('operation_finished', { operation, ...context, orderId: result?.id || context.orderId,
          status: result?.status, checkoutAvailable: result?.checkoutAvailable, durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        paymentLog('operation_failed', { operation, ...context, durationMs: Date.now() - startedAt, ...paymentErrorFields(error) });
        throw error;
      }
    };
  }
  return {
    createOrder: loggedOperation('create_order', createOrder),
    checkOrder: loggedOperation('check_order', checkOrder, args => args[1]),
    retryCheckout: loggedOperation('retry_checkout', retryCheckout, args => args[1]),
    handlePakasirWebhook: loggedOperation('webhook', handlePakasirWebhook, args => args[0]?.order_id),
    reconcileExpiredPayments,
  };
}
module.exports = { createPaymentsService, ...createPaymentsService() };
