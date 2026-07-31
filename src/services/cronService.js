const cron = require("node-cron");
const { supabaseAdmin, isSupabaseAdminConfigured } = require("../config/supabase");
const { runScheduledThreadsJob } = require("./threadsPublishService");
const { autoGenerateContentOutputs } = require("./contentOutputsService");

async function runDueScheduledJobs() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    console.warn("[cron] Supabase admin not configured, skipping job run");
    return;
  }

  const nowIso = new Date().toISOString();

  const { data: dueJobs, error } = await supabaseAdmin
    .from("scheduled_jobs")
    .select("id, user_id, job_type, config, target_count, schedule_value")
    .eq("status", "active")
    .lte("next_run_at", nowIso);

  if (error) {
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
        await runScheduledThreadsJob({
          supabase: supabaseAdmin,
          userId: job.user_id,
          scheduledJobId: job.id,
          force: true,
        });
        console.log(`[cron] Job ${job.id} for user ${job.user_id} completed`);
        continue;
      }

      if (job.job_type === "content_auto_generate") {
        const config = job.config && typeof job.config === "object" ? job.config : {};
        await autoGenerateContentOutputs({
          supabase: supabaseAdmin,
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
        console.log(`[cron] Job ${job.id} for user ${job.user_id} completed`);
        continue;
      }

      console.warn(`[cron] Unsupported job type ${job.job_type} for job ${job.id}`);
    } catch (err) {
      console.error(`[cron] Job ${job.id} for user ${job.user_id} failed:`, err.message);
    }
  }
}

function startCronJobs() {
  // run every minute
  cron.schedule("* * * * *", async () => {
    try {
      await runDueScheduledJobs();
    } catch (err) {
      console.error("[cron] Unexpected error:", err.message);
    }
  });

  console.log("[cron] Scheduler started — checking due jobs every minute");
}

module.exports = { startCronJobs };
