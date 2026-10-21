const service = require("../services/paymentsService");
async function getPage(req, res, next) { try { res.json({ success: true, data: await service.getPaymentPageData(req.user.id) }); } catch (e) { next(e) } }
async function createOrder(req, res, next) {
  try {
    res.status(201).json({
      success: true,
      data: await service.createOrder(req.user.id, req.body),
    });
  } catch (e) {
    next(e);
  }
}
async function readNotification(req, res, next) { try { await service.markNotificationRead(req.user.id, req.params.id); res.json({ success: true }); } catch (e) { next(e) } }
async function pakasirWebhook(req, res, next) { try { res.json({ success: true, data: await service.handlePakasirWebhook(req.body, req.get('X-Secret')) }); } catch (e) { next(e) } }
async function checkOrder(req, res, next) { try { res.json({ success: true, data: await service.checkOrder(req.user.id, req.params.id) }); } catch (e) { next(e) } }
async function retryCheckout(req, res, next) { try { res.json({ success: true, data: await service.retryCheckout(req.user.id, req.params.id) }); } catch (e) { next(e) } }
module.exports = { getPage, createOrder, pakasirWebhook, checkOrder, retryCheckout, readNotification };
