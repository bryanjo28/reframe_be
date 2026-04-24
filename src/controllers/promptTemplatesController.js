const promptTemplatesService = require("../services/promptTemplatesService");

async function listPromptTemplates(req, res, next) {
  try {
    const data = await promptTemplatesService.listPromptTemplates({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Prompt templates fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function getPromptTemplateById(req, res, next) {
  try {
    const data = await promptTemplatesService.getPromptTemplateById({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Prompt template fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function createPromptTemplate(req, res, next) {
  try {
    const data = await promptTemplatesService.createPromptTemplate({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.promptTemplateInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Prompt template created successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function updatePromptTemplate(req, res, next) {
  try {
    const data = await promptTemplatesService.updatePromptTemplate({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
      payload: req.promptTemplateInput || req.body,
    });

    res.status(200).json({
      success: true,
      message: "Prompt template updated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function deletePromptTemplate(req, res, next) {
  try {
    const data = await promptTemplatesService.deletePromptTemplate({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Prompt template deleted successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPromptTemplate,
  deletePromptTemplate,
  getPromptTemplateById,
  listPromptTemplates,
  updatePromptTemplate,
};
