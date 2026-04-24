const threadsAuthService = require("../services/threadsAuthService");

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
  try {
    const { code, state } = req.query;

    const result = await threadsAuthService.handleCallback({ code, state });

    res.status(200).json({
      success: true,
      message: "Threads account connected successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getConnectUrl,
  handleThreadsCallback,
};
