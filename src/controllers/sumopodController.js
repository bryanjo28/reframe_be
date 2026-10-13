const sumopodService = require("../services/sumopodService");

async function health(req, res, next) {
  try {
    const config = sumopodService.getSumoPodConfigStatus();

    res.status(config.configured ? 200 : 400).json({
      success: config.configured,
      message: config.configured
        ? "SumoPod is configured"
        : "SumoPod is not fully configured",
      data: config,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  health,
};
