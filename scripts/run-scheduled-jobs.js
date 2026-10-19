const path = require("node:path");

async function main() {
  // Cron does not inherit Application Manager environment variables.
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

  const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const { runDueScheduledJobs } = require("../src/services/cronService");
  console.log(`[cron-once] Started ${new Date().toISOString()}`);
  await runDueScheduledJobs({ throwOnQueryError: true });
  console.log(`[cron-once] Finished ${new Date().toISOString()}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[cron-once] Failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
