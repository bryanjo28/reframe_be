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

async function testChat(req, res, next) {
  try {
    const result = await sumopodService.testChatCompletion({
      prompt: req.body?.prompt,
      model: req.body?.model,
      maxTokens: req.body?.maxTokens,
      temperature: req.body?.temperature,
      systemPrompt: req.body?.systemPrompt,
    });

    res.status(200).json({
      success: true,
      message: "SumoPod chat completion successful",
      data: result.content,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  health,
  testChat,
};
