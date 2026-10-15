const crypto = require("crypto");
const { withRequestTimeout } = require("../utils/requestTimeout");
const { supabaseAdmin, isSupabaseAdminConfigured } = require("../config/supabase");

function httpError(message,status=500,code){const e=new Error(message);e.status=status;if(code)e.code=code;return e;}
function admin(){if(!isSupabaseAdminConfigured||!supabaseAdmin)throw httpError("Supabase admin belum dikonfigurasi.",500);return supabaseAdmin;}

async function getPaymentPageData(userId){
  const db=admin();
  const [{data:packages,error:pe},{data:wallet,error:we},{data:orders,error:oe},{data:notifications,error:ne},{data:ledger,error:le},{data:lots,error:lotsError},{data:creditTransactions,error:transactionsError},{data:usageHistory,error:usageError}]=await Promise.all([
    db.from("token_packages").select("id,code,name,token_amount,price_idr").eq("is_active",true).order("sort_order"),
    db.from("token_wallets").select("balance,updated_at").eq("user_id",userId).maybeSingle(),
    db.from("payment_orders").select("id,amount_idr,token_amount,status,provider,created_at,paid_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(10),
    db.from("user_notifications").select("id,type,title,message,read_at,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(20),
    db.from("token_ledger").select("id,amount,balance_after,kind,description,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(20),
    db.from("credit_lots").select("credit_type,original_credits,remaining_credits,expires_at").eq("user_id",userId),
    db.from("credit_transactions").select("id,credits_delta,balance_after,transaction_type,source_type,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(30),
    db.from("ai_usage_logs").select("request_id,feature,total_tokens,credits_charged,status,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(30),
  ]);
  const error=pe||we||oe||ne||le;if(error)throw httpError(error.message,500,"PAYMENT_STORAGE_NOT_READY");
  const activeLots=lotsError?[]:(lots||[]).filter(item=>!item.expires_at||new Date(item.expires_at)>new Date());
  const subscriptionBalance=activeLots.filter(item=>item.credit_type!=="topup").reduce((sum,item)=>sum+Number(item.remaining_credits||0),0);
  const topUpBalance=activeLots.filter(item=>item.credit_type==="topup").reduce((sum,item)=>sum+Number(item.remaining_credits||0),0);
  return {packages:packages||[],balance:activeLots.length?subscriptionBalance+topUpBalance:wallet?.balance||0,subscriptionBalance,topUpBalance,orders:orders||[],notifications:notifications||[],ledger:transactionsError?ledger||[]:creditTransactions||[],usageHistory:usageError?[]:usageHistory||[]};
}

function midtransConfig(){
  const serverKey=process.env.MIDTRANS_SERVER_KEY||"";
  const isProduction=String(process.env.MIDTRANS_IS_PRODUCTION||"").toLowerCase()==="true";
  return {serverKey,snapBase:isProduction?"https://app.midtrans.com/snap/v1":"https://app.sandbox.midtrans.com/snap/v1",apiBase:isProduction?"https://api.midtrans.com":"https://api.sandbox.midtrans.com"};
}
async function midtransRequest(url,options={}){
  const {serverKey}=midtransConfig();if(!serverKey)throw httpError("Midtrans belum dikonfigurasi.",503,"MIDTRANS_NOT_CONFIGURED");
  return withRequestTimeout(async (signal) => {
  const response=await fetch(url,{...options,signal,headers:{Authorization:`Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`,Accept:"application/json","Content-Type":"application/json",...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw httpError(data.status_message||"Midtrans request gagal.",502,"MIDTRANS_ERROR");return data;
  });
}

async function createOrder(userId,packageId){
  const db=admin();
  const {data:pack,error}=await db.from("token_packages").select("id,token_amount,price_idr,is_active").eq("id",packageId).maybeSingle();
  if(error)throw httpError(error.message);if(!pack||!pack.is_active)throw httpError("Paket token tidak tersedia.",404);
  const orderId=crypto.randomUUID();
  const {data:order,error:insertError}=await db.from("payment_orders").insert({id:orderId,user_id:userId,package_id:pack.id,amount_idr:pack.price_idr,token_amount:pack.token_amount,credits:pack.token_amount,status:"pending",provider:"midtrans"}).select("id,amount_idr,token_amount,status,created_at").single();
  if(insertError)throw httpError(insertError.message);
  let checkout=null;
  if(midtransConfig().serverKey){
    try{checkout=await midtransRequest(`${midtransConfig().snapBase}/transactions`,{method:"POST",body:JSON.stringify({transaction_details:{order_id:orderId,gross_amount:pack.price_idr},item_details:[{id:pack.id,price:pack.price_idr,quantity:1,name:`${pack.token_amount} AI Credits`}],custom_field1:userId})});}
    catch(error){await db.from("payment_orders").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",orderId);throw error;}
  }
  await db.from("user_notifications").insert({user_id:userId,type:"payment_pending",title:"Order menunggu pembayaran",message:`Order ${pack.token_amount.toLocaleString("id-ID")} token sudah dibuat. Checkout Midtrans akan segera tersedia.`});
  return {...order,checkoutAvailable:Boolean(checkout?.redirect_url),checkoutUrl:checkout?.redirect_url||null,checkoutToken:checkout?.token||null,message:checkout?"Lanjutkan pembayaran melalui Midtrans.":"Order tersimpan. Midtrans belum dikonfigurasi."};
}

async function handleMidtransWebhook(payload){
  const db=admin();const orderId=String(payload?.order_id||"");if(!orderId)throw httpError("Missing order id",400);
  const verified=await midtransRequest(`${midtransConfig().apiBase}/v2/${encodeURIComponent(orderId)}/status`,{method:"GET"});
  const paid=["capture","settlement"].includes(String(verified.transaction_status)) && String(verified.fraud_status||"accept")!=="challenge";
  if(paid){const {data,error}=await db.rpc("settle_verified_topup",{p_order_id:orderId,p_provider_reference:String(verified.transaction_id||orderId)});if(error)throw httpError(error.message);return data;}
  const mapped={deny:"failed",cancel:"cancelled",expire:"expired",failure:"failed"}[verified.transaction_status];
  if(mapped)await db.from("payment_orders").update({status:mapped,updated_at:new Date().toISOString()}).eq("id",orderId).eq("status","pending");
  return {status:verified.transaction_status,credited:false};
}

async function markNotificationRead(userId,id){const {error}=await admin().from("user_notifications").update({read_at:new Date().toISOString()}).eq("id",id).eq("user_id",userId);if(error)throw httpError(error.message);}
module.exports={getPaymentPageData,createOrder,handleMidtransWebhook,markNotificationRead};
