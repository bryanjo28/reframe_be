const crypto = require("crypto");
const { supabaseAdmin, isSupabaseAdminConfigured } = require("../config/supabase");

function httpError(message,status=500,code){const e=new Error(message);e.status=status;if(code)e.code=code;return e;}
function admin(){if(!isSupabaseAdminConfigured||!supabaseAdmin)throw httpError("Supabase admin belum dikonfigurasi.",500);return supabaseAdmin;}

async function getPaymentPageData(userId){
  const db=admin();
  const [{data:packages,error:pe},{data:wallet,error:we},{data:orders,error:oe},{data:notifications,error:ne},{data:ledger,error:le}]=await Promise.all([
    db.from("token_packages").select("id,code,name,token_amount,price_idr").eq("is_active",true).order("sort_order"),
    db.from("token_wallets").select("balance,updated_at").eq("user_id",userId).maybeSingle(),
    db.from("payment_orders").select("id,amount_idr,token_amount,status,provider,created_at,paid_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(10),
    db.from("user_notifications").select("id,type,title,message,read_at,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(20),
    db.from("token_ledger").select("id,amount,balance_after,kind,description,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(20),
  ]);
  const error=pe||we||oe||ne||le;if(error)throw httpError(error.message,500,"PAYMENT_STORAGE_NOT_READY");
  return {packages:packages||[],balance:wallet?.balance||0,orders:orders||[],notifications:notifications||[],ledger:ledger||[]};
}

async function createOrder(userId,packageId){
  const db=admin();
  const {data:pack,error}=await db.from("token_packages").select("id,token_amount,price_idr,is_active").eq("id",packageId).maybeSingle();
  if(error)throw httpError(error.message);if(!pack||!pack.is_active)throw httpError("Paket token tidak tersedia.",404);
  const {data:order,error:insertError}=await db.from("payment_orders").insert({user_id:userId,package_id:pack.id,amount_idr:pack.price_idr,token_amount:pack.token_amount,status:"pending",provider:null,provider_reference:`draft_${crypto.randomUUID()}`}).select("id,amount_idr,token_amount,status,created_at").single();
  if(insertError)throw httpError(insertError.message);
  await db.from("user_notifications").insert({user_id:userId,type:"payment_pending",title:"Order menunggu pembayaran",message:`Order ${pack.token_amount.toLocaleString("id-ID")} token sudah dibuat. Checkout Midtrans akan segera tersedia.`});
  return {...order,checkoutAvailable:false,message:"Order tersimpan. Pembayaran Midtrans akan tersedia setelah integrasi provider diaktifkan."};
}

async function markNotificationRead(userId,id){const {error}=await admin().from("user_notifications").update({read_at:new Date().toISOString()}).eq("id",id).eq("user_id",userId);if(error)throw httpError(error.message);}
module.exports={getPaymentPageData,createOrder,markNotificationRead};
