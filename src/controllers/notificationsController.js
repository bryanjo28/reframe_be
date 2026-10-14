const service = require('../services/notificationsService');

async function list(req, res, next) {
  try {
    const data = await service.listNotifications({ supabase: req.supabase, userId: req.user.id });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

async function markRead(req, res, next) {
  try {
    const data = await service.markNotificationRead({ supabase: req.supabase, userId: req.user.id, id: req.params.id });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

module.exports = { list, markRead };
