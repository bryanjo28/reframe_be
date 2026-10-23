const cron = require("node-cron");
const { supabaseAdmin, isSupabaseAdminConfigured } = require("../config/supabase");
const { runScheduledThreadsJob } = require("./threadsPublishService");
const {
  autoGenerateContentOutputs,
  claimScheduledContentGenerationJob,
} = require("./contentOutputsService");

async function runDueScheduledJobs({
  isConfigured = isSupabaseAdminConfigured,
  supabase = supabaseAdmin,
  claimContentGenerationJob = claimScheduledContentGenerationJob,
  generateContentOutputs = autoGenerateContentOutputs,
  throwOnQueryError = false,
  reconcileSubscriptions = async () => {
    const { error } = await supabase.rpc('reconcile_due_subscription_periods', { p_limit: 100 });
    if (error) throw new Error(error.message);
  },
  reconcilePayments = () => require('./pakasirPaymentsService').createPaymentsService({ db: supabase }).reconcileExpiredPayments(),
} = {}) {
  if (!isConfigured || !supabase) {
    console.warn("[cron] Supabase admin not configured, skipping job run");
    return;
  }

  const nowIso = new Date().toISOString();
  const reconcileReferrals = async () => {
    const { error } = await supabase.rpc('process_due_referral_rewards', { p_limit: 100 });
    if (error) throw new Error(error.message);
  };
  const reconcileSubscriptionReminders = async () => {
    const { error } = await supabase.rpc('process_subscription_expiry_reminders', { p_limit: 500 });
    if (error) throw new Error(error.message);
  };
  for (const [name, reconcile] of [['subscriptions', reconcileSubscriptions], ['payments', reconcilePayments], ['subscription reminders', reconcileSubscriptionReminders], ['referral rewards', reconcileReferrals]]) {
    try { await reconcile(); }
    catch (error) { console.error(`[cron] ${name} reconciliation failed:`, error.message); }
  }

  const { data: dueJobs, error } = await supabase
    .from("scheduled_jobs")
    .select("id, user_id, job_type, config, target_count, schedule_value")
    .eq("status", "active")
    .lte("next_run_at", nowIso);

  if (error) {
    if (throwOnQueryError) throw new Error("Failed to fetch due scheduled jobs");
    console.error("[cron] Failed to fetch due jobs:", error.message);
    return;
  }

  if (!dueJobs || dueJobs.length === 0) {
    return;
  }

  console.log(`[cron] Found ${dueJobs.length} due job(s)`);

  for (const job of dueJobs) {
    try {
      if (job.job_type === "threads_auto_post") {
        const result = await runScheduledThreadsJob({
          supabase,
          userId: job.user_id,
          scheduledJobId: job.id,
          force: true,
        });
        if (result.summary.processedJobs === 0) {
          console.log(
            `[cron] Job ${job.id} for user ${job.user_id} skipped; it was already claimed or no longer active`
          );
        } else {
          console.log(`[cron] Job ${job.id} for user ${job.user_id} finished`, result.summary);
        }
        continue;
      }

      if (job.job_type === "content_auto_generate") {
        const claimedJob = await claimContentGenerationJob({
          supabase,
          userId: job.user_id,
          scheduledJobId: job.id,
        });

        if (!claimedJob) {
          console.log(
            `[cron] Job ${job.id} for user ${job.user_id} skipped; it was already claimed or no longer active`
          );
          continue;
        }

        const config = job.config && typeof job.config === "object" ? job.config : {};
        const generationResult = await generateContentOutputs({
          supabase,
          userId: job.user_id,
          payload: {
            personaConfigId: config.personaConfigId,
            contentPillarId: config.contentPillarId,
            topicIds: config.topicIds,
            targetCount: job.target_count,
            scheduledAt: job.schedule_value,
            scheduledJobId: job.id,
          },
        });
        const jobStatus = generationResult.status || "completed";
        const logPayload = {
          successCount: generationResult.summary?.successCount || 0,
          failedCount: generationResult.summary?.failedCount || 0,
          errors: generationResult.errors || [],
        };
        if (jobStatus === "completed_with_errors") {
          console.warn(
            `[cron] Job ${job.id} for user ${job.user_id} completed_with_errors`,
            logPayload
          );
        } else {
          console.log(`[cron] Job ${job.id} for user ${job.user_id} completed`, logPayload);
        }
        continue;
      }

      console.warn(`[cron] Unsupported job type ${job.job_type} for job ${job.id}`);
    } catch (err) {
      console.error(`[cron] Job ${job.id} for user ${job.user_id} failed:`, err.message);
      await supabase
        .from("scheduled_jobs")
        .update({
          status: "failed",
          last_run_status: "failed",
          last_run_error: err.message,
          error_message: err.message,
          last_run_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("user_id", job.user_id)
        .eq("status", "running");
    }
  }
}

function isCronJobEnabled(value = process.env.CRON_JOB) {
  return String(value || "").trim().toLowerCase() === "true";
}

function startCronJobs({
  enabled = isCronJobEnabled(),
  schedule = cron.schedule,
} = {}) {
  if (!enabled) {
    console.log("[cron] Scheduler disabled (set CRON_JOB=TRUE to enable)");
    return null;
  }

  // run every minute
  let running = false;
  const task = schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      await runDueScheduledJobs();
    } catch (err) {
      console.error("[cron] Unexpected error:", err.message);
    } finally {
      running = false;
    }
  });

  console.log("[cron] Scheduler started — checking due jobs every minute");
  return task;
}

module.exports = {
  isCronJobEnabled,
  runDueScheduledJobs,
  startCronJobs,
};
