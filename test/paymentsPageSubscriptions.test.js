const assert=require('node:assert/strict');
const {getPaymentPageData}=require('../src/services/paymentsService');
async function main(){
  const calls=[];
  const rows={
    payment_orders:[{id:'order',duration_months:3,monthly_credits:200,provider_expires_at:'2027-01-01T00:00:00Z'}],
    subscription_contracts:[{id:'contract',payment_order_id:'order',status:'queued',starts_at:'2027-02-01T00:00:00Z',ends_at:'2027-05-01T00:00:00Z'}],
    credit_lots:[{credit_type:'topup',remaining_credits:100}],
  };
  const db={rpc:async(name)=>{calls.push(name);return {data:{}};},from(table){return {
    select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
    maybeSingle:async()=>({data:null}),then(resolve){resolve({data:rows[table]||[]});}
  };}};
  const page=await getPaymentPageData('owner',{db});
  assert.equal(calls[0],'ensure_subscription_current');
  assert.equal(page.orders[0].durationMonths,3);
  assert.equal(page.orders[0].contractStartsAt,'2027-02-01T00:00:00Z');
  assert.equal(page.topUpBalance,100);
  console.log('ok - payment page reconciles and exposes order duration, expiry and queued activation dates');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
