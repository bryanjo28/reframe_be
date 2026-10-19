const { supabaseAdmin, isSupabaseAdminConfigured } = require("../config/supabase");
const { PAYMENT_METHODS } = require("../config/paymentMethods");

function httpError(message,status=500,code){const e=new Error(message);e.status=status;if(code)e.code=code;return e;}
function admin(){if(!isSupabaseAdminConfigured||!supabaseAdmin)throw httpError("Supabase admin belum dikonfigurasi.",500);return supabaseAdmin;}

async function getPaymentPageData(userId, { db = admin() } = {}){
  await require('./subscriptionPeriodsService').reconcileUserSubscriptionPeriods({ supabase: db, userId });
  const [{data:packages,error:pe},{data:wallet,error:we},{data:orders,error:oe},{data:notifications,error:ne},{data:ledger,error:le},{data:lots,error:lotsError},{data:creditTransactions,error:transactionsError},{data:usageHistory,error:usageError}]=await Promise.all([
    db.from("token_packages").select("id,code,name,token_amount,price_idr").eq("is_active",true).order("sort_order"),
    db.from("token_wallets").select("balance,updated_at").eq("user_id",userId).maybeSingle(),
    db.from("payment_orders").select("id,amount_idr,token_amount,status,provider,order_type,plan_id,payment_method,created_at,paid_at,duration_months,monthly_credits,provider_expires_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(10),
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
  const timeline = await require('./subscriptionPeriodsService').getSubscriptionTimeline({ supabase: db, userId });
  const contracts = new Map(timeline.contracts.map(row => [row.payment_order_id, row]));
  const mappedOrders = (orders || []).map(row => ({ ...row, durationMonths: row.duration_months,
    monthlyCredits: row.monthly_credits, providerExpiresAt: row.provider_expires_at,
    contractStartsAt: contracts.get(row.id)?.starts_at || null, contractEndsAt: contracts.get(row.id)?.ends_at || null }));
  return {packages:packages||[],paymentMethods:PAYMENT_METHODS,balance:!lotsError && lots?.length?subscriptionBalance+topUpBalance:wallet?.balance||0,subscriptionBalance,topUpBalance,orders:mappedOrders,subscriptionTimeline:timeline,notifications:notifications||[],ledger:transactionsError?ledger||[]:creditTransactions||[],usageHistory:usageError?[]:usageHistory||[]};
}

async function markNotificationRead(userId,id){const {error}=await admin().from("user_notifications").update({read_at:new Date().toISOString()}).eq("id",id).eq("user_id",userId);if(error)throw httpError(error.message);}
module.exports={getPaymentPageData,markNotificationRead,...require("./pakasirPaymentsService")};
