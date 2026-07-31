const contentOutputsService = require("../services/contentOutputsService");

async function listContentOutputs(req, res, next) {
  try {
    const data = await contentOutputsService.listContentOutputs({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Content outputs fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function getContentOutputById(req, res, next) {
  try {
    const data = await contentOutputsService.getContentOutputById({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Content output fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function createContentOutput(req, res, next) {
  try {
    const data = await contentOutputsService.createContentOutput({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.contentOutputInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Content output created successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function generateContentOutput(req, res, next) {
  try {
    const data = await contentOutputsService.generateContentOutput({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.contentOutputInput || req.body,
    });

    res.status(201).json({
      contents: data?.contentOutput?.content ? [data.contentOutput.content] : [],
    });
  } catch (error) {
    next(error);
  }
}

async function scheduleAutoGenerateContentOutputs(req, res, next) {
  try {
    await contentOutputsService.scheduleAutoGenerateContentOutputs({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.contentOutputAutoGenerateInput || req.body,
    });

    res.status(201).json({
      contents: [],
    });
  } catch (error) {
    next(error);
  }
}

async function generateContentOutputDemo(req, res, next) {
  try {
    const data = await contentOutputsService.generateContentOutputDemo({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.contentOutputDemoInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Content output demo generated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function updateContentOutput(req, res, next) {
  try {
    const data = await contentOutputsService.updateContentOutput({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
      payload: req.contentOutputInput || req.body,
    });

    res.status(200).json({
      success: true,
      message: "Content output updated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteContentOutput(req, res, next) {
  try {
    const data = await contentOutputsService.deleteContentOutput({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Content output deleted successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createContentOutput,
  deleteContentOutput,
  scheduleAutoGenerateContentOutputs,
  generateContentOutputDemo,
  generateContentOutput,
  getContentOutputById,
  listContentOutputs,
  updateContentOutput,
};
