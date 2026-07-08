const express = require("express");

const { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseUrl } = require("../config/supabase");
const authRoutes = require("./authRoutes");
const contentOutputsRoutes = require("./contentOutputsRoutes");
const contentPillarsRoutes = require("./contentPillarsRoutes");
const contentTopicsRoutes = require("./contentTopicsRoutes");
const personaConfigsRoutes = require("./personaConfigsRoutes");
const promptTemplatesRoutes = require("./promptTemplatesRoutes");
const subscriptionPlansRoutes = require("./subscriptionPlansRoutes");
const subscriptionsRoutes = require("./subscriptionsRoutes");
const scheduledJobsRoutes = require("./scheduledJobsRoutes");
const usageRoutes = require("./usageRoutes");
const sumopodRoutes = require("./sumopodRoutes");
const threadsAccountsRoutes = require("./threadsAccountsRoutes");
const threadsRoutes = require("./threadsRoutes");

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API is healthy",
    timestamp: new Date().toISOString(),
  });
});

router.get("/supabase/health", (req, res) => {
  if (!isSupabaseConfigured) {
    return res.status(500).json({
      success: false,
      message: "Supabase is not configured",
      requiredEnv: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
    });
  }

  return res.status(200).json({
    success: true,
    message: "Supabase client is configured",
    projectUrl: supabaseUrl,
    adminConfigured: isSupabaseAdminConfigured,
  });
});

router.use("/auth", authRoutes);
router.use("/content-topics", contentTopicsRoutes);
router.use("/content-outputs", contentOutputsRoutes);
router.use("/content-pillars", contentPillarsRoutes);
router.use("/persona-configs", personaConfigsRoutes);
router.use("/prompt-templates", promptTemplatesRoutes);
router.use("/subscription-plans", subscriptionPlansRoutes);
router.use("/subscriptions", subscriptionsRoutes);
router.use("/usage", usageRoutes);
router.use("/scheduled-jobs", scheduledJobsRoutes);
router.use("/sumopod", sumopodRoutes);
router.use("/threads-accounts", threadsAccountsRoutes);
router.use("/threads", threadsRoutes);

module.exports = router;
