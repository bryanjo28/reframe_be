const contentPillarsService = require("../services/contentPillarsService");

const devContentPillarStore = require("../store/devContentPillarStore");

async function listContentPillars(req, res, next) {
  try {
    const data = req.isDevAuth ? devContentPillarStore.list(req.user.id) : await contentPillarsService.listContentPillars({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Content pillars fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function getContentPillarById(req, res, next) {
  try {
    const data = req.isDevAuth ? devContentPillarStore.get(req.user.id, req.params.id) : await contentPillarsService.getContentPillarById({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Content pillar fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function createContentPillar(req, res, next) {
  try {
    const data = req.isDevAuth ? devContentPillarStore.create(req.user.id, req.contentPillarInput || req.body) : await contentPillarsService.createContentPillar({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.contentPillarInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Content pillar created successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function updateContentPillar(req, res, next) {
  try {
    const data = req.isDevAuth ? devContentPillarStore.update(req.user.id, req.params.id, req.contentPillarInput || req.body) : await contentPillarsService.updateContentPillar({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
      payload: req.contentPillarInput || req.body,
    });

    res.status(200).json({
      success: true,
      message: "Content pillar updated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteContentPillar(req, res, next) {
  try {
    const data = req.isDevAuth ? devContentPillarStore.remove(req.user.id, req.params.id) : await contentPillarsService.deleteContentPillar({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Content pillar deleted successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function enhanceContentPillar(req, res, next) {
  try {
    const data = await contentPillarsService.enhanceContentPillarWithAi({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
      input: req.contentPillarInput || req.body,
      model: req.body?.model,
      maxTokens: req.body?.maxTokens,
      temperature: req.body?.temperature,
      systemPrompt: req.body?.systemPrompt,
    });

    res.status(200).json({
      success: true,
      message: "Content pillar enhanced successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createContentPillar,
  deleteContentPillar,
  enhanceContentPillar,
  getContentPillarById,
  listContentPillars,
  updateContentPillar,
};
