const crypto = require('crypto');
const { isSupabaseAdminConfigured, supabaseAdmin } = require('../config/supabase');

const CODE_PATTERN = /^[A-Z0-9]{8,16}$/;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function httpError(message, status = 500, code = 'REFERRAL_STORAGE_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

function maskName(profile) {
  return profile?.full_name || profile?.account_name || 'Teman Alurin';
}

async function insertAudit(db, values) {
  const { error } = await db.from('admin_audit_logs').insert(values);
  if (error) throw httpError('Referral change was saved, but its audit log could not be written. Contact an administrator.', 503, 'REFERRAL_AUDIT_LOG_FAILED');
}

function createReferralService({ db, secret, now = Date.now, frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173' } = {}) {
  const database = () => {
    if (db) return db;
    if (!isSupabaseAdminConfigured || !supabaseAdmin) throw httpError('Referral data is not configured', 503, 'REFERRAL_STORAGE_UNAVAILABLE');
    return supabaseAdmin;
  };
  const signingSecret = () => secret || process.env.REFERRAL_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  function sign(value) {
    const key = signingSecret();
    if (!key) throw httpError('Referral validation is not configured', 503, 'REFERRAL_SIGNING_UNAVAILABLE');
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    const signature = crypto.createHmac('sha256', key).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  function verifyToken(token) {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const [payload, suppliedSignature, extra] = token.split('.');
    const key = signingSecret();
    if (!payload || !suppliedSignature || extra || !key) return null;
    const expected = crypto.createHmac('sha256', key).update(payload).digest();
    let received;
    try { received = Buffer.from(suppliedSignature, 'base64url'); } catch { return null; }
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!value?.codeId || !value?.referrerId || !CODE_PATTERN.test(value.code || '') || !Number.isFinite(value.expiresAt) || value.expiresAt <= now()) return null;
      return value;
    } catch { return null; }
  }

  async function getConfig() {
    const { data, error } = await database().from('referral_program_config').select('*').eq('singleton', true).maybeSingle();
    if (error) throw httpError('Referral settings could not be loaded', 503);
    if (!data) throw httpError('Referral database migration is required', 503, 'REFERRAL_SETUP_REQUIRED');
    return data;
  }

  async function ensureCode(userId) {
    const dbClient = database();
    const { data: existing, error } = await dbClient.from('referral_codes').select('id,code').eq('user_id', userId).maybeSingle();
    if (error) throw httpError('Referral code could not be loaded', 503);
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = crypto.randomBytes(6).toString('hex').toUpperCase();
      const { data, error: insertError } = await dbClient.from('referral_codes').insert({ user_id: userId, code }).select('id,code').single();
      if (!insertError) return data;
      if (insertError.code === '23505') {
        const { data: raced } = await dbClient.from('referral_codes').select('id,code').eq('user_id', userId).maybeSingle();
        if (raced) return raced;
        continue;
      }
      throw httpError('Referral code could not be created', 503);
    }
    throw httpError('Could not create a unique referral code', 503);
  }

  async function validateCode(rawCode, { userId = null, trackClick = false } = {}) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) return { valid: false, code: null };
    const config = await getConfig();
    if (!config.enabled || !config.visible) return { valid: false, code: null, disabled: true };
    const { data: referralCode, error } = await database().from('referral_codes').select('id,user_id,code').eq('code', code).maybeSingle();
    if (error) throw httpError('Referral code could not be checked', 503);
    if (!referralCode || (userId && userId === referralCode.user_id)) return { valid: false, code: null };
    if (trackClick) {
      const { error: clickError } = await database().from('referral_clicks').insert({ referral_code_id: referralCode.id });
      if (clickError) throw httpError('Referral link could not be recorded', 503);
    }
    const nowMs = now();
    const referralToken = sign({ codeId: referralCode.id, code: referralCode.code, referrerId: referralCode.user_id,
      issuedAt: nowMs, expiresAt: nowMs + Number(config.attribution_window_days || 30) * 86400000 });
    return { valid: true, code: referralCode.code, referralToken, expiresAt: new Date(nowMs + Number(config.attribution_window_days || 30) * 86400000).toISOString(),
      referrerBonusCredits: config.referrer_bonus_credits, referredBonusCredits: config.referred_bonus_credits,
      attributionWindowDays: config.attribution_window_days };
  }

  async function createAttribution({ userId, token }) {
    const decoded = verifyToken(token);
    if (!decoded || decoded.referrerId === userId) return { attributed: false };
    const dbClient = database();
    const { data: codeRow, error: codeError } = await dbClient.from('referral_codes').select('id,user_id,code').eq('id', decoded.codeId).maybeSingle();
    if (codeError) throw httpError('Referral attribution could not be checked', 503);
    if (!codeRow || codeRow.user_id !== decoded.referrerId || codeRow.code !== decoded.code) return { attributed: false };
    const { data, error } = await dbClient.from('referral_attributions').insert({
      referrer_user_id: decoded.referrerId, referred_user_id: userId, referral_code_id: codeRow.id,
    }).select('id').maybeSingle();
    if (error?.code === '23505') return { attributed: false, existing: true };
    if (error) throw httpError('Referral attribution could not be saved', 503);
    return { attributed: Boolean(data?.id), id: data?.id || null };
  }

  async function getUserDashboard(userId) {
    const dbClient = database();
    const [code, config, attributionsResult, grantsResult] = await Promise.all([
      ensureCode(userId), getConfig(),
      dbClient.from('referral_attributions').select('id,referred_user_id,status,created_at').eq('referrer_user_id', userId).order('created_at', { ascending: false }).limit(500),
      dbClient.from('credit_transactions').select('credits_delta').eq('user_id', userId).eq('source_type', 'referral_reward'),
    ]);
    if (attributionsResult.error || grantsResult.error) throw httpError('Referral history could not be loaded', 503);
    const attributions = attributionsResult.data || [];
    const ids = attributions.map(row => row.referred_user_id);
    const attributionIds = attributions.map(row => row.id);
    const [{ data: profiles, error: profilesError }, { data: rewards, error: rewardsError }, { count: clicks, error: clicksError }] = await Promise.all([
      ids.length ? dbClient.from('profiles').select('id,full_name,account_name').in('id', ids) : Promise.resolve({ data: [], error: null }),
      attributionIds.length ? dbClient.from('referral_rewards').select('id,attribution_id,plan_code,payment_amount_idr,referrer_bonus_credits,referred_bonus_credits,status,validation_due_at,granted_at').in('attribution_id', attributionIds) : Promise.resolve({ data: [], error: null }),
      dbClient.from('referral_clicks').select('id', { count: 'exact', head: true }).eq('referral_code_id', code.id),
    ]);
    if (profilesError || rewardsError || clicksError) throw httpError('Referral history could not be loaded', 503);
    const profileById = new Map((profiles || []).map(row => [row.id, row]));
    const rewardByAttribution = new Map((rewards || []).map(row => [row.attribution_id, row]));
    const items = attributions.map(row => {
      const reward = rewardByAttribution.get(row.id);
      return { id: row.id, friend: maskName(profileById.get(row.referred_user_id)), status: reward?.status || row.status,
        createdAt: row.created_at, planCode: reward?.plan_code || null, paymentAmountIdr: reward?.payment_amount_idr ?? null,
        bonusCredits: reward ? reward.referrer_bonus_credits : null, grantedAt: reward?.granted_at || null,
        validationDueAt: reward?.validation_due_at || null };
    });
    return { referralCode: code.code, referralUrl: `${frontendUrl.replace(/\/$/, '')}/ref/${code.code}`,
      config: { enabled: config.enabled, visible: config.visible, referrerBonusCredits: config.referrer_bonus_credits,
        referredBonusCredits: config.referred_bonus_credits, attributionWindowDays: config.attribution_window_days,
        validationDays: config.validation_days, rewardExpirationDays: config.reward_expiration_days },
      stats: { clicks: clicks || 0, totalRegistrations: attributions.length,
        awaitingPayment: attributions.filter(row => ['registered','awaiting_payment'].includes(row.status)).length,
        pendingValidation: attributions.filter(row => row.status === 'pending_validation').length,
        successfulReferrals: attributions.filter(row => row.status === 'rewarded').length,
        bonusCreditsEarned: (grantsResult.data || []).reduce((sum, row) => sum + Math.max(0, Number(row.credits_delta || 0)), 0) },
      referrals: items };
  }

  async function getAdminDashboard({ query = '', status = '', page = 1, limit = 25, from: dateFrom = '', to: dateTo = '' } = {}) {
    const dbClient = database();
    const safePage = Math.max(1, Math.min(100000, Number(page) || 1));
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    const from = (safePage - 1) * safeLimit;
    const to = from + safeLimit - 1;
    let matchingProfileIds = [];
    let matchingCodeIds = [];
    const search = String(query).trim().slice(0, 100).replace(/[%,_()]/g, ' ');
    if (search) {
      const [{ data: matches, error: profileSearchError }, { data: codeMatches, error: codeSearchError }] = await Promise.all([
        dbClient.from('profiles').select('id').or('full_name.ilike.%' + search + '%,account_name.ilike.%' + search + '%').limit(500),
        dbClient.from('referral_codes').select('id').ilike('code', '%' + search.toUpperCase() + '%').limit(500),
      ]);
      if (profileSearchError || codeSearchError) throw httpError('Admin referral search could not be completed', 503);
      matchingProfileIds = (matches || []).map(row => row.id);
      matchingCodeIds = (codeMatches || []).map(row => row.id);
    }
    let listQuery = dbClient.from('referral_attributions').select('id,referrer_user_id,referred_user_id,referral_code_id,status,created_at', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
    if (status) listQuery = listQuery.eq('status', status);
    if (dateFrom && Number.isFinite(Date.parse(dateFrom))) listQuery = listQuery.gte('created_at', new Date(dateFrom).toISOString());
    if (dateTo && Number.isFinite(Date.parse(dateTo))) listQuery = listQuery.lt('created_at', new Date(dateTo).toISOString());
    if (search) {
      const searchParts = [];
      if (matchingProfileIds.length) searchParts.push('referrer_user_id.in.(' + matchingProfileIds.join(',') + '),referred_user_id.in.(' + matchingProfileIds.join(',') + ')');
      if (matchingCodeIds.length) searchParts.push('referral_code_id.in.(' + matchingCodeIds.join(',') + ')');
      if (/^[0-9a-f-]{36}$/i.test(search)) searchParts.push('id.eq.' + search);
      if (searchParts.length) listQuery = listQuery.or(searchParts.join(','));
      else listQuery = listQuery.eq('id', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    }
    const [config, attributionsResult, clickCount, totalCount, pendingCount, rejectedCount, rewardedCount, grantsResult, paidReferredResult] = await Promise.all([
      getConfig(), listQuery,
      dbClient.from('referral_clicks').select('id', { count: 'exact', head: true }),
      dbClient.from('referral_attributions').select('id', { count: 'exact', head: true }),
      dbClient.from('referral_attributions').select('id', { count: 'exact', head: true }).eq('status', 'pending_validation'),
      dbClient.from('referral_attributions').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      dbClient.from('referral_rewards').select('id', { count: 'exact', head: true }).eq('status', 'rewarded'),
      dbClient.from('referral_credit_grants').select('credits'),
      dbClient.from('referral_rewards').select('payment_amount_idr').eq('status', 'rewarded'),
    ]);
    for (const result of [attributionsResult, clickCount, totalCount, pendingCount, rejectedCount, rewardedCount, grantsResult, paidReferredResult]) {
      if (result.error) throw httpError('Admin referral data could not be loaded', 503);
    }
    const rows = attributionsResult.data || [];
    const userIds = [...new Set(rows.flatMap(row => [row.referrer_user_id, row.referred_user_id]))];
    const codeIds = [...new Set(rows.map(row => row.referral_code_id))];
    const attributionIds = rows.map(row => row.id);
    const [{ data: profiles, error: profilesError }, { data: codes, error: codesError }, { data: rewards, error: rewardsError }, { data: payments, error: paymentsError }] = await Promise.all([
      userIds.length ? dbClient.from('profiles').select('id,full_name,account_name').in('id', userIds) : Promise.resolve({ data: [], error: null }),
      codeIds.length ? dbClient.from('referral_codes').select('id,code').in('id', codeIds) : Promise.resolve({ data: [], error: null }),
      attributionIds.length ? dbClient.from('referral_rewards').select('attribution_id,payment_order_id,plan_code,payment_amount_idr,status,referrer_bonus_credits,referred_bonus_credits,granted_at,review_required').in('attribution_id', attributionIds) : Promise.resolve({ data: [], error: null }),
      rows.length ? dbClient.from('payment_orders').select('id,user_id,plan_id,status,amount_idr,paid_at,created_at').eq('order_type','subscription').in('user_id', [...new Set(rows.map(row => row.referred_user_id))]).order('created_at',{ascending:true}) : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesError || codesError || rewardsError || paymentsError) throw httpError('Admin referral data could not be loaded', 503);
    const profileMap = new Map((profiles || []).map(row => [row.id, row]));
    const codeMap = new Map((codes || []).map(row => [row.id, row.code]));
    const rewardMap = new Map((rewards || []).map(row => [row.attribution_id, row]));
    const paymentByUser = new Map();
    for (const payment of payments || []) {
      if (!paymentByUser.has(payment.user_id) || payment.status === 'paid') paymentByUser.set(payment.user_id, payment);
    }
    let items = rows.map(row => {
      const reward = rewardMap.get(row.id);
      const referrer = profileMap.get(row.referrer_user_id);
      const referred = profileMap.get(row.referred_user_id);
      const payment = paymentByUser.get(row.referred_user_id);
      return { id: row.id, referrerUserId: row.referrer_user_id, referrer: maskName(referrer),
        referredUserId: row.referred_user_id, referred: maskName(referred),
        referralCode: codeMap.get(row.referral_code_id) || '—', registeredAt: row.created_at,
        subscriptionPlan: reward?.plan_code || '—', paymentStatus: payment?.status || 'not_paid', paymentOrderId: reward?.payment_order_id || payment?.id || null,
        paymentAmountIdr: reward?.payment_amount_idr ?? payment?.amount_idr ?? null, rewardStatus: reward?.status || row.status,
        rewardCredits: reward ? { referrer: reward.referrer_bonus_credits, referred: reward.referred_bonus_credits } : null,
        grantedAt: reward?.granted_at || null, reviewRequired: Boolean(reward?.review_required) };
    });
    const grantedCredits = (grantsResult.data || []).reduce((sum, row) => sum + Number(row.credits || 0), 0);
    const referredRevenue = (paidReferredResult.data || []).reduce((sum, row) => sum + Number(row.payment_amount_idr || 0), 0);
    const clickTotal = clickCount.count || 0;
    const registrationTotal = totalCount.count || 0;
    return { config: { enabled: config.enabled, visible: config.visible, referrerBonusCredits: config.referrer_bonus_credits,
        referredBonusCredits: config.referred_bonus_credits, attributionWindowDays: config.attribution_window_days,
        validationDays: config.validation_days, rewardExpirationDays: config.reward_expiration_days,
        eligiblePlanCodes: config.eligible_plan_codes },
      metrics: { referralClicks: clickTotal, registrations: registrationTotal, successful: rewardedCount.count || 0,
        pending: pendingCount.count || 0, rejected: rejectedCount.count || 0, rewardCreditsGranted: grantedCredits,
        estimatedRewardCostIdr: grantedCredits * 50, referredRevenueIdr: referredRevenue,
        conversionRate: clickTotal ? Math.round(registrationTotal / clickTotal * 10000) / 100 : 0 },
      items, total: attributionsResult.count || 0, page: safePage, limit: safeLimit };
  }

  async function updateConfig(input, adminUserId) {
    const validPlans = ['starter', 'creator', 'pro'];
    const plans = Array.isArray(input.eligiblePlanCodes) ? [...new Set(input.eligiblePlanCodes.map(value => String(value).trim().toLowerCase()))] : null;
    if (plans && (plans.some(plan => !validPlans.includes(plan)) || plans.length === 0)) throw httpError('Eligible plans must include one or more paid plans', 400, 'REFERRAL_INVALID_CONFIG');
    const current = await getConfig();
    const next = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      visible: typeof input.visible === 'boolean' ? input.visible : current.visible,
      referrer_bonus_credits: input.referrerBonusCredits === undefined ? current.referrer_bonus_credits : Number(input.referrerBonusCredits),
      referred_bonus_credits: input.referredBonusCredits === undefined ? current.referred_bonus_credits : Number(input.referredBonusCredits),
      attribution_window_days: input.attributionWindowDays === undefined ? current.attribution_window_days : Number(input.attributionWindowDays),
      validation_days: input.validationDays === undefined ? current.validation_days : Number(input.validationDays),
      reward_expiration_days: input.rewardExpirationDays === undefined ? current.reward_expiration_days : Number(input.rewardExpirationDays),
      eligible_plan_codes: plans || current.eligible_plan_codes,
      updated_by: adminUserId, updated_at: new Date(now()).toISOString(),
    };
    if (![next.referrer_bonus_credits, next.referred_bonus_credits].every(value => Number.isInteger(value) && value >= 0 && value <= 100000) ||
      ![next.attribution_window_days, next.validation_days, next.reward_expiration_days].every(value => Number.isInteger(value) && value >= 1 && value <= 365)) {
      throw httpError('Referral settings are outside allowed limits', 400, 'REFERRAL_INVALID_CONFIG');
    }
    const { data, error } = await database().from('referral_program_config').update(next).eq('singleton', true).select('*').single();
    if (error) throw httpError('Referral settings could not be saved', 503);
    await insertAudit(database(), { admin_user_id: adminUserId, action: 'referral.settings.update', target_type: 'referral_program_config', target_id: 'default', previous_values: current, new_values: next, reason: 'Updated referral program settings.' });
    return data;
  }

  async function rejectReward(attributionId, adminUserId, reason) {
    const normalizedReason = String(reason || '').trim().slice(0, 500);
    if (normalizedReason.length < 5) throw httpError('A rejection reason is required', 400, 'REFERRAL_REJECTION_REASON_REQUIRED');
    const dbClient = database();
    const [{ data: attribution, error: attributionError }, { data: reward, error: rewardError }] = await Promise.all([
      dbClient.from('referral_attributions').select('id,status').eq('id', attributionId).maybeSingle(),
      dbClient.from('referral_rewards').select('id,attribution_id,status').eq('attribution_id', attributionId).maybeSingle(),
    ]);
    if (attributionError || rewardError) throw httpError('Referral could not be loaded', 503);
    if (!attribution) throw httpError('Referral not found', 404, 'REFERRAL_NOT_FOUND');
    if (!['registered','awaiting_payment','pending_validation'].includes(attribution.status) || (reward && reward.status !== 'pending_validation')) {
      throw httpError('Only an unpaid or pending referral can be rejected', 409, 'REFERRAL_NOT_PENDING');
    }
    if (reward) {
      const { error } = await dbClient.from('referral_rewards').update({ status: 'rejected', decided_by: adminUserId, decision_reason: normalizedReason, updated_at: new Date(now()).toISOString() }).eq('id', reward.id).eq('status', 'pending_validation');
      if (error) throw httpError('Referral reward could not be rejected', 503);
    }
    const { error: attributionUpdateError } = await dbClient.from('referral_attributions').update({ status: 'rejected', updated_at: new Date(now()).toISOString() }).eq('id', attribution.id).in('status', ['registered','awaiting_payment','pending_validation']);
    if (attributionUpdateError) throw httpError('Referral could not be rejected', 503);
    const { error: eventError } = await dbClient.from('referral_events').insert({ attribution_id: attribution.id, reward_id: reward?.id || null, actor_user_id: adminUserId, event_type: 'admin_rejected', detail: { reason: normalizedReason } });
    if (eventError) throw httpError('Referral was rejected, but the event could not be recorded.', 503, 'REFERRAL_EVENT_LOG_FAILED');
    await insertAudit(dbClient, { admin_user_id: adminUserId, action: 'referral.reward.reject', target_type: 'referral_attribution', target_id: attribution.id, previous_values: { status: attribution.status }, new_values: { status: 'rejected' }, reason: normalizedReason });
    return { id: attribution.id, rewardId: reward?.id || null, status: 'rejected' };
  }

  async function processDueRewards(adminUserId) {
    const { data, error } = await database().rpc('process_due_referral_rewards', { p_limit: 100 });
    if (error) throw httpError('Pending referral rewards could not be processed', 503);
    await insertAudit(database(), { admin_user_id: adminUserId, action: 'referral.reward.process_due', target_type: 'referral_reward_batch', target_id: null, new_values: { processed: Number(data || 0) }, reason: 'Manually retried due referral rewards.' });
    return { processed: Number(data || 0) };
  }

  async function recordClick(rawCode) { return validateCode(rawCode, { trackClick: true }); }

  return { createAttribution, getAdminDashboard, getConfig, getUserDashboard, processDueRewards, recordClick, rejectReward, ensureCode, updateConfig, validateCode };
}

module.exports = { CODE_PATTERN, createReferralService };
