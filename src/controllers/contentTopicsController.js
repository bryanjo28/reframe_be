const contentTopicsService = require("../services/contentTopicsService");
const contentTopicsGenerationService = require("../services/contentTopicsGenerationService");

const devContentTopicsGenerationService = require("../services/devContentTopicsGenerationService");
const devContentTopicStore = require("../store/devContentTopicStore");

async function listContentTopics(req, res, next) {
  try {
    if (req.isDevAuth) {
      const data = devContentTopicStore.list(req.user.id);
      return res.status(200).json({
        success: true,
        message: "Development content topics fetched successfully",
        data,
        pagination: { page: 1, pageSize: data.length, total: data.length },
      });
    }

    const result = await contentTopicsService.listContentTopics({
      supabase: req.supabase,
      userId: req.user.id,
      query: req.query,
    });

    res.status(200).json({
      success: true,
      message: "Content topics fetched successfully",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

async function getContentTopicById(req, res, next) {
  try {
    const data = req.isDevAuth ? devContentTopicStore.get(req.user.id, req.params.id) : await contentTopicsService.getContentTopicById({
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
    const data = req.isDevAuth ? devContentTopicStore.create(req.user.id, req.contentTopicInput || req.body) : await contentTopicsService.createContentTopic({
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

async function generateContentTopics(req, res, next) {
  try {
    const data = req.isDevAuth ? devContentTopicsGenerationService.generateContentTopics({
      userId: req.user.id,
      payload: req.contentTopicGenerateInput || req.body,
    }) : await contentTopicsGenerationService.generateContentTopics({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.contentTopicGenerateInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Content topics generated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function updateContentTopic(req, res, next) {
  try {
    const data = req.isDevAuth ? devContentTopicStore.update(req.user.id, req.params.id, req.contentTopicInput || req.body) : await contentTopicsService.updateContentTopic({
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
    const data = req.isDevAuth ? devContentTopicStore.remove(req.user.id, req.params.id) : await contentTopicsService.deleteContentTopic({
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
  generateContentTopics,
  getContentTopicById,
  listContentTopics,
  updateContentTopic,
};
