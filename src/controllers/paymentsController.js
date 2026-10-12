const service=require("../services/paymentsService");
async function getPage(req,res,next){try{res.json({success:true,data:await service.getPaymentPageData(req.user.id)});}catch(e){next(e)}}
async function createOrder(req,res,next){try{res.status(201).json({success:true,data:await service.createOrder(req.user.id,req.body.packageId)});}catch(e){next(e)}}
async function readNotification(req,res,next){try{await service.markNotificationRead(req.user.id,req.params.id);res.json({success:true});}catch(e){next(e)}}
module.exports={getPage,createOrder,readNotification};
