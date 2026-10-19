const assert = require('node:assert/strict');
const { runDueScheduledJobs } = require('../src/services/cronService');
async function main() {
  const calls=[];
  const db={from(){return {select(){return this;},eq(){return this;},lte:async()=>({data:[]})};}};
  await runDueScheduledJobs({isConfigured:true,supabase:db,
    reconcileSubscriptions:async()=>{calls.push('subscriptions');throw Error('offline');},
    reconcilePayments:async()=>{calls.push('payments');}});
  assert.deepEqual(calls,['subscriptions','payments']);
  calls.length=0;
  await runDueScheduledJobs({isConfigured:false,supabase:db,reconcileSubscriptions:async()=>calls.push('bad')});
  assert.deepEqual(calls,[]);
  console.log('ok - billing cron runs both reconciliation paths independently and skips unconfigured database');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
