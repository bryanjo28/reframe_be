const threadsPublishService = require("../services/threadsPublishService");
const threadsAuthService = require("../services/threadsAuthService");
const threadsAccountsService = require("../services/threadsAccountsService");

async function getConnectUrl(req, res, next) {
  try {
    const result = threadsAuthService.createAuthorizationRequest({
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Threads connect URL generated",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function handleThreadsCallback(req, res, next) {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const callbackPath = process.env.THREADS_FRONTEND_CALLBACK_PATH || "/";

  function buildFrontendRedirect(params) {
    const url = new URL(frontendUrl);
    const normalizedPath = callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`;

    url.pathname = normalizedPath;
    url.search = params.toString();

    return url.toString();
  }

  try {
    const { code, state } = req.query;

    const result = await threadsAuthService.handleCallback({ code, state });

    const params = new URLSearchParams({
      connected: "true",
      username: result.threadsUsername || "",
      threads_id: result.threadsUserId || "",
    });

    return res.redirect(buildFrontendRedirect(params));
  } catch (error) {
    const params = new URLSearchParams({
      connected: "false",
      error: error.message || "OAuth failed",
    });

    return res.redirect(buildFrontendRedirect(params));
  }
}

async function handleThreadsDeleteCallback(req, res, next) {
  try {
    const data = await threadsAccountsService.disconnectThreadsAccount({
      supabase: req.supabase,
      userId: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: "Threads account disconnected successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function autoPostThreadsDrafts(req, res, next) {
  try {
    const data = await threadsPublishService.autoPostThreadsDrafts({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.threadsAutoPostInput || req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Threads posts scheduled successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function runScheduledThreadsJob(req, res, next) {
  try {
    const scheduledJobId = req.body.scheduledJobId || req.body.scheduled_job_id || null;

    const data = await threadsPublishService.runScheduledThreadsJob({
      supabase: req.supabase,
      userId: req.user.id,
      scheduledJobId,
      limit: req.threadsRunScheduledJobInput?.limit || req.body.limit,
      force: !!scheduledJobId,
    });

    return res.status(200).json({
      success: true,
      message: "Threads scheduled job executed successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function retryFailedThreadsPost(req, res, next) {
  try {
    const data = await threadsPublishService.retryFailedThreadsPost({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.threadsRetryInput || req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Failed Threads post scheduled for retry successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  autoPostThreadsDrafts,
  getConnectUrl,
  handleThreadsCallback,
  handleThreadsDeleteCallback,
  retryFailedThreadsPost,
  runScheduledThreadsJob,
};
