const contentPillarsService = require("../services/contentPillarsService");

async function listContentPillars(req, res, next) {
  try {
    const data = await contentPillarsService.listContentPillars({
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
    const data = await contentPillarsService.getContentPillarById({
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
    const data = await contentPillarsService.createContentPillar({
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
    const data = await contentPillarsService.updateContentPillar({
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
    const data = await contentPillarsService.deleteContentPillar({
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

module.exports = {
  createContentPillar,
  deleteContentPillar,
  getContentPillarById,
  listContentPillars,
  updateContentPillar,
};
