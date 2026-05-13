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
      success: true,
      message: "Content output generated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function autoGenerateContentOutputs(req, res, next) {
  try {
    const data = await contentOutputsService.autoGenerateContentOutputs({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.contentOutputAutoGenerateInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Content outputs auto-generated successfully",
      data,
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
  autoGenerateContentOutputs,
  generateContentOutputDemo,
  generateContentOutput,
  getContentOutputById,
  listContentOutputs,
  updateContentOutput,
};
