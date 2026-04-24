const personaConfigsService = require("../services/personaConfigsService");

async function listPersonaConfigs(req, res, next) {
  try {
    const data = await personaConfigsService.listPersonaConfigs({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Persona configs fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function getPersonaConfigById(req, res, next) {
  try {
    const data = await personaConfigsService.getPersonaConfigById({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Persona config fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function createPersonaConfig(req, res, next) {
  try {
    console.log("[persona-configs:create] userId:", req.user?.id);
    console.log("[persona-configs:create] body:", req.body);
    console.log("[persona-configs:create] normalized:", req.personaConfigInput || req.body);

    const data = await personaConfigsService.createPersonaConfig({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.personaConfigInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Persona config created successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function updatePersonaConfig(req, res, next) {
  try {
    const data = await personaConfigsService.updatePersonaConfig({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
      payload: req.personaConfigInput || req.body,
    });

    res.status(200).json({
      success: true,
      message: "Persona config updated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function deletePersonaConfig(req, res, next) {
  try {
    const data = await personaConfigsService.deletePersonaConfig({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Persona config deleted successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPersonaConfig,
  deletePersonaConfig,
  getPersonaConfigById,
  listPersonaConfigs,
  updatePersonaConfig,
};

