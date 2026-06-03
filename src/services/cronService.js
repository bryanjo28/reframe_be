const cron = require("node-cron");
const { supabaseAdmin, isSupabaseAdminConfigured } = require("../config/supabase");
const { runScheduledThreadsJob } = require("./threadsPublishService");

async function runDueScheduledJobs() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    console.warn("[cron] Supabase admin not configured, skipping job run");
    return;
  }

  const nowIso = new Date().toISOString();

  const { data: dueJobs, error } = await supabaseAdmin
    .from("scheduled_jobs")
    .select("id, user_id")
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

  // group by user_id
  const byUser = {};
  for (const job of dueJobs) {
    if (!byUser[job.user_id]) byUser[job.user_id] = [];
    byUser[job.user_id].push(job.id);
  }

  for (const [userId, jobIds] of Object.entries(byUser)) {
    for (const scheduledJobId of jobIds) {
      try {
        await runScheduledThreadsJob({
          supabase: supabaseAdmin,
          userId,
          scheduledJobId,
          force: true,
        });
        console.log(`[cron] Job ${scheduledJobId} for user ${userId} completed`);
      } catch (err) {
        console.error(`[cron] Job ${scheduledJobId} for user ${userId} failed:`, err.message);
      }
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
