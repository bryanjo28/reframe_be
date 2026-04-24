const contentTopicsService = require("../services/contentTopicsService");

async function listContentTopics(req, res, next) {
  try {
    const data = await contentTopicsService.listContentTopics({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Content topics fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function getContentTopicById(req, res, next) {
  try {
    const data = await contentTopicsService.getContentTopicById({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Content topic fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function createContentTopic(req, res, next) {
  try {
    const data = await contentTopicsService.createContentTopic({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.contentTopicInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Content topic created successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function updateContentTopic(req, res, next) {
  try {
    const data = await contentTopicsService.updateContentTopic({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
      payload: req.contentTopicInput || req.body,
    });

    res.status(200).json({
      success: true,
      message: "Content topic updated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteContentTopic(req, res, next) {
  try {
    const data = await contentTopicsService.deleteContentTopic({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Content topic deleted successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createContentTopic,
  deleteContentTopic,
  getContentTopicById,
  listContentTopics,
  updateContentTopic,
};
