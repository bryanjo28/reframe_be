const assert = require('node:assert/strict');
const { createReferralService } = require('../src/services/referralService');

const referrerId = '00000000-0000-4000-8000-000000000001';
const newUserId = '00000000-0000-4000-8000-000000000002';
const codeRow = { id: '00000000-0000-4000-8000-000000000003', user_id: referrerId, code: 'A1B2C3D4' };
const config = { singleton: true, enabled: true, visible: true, referrer_bonus_credits: 20, referred_bonus_credits: 10, attribution_window_days: 30 };

function fakeDb({ duplicate = false } = {}) {
  const inserts = [];
  const db = { inserts, from(table) {
    let operation = 'select';
    let inserted;
    let filters = {};
    const result = () => {
      if (operation === 'insert') {
        inserts.push({ table, value: inserted });
        if (table === 'referral_attributions' && duplicate) return { data: null, error: { code: '23505' } };
        return { data: table === 'referral_attributions' ? { id: '00000000-0000-4000-8000-000000000004' } : inserted, error: null };
      }
      if (table === 'referral_program_config') return { data: config, error: null };
      if (table === 'referral_codes') return { data: filters.code === codeRow.code || filters.id === codeRow.id ? codeRow : null, error: null };
      return { data: null, error: null };
    };
    const builder = {
      select() { return builder; },
      eq(key, value) { filters[key] = value; return builder; },
      insert(value) { operation = 'insert'; inserted = value; return builder; },
      maybeSingle() { return Promise.resolve(result()); },
      single() { return Promise.resolve(result()); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return builder;
  } };
  return db;
}

async function run() {
  let now = 1_800_000_000_000;
  const db = fakeDb();
  const service = createReferralService({ db, secret: 'test-secret', now: () => now });
  const validation = await service.validateCode('a1b2c3d4');
  assert.equal(validation.valid, true);
  assert.equal(validation.referrerBonusCredits, 20);
  assert.equal(validation.referredBonusCredits, 10);
  assert.equal(await service.createAttribution({ userId: referrerId, token: validation.referralToken }).then(value => value.attributed), false, 'self-referral is rejected');
  assert.equal((await service.createAttribution({ userId: newUserId, token: validation.referralToken })).attributed, true);
  assert.deepEqual(db.inserts.map(row => row.table), ['referral_attributions'], 'signup records attribution but grants no free or referral credits');

  const duplicateService = createReferralService({ db: fakeDb({ duplicate: true }), secret: 'test-secret', now: () => now });
  const duplicateValidation = await duplicateService.validateCode(codeRow.code);
  assert.equal((await duplicateService.createAttribution({ userId: newUserId, token: duplicateValidation.referralToken })).existing, true, 'an existing attribution cannot be replaced');

  const expiredDb = fakeDb();
  const expiringService = createReferralService({ db: expiredDb, secret: 'test-secret', now: () => now });
  const expiringValidation = await expiringService.validateCode(codeRow.code);
  now += 31 * 24 * 60 * 60 * 1000;
  assert.equal((await expiringService.createAttribution({ userId: newUserId, token: expiringValidation.referralToken })).attributed, false, 'expired attribution token is ignored');
  console.log('Referral service tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });


