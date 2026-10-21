const { createReferralService } = require('../services/referralService');

const referrals = createReferralService();

function publicConfig(req, res, next) {
  referrals.getConfig().then(config => res.json({ success: true, data: {
    enabled: config.enabled, visible: config.visible,
    referrerBonusCredits: config.referrer_bonus_credits,
    referredBonusCredits: config.referred_bonus_credits,
    attributionWindowDays: config.attribution_window_days,
    validationDays: config.validation_days,
    rewardExpirationDays: config.reward_expiration_days,
    eligiblePlanCodes: config.eligible_plan_codes,
  } })).catch(next);
}

async function validate(req, res, next) {
  try { return res.json({ success: true, data: await referrals.validateCode(req.params.code, { userId: req.user?.id }) }); }
  catch (error) { return next(error); }
}

async function resolve(req, res, next) {
  try { return res.json({ success: true, data: await referrals.recordClick(req.params.code) }); }
  catch (error) { return next(error); }
}

async function me(req, res, next) {
  try { return res.json({ success: true, data: await referrals.getUserDashboard(req.user.id) }); }
  catch (error) { return next(error); }
}

async function adminList(req, res, next) {
  try { return res.json({ success: true, data: await referrals.getAdminDashboard(req.query) }); }
  catch (error) { return next(error); }
}

async function adminSettings(req, res, next) {
  try { return res.json({ success: true, data: await referrals.getConfig() }); }
  catch (error) { return next(error); }
}

async function updateSettings(req, res, next) {
  try { return res.json({ success: true, data: await referrals.updateConfig(req.body || {}, req.user.id) }); }
  catch (error) { return next(error); }
}

async function reject(req, res, next) {
  try { return res.json({ success: true, data: await referrals.rejectReward(req.params.referralId, req.user.id, req.body?.reason) }); }
  catch (error) { return next(error); }
}

async function processDue(req, res, next) {
  try { return res.json({ success: true, data: await referrals.processDueRewards(req.user.id) }); }
  catch (error) { return next(error); }
}

module.exports = { adminList, adminSettings, me, processDue, publicConfig, reject, resolve, updateSettings, validate };
