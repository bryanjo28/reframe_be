const assert = require('node:assert/strict');
async function main() {
  const { reconcileUserSubscriptionPeriods, getSubscriptionTimeline } = require('../src/services/subscriptionPeriodsService');
  const calls = [];
  const contracts = [{ id: 'contract', status: 'queued', ends_at: '2027-01-01T00:00:00Z' }];
  const periods = [{ id: 'period', status: 'active', monthly_credits: 200 }];
  const db = { async rpc(name, args) { calls.push([name,args]); return { data: { creditsAdded: 200 } }; },
    from(table) { return { select() { return this; }, eq(key,value) { assert.equal(key,'user_id'); assert.equal(value,'owner'); return this; },
      order: async () => ({ data: table === 'subscription_contracts' ? contracts : periods }) }; } };
  assert.equal((await reconcileUserSubscriptionPeriods({ supabase: db, userId: 'owner' })).creditsAdded,200);
  assert.deepEqual(calls,[['ensure_subscription_current',{p_user_id:'owner'}]]);
  const timeline = await getSubscriptionTimeline({supabase:db,userId:'owner'});
  assert.equal(timeline.active.id,'period');
  assert.equal(timeline.queued[0].id,'contract');
  assert.equal(timeline.coverageEndsAt,'2027-01-01T00:00:00Z');
  await assert.rejects(reconcileUserSubscriptionPeriods({supabase:{rpc:async()=>({error:{message:'unavailable'}})},userId:'owner'}), /unavailable/);
  const creditCalls=[];
  const {reserveCredits}=require('../src/services/aiCreditsService');
  await reserveCredits({userId:'owner',messages:[],maxTokens:1,db:{rpc:async(name)=>{creditCalls.push(name);return {data:0};}}});
  assert.ok(creditCalls.indexOf('ensure_subscription_current') >= 0);
  assert.ok(creditCalls.indexOf('ensure_subscription_current') < creditCalls.indexOf('reserve_ai_credits'));
  console.log('ok - subscription reconciliation ownership and active/queued timeline');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
