const assert = require('node:assert/strict');
require('dotenv').config({ quiet: true });
const { supabaseAdmin } = require('../src/config/supabase');
const { getTransactions } = require('../src/services/admin/adminService');

async function main() {
  const originalFrom = supabaseAdmin.from;
  let rows = [
    { id: 'subscription-order', user_id: 'user', package_id: null, plan_id: 'creator-plan', order_type: 'subscription',
      amount_idr: 149000, credits: 600, status: 'paid', provider: 'pakasir', provider_reference: 'txn-sub' },
    { id: 'topup-order', user_id: 'user', package_id: 'topup-package', plan_id: null, order_type: 'topup',
      amount_idr: 15000, credits: 100, status: 'pending', provider: 'pakasir' },
  ];
  const lookups = [];
  let failPlans = false;
  supabaseAdmin.from = table => {
    const builder = {
      select() { return this; }, order() { return this; }, range() { return this; },
      eq() { return this; }, gte() { return this; }, lt() { return this; }, or() { return this; },
      in(column, ids) {
        assert.ok(ids.every(Boolean), 'UUID lookups must never contain null');
        lookups.push({ table, ids });
        return this;
      },
      then(resolve, reject) {
        const result = table === 'payment_orders' ? { data: rows, count: rows.length }
          : table === 'profiles' ? { data: [{ id: 'user', full_name: 'Dummy', account_name: 'dummy' }] }
            : table === 'token_packages' ? { data: [{ id: 'topup-package', name: '100 Credits' }] }
              : table === 'subscription_plans' ? failPlans ? { error: { message: 'lookup failed' } }
                : { data: [{ id: 'creator-plan', name: 'Creator' }] }
                : assert.fail(`Unexpected table ${table}`);
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  };
  try {
    let result = await getTransactions({});
    assert.equal(result.items[0].product, 'Creator');
    assert.equal(result.items[0].type, 'subscription');
    assert.equal(result.items[0].credits, 600);
    assert.equal(result.items[0].provider, 'pakasir');
    assert.equal(result.items[1].product, '100 Credits');
    assert.equal(result.items[1].type, 'top_up');
    assert.equal(result.items[1].providerReference, null);
    assert.deepEqual(lookups.find(call => call.table === 'token_packages').ids, ['topup-package']);
    assert.deepEqual(lookups.find(call => call.table === 'subscription_plans').ids, ['creator-plan']);
    failPlans = true;
    await assert.rejects(getTransactions({}), { status: 503, code: 'ADMIN_DATA_UNAVAILABLE' });
    failPlans = false;
    rows = [{ id: 'legacy', package_id: 'topup-package', token_amount: 50, provider: 'midtrans' }];
    result = await getTransactions({});
    assert.equal(result.items[0].type, 'top_up');
    assert.equal(result.items[0].product, '100 Credits');
    assert.equal(result.items[0].credits, 50);
    rows = [];
    lookups.length = 0;
    assert.deepEqual((await getTransactions({})).items, []);
    assert.equal(lookups.length, 0);
    console.log('ok - admin transactions handles nullable product IDs, subscription and topup names, legacy orders and lookup failures');
  } finally { supabaseAdmin.from = originalFrom; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
