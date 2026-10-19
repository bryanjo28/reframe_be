const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { runDueScheduledJobs } = require("../src/services/cronService");

async function main() {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/run-scheduled-jobs.js")], {
    env: { ...process.env, SUPABASE_URL: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required environment variables/);
  assert.doesNotMatch(result.stdout, /Server running/);

  for (const error of [null, { message: "database unavailable" }]) {
    const query = {
      select() { return this; },
      eq() { return this; },
      async lte() { return { data: [], error }; },
    };
    const run = () => runDueScheduledJobs({
      isConfigured: true,
      supabase: { from: () => query },
      throwOnQueryError: true,
    });
    if (error) await assert.rejects(run, /Failed to fetch due scheduled jobs/);
    else await run();
  }
  console.log("ok - cron CLI fails closed without credentials; empty runs finish and query failures propagate");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
