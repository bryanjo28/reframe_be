const threadsAccountsService = require("../services/threadsAccountsService");

async function getThreadsAccount(req, res, next) {
  try {
    const data = await threadsAccountsService.getThreadsAccount({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Threads account fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function saveThreadsAccount(req, res, next) {
  try {
    const data = await threadsAccountsService.saveThreadsAccount({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.threadsAccountInput || req.body,
    });

    res.status(200).json({
      success: true,
      message: "Threads account saved successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function disconnectThreadsAccount(req, res, next) {
  try {
    const data = await threadsAccountsService.disconnectThreadsAccount({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Threads account disconnected successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  disconnectThreadsAccount,
  getThreadsAccount,
  saveThreadsAccount,
};
