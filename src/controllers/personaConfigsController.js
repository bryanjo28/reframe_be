const personaConfigsService = require("../services/personaConfigsService");

const devPersonaStore = require("../store/devPersonaStore");

async function listPersonaConfigs(req, res, next) {
  try {
    const data = req.isDevAuth ? devPersonaStore.list(req.user.id) : await personaConfigsService.listPersonaConfigs({
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
    const data = req.isDevAuth ? devPersonaStore.get(req.user.id, req.params.id) : await personaConfigsService.getPersonaConfigById({
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

    const normalizedPayload = personaConfigsService.normalizePersonaConfigPayload(req.personaConfigInput || req.body);
    const data = req.isDevAuth ? devPersonaStore.create(req.user.id, normalizedPayload) : await personaConfigsService.createPersonaConfig({
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
    const normalizedPayload = personaConfigsService.normalizePersonaConfigPayload(req.personaConfigInput || req.body);
    const data = req.isDevAuth ? devPersonaStore.update(req.user.id, req.params.id, normalizedPayload) : await personaConfigsService.updatePersonaConfig({
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
    const data = req.isDevAuth ? devPersonaStore.remove(req.user.id, req.params.id) : await personaConfigsService.deletePersonaConfig({
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

