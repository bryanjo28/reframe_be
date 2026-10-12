const crypto = require("crypto");
const threadsConfig = require("../config/threads");
const supabaseConfig = require("../config/supabase");
const threadsTokenRepository = require("../repositories/threadsTokenRepository");

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getSecret() {
  if (!threadsConfig.appSecret) {
    throw httpError("THREADS_APP_SECRET is required for data deletion", 500);
  }
  return threadsConfig.appSecret;
}

function verifySignedRequest(signedRequest) {
  const secret = getSecret();
  if (typeof signedRequest !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(signedRequest)) {
    throw httpError("Invalid signed_request", 400);
  }
  const [signature, encodedPayload] = signedRequest.split(".");
  const actual = Buffer.from(signature, "base64url");
  const expected = crypto.createHmac("sha256", secret).update(encodedPayload).digest();
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw httpError("Invalid signed_request", 400);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw httpError("Invalid signed_request", 400);
  }
  if (!payload || payload.algorithm !== "HMAC-SHA256" || typeof payload.user_id !== "string" || !payload.user_id.trim()) {
    throw httpError("Invalid signed_request", 400);
  }
  return payload.user_id;
}

function signReceipt(nonce) {
  return crypto.createHmac("sha256", getSecret()).update(`threads-deletion-completed:${nonce}`).digest("hex");
}

function getDeletionStatus(code) {
  if (typeof code !== "string" || !/^[a-f0-9]{96}$/.test(code)) {
    throw httpError("Deletion confirmation not found", 404);
  }
  const nonce = code.slice(0, 32);
  if (!crypto.timingSafeEqual(Buffer.from(code.slice(32), "hex"), Buffer.from(signReceipt(nonce), "hex"))) {
    throw httpError("Deletion confirmation not found", 404);
  }
  return { confirmation_code: code, status: "completed" };
}

async function checked(query) {
  const { data, error } = await query;
  if (error) throw httpError("Failed to delete Threads data", 500);
  return data || [];
}

const PAGE_SIZE = 100;

async function readAll(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await checked(buildQuery().order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1));
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function forEachBatch(ids, action) {
  for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
    await action(ids.slice(offset, offset + PAGE_SIZE));
  }
}

async function deleteThreadsData(signedRequest) {
  const threadsUserId = verifySignedRequest(signedRequest);
  const supabase = supabaseConfig.supabaseAdmin;
  if (!supabase) throw httpError("SUPABASE_SERVICE_ROLE_KEY is required for data deletion", 500);

  const baseUrl = process.env.APP_BASE_URL;
  let statusUrl;
  try {
    statusUrl = new URL("/api/threads/delete/status/", baseUrl);
    if (!["https:", "http:"].includes(statusUrl.protocol)) throw new Error();
  } catch {
    throw httpError("APP_BASE_URL must be the public backend URL", 500);
  }

  const accounts = await readAll(() => supabase.from("social_accounts").select("id,user_id")
    .eq("platform", "threads").eq("platform_user_id", threadsUserId));
  if (accounts.length) {
    const accountIds = accounts.map((account) => account.id);
    const userIds = [...new Set(accounts.map((account) => account.user_id))];
    for (const userId of userIds) {
      const jobs = await readAll(() => supabase.from("scheduled_jobs").select("id")
        .eq("user_id", userId).eq("job_type", "threads_auto_post"));
      await forEachBatch(jobs.map((job) => job.id), async (jobIds) => {
        // Stop future claims before inspecting running jobs or clearing their results.
        await checked(supabase.from("scheduled_jobs").update({ status: "paused", next_run_at: null })
          .eq("user_id", userId).eq("status", "active").in("id", jobIds));
        const running = await checked(supabase.from("scheduled_jobs").select("id")
          .eq("user_id", userId).eq("status", "running").in("id", jobIds));
        if (running.length) {
          throw httpError("Threads publishing is still running; retry data deletion after it finishes", 503);
        }
        await checked(supabase.from("scheduled_job_runs").update({ result_payload: null, error_message: null })
          .eq("user_id", userId).in("scheduled_job_id", jobIds));
        await checked(supabase.from("scheduled_jobs").update({ last_run_error: null, error_message: null })
          .eq("user_id", userId).in("id", jobIds));
      });
    }
    // Keep account IDs until every dependent cleanup succeeds so retries retain their scope.
    await forEachBatch(accountIds, async (batch) => {
      const posts = await readAll(() => supabase.from("published_posts").select("id,content_output_id")
        .in("social_account_id", batch));
      const outputIds = [...new Set(posts.map((post) => post.content_output_id).filter(Boolean))];
      await forEachBatch(outputIds, async (ids) => {
        await checked(supabase.from("content_outputs").update({ external_post_id: null }).in("id", ids));
      });
    });
    await forEachBatch(accountIds, async (batch) => {
      await checked(supabase.from("published_posts").delete().in("social_account_id", batch));
    });
    await forEachBatch(accountIds, async (batch) => {
      await checked(supabase.from("social_accounts").delete().eq("platform", "threads")
        .eq("platform_user_id", threadsUserId).in("id", batch));
    });
  }
  await threadsTokenRepository.deleteByThreadsUserId(threadsUserId);

  // Issue a verifiable completion receipt only after every deletion succeeds.
  const nonce = crypto.randomBytes(16).toString("hex");
  const confirmationCode = nonce + signReceipt(nonce);
  statusUrl.pathname += confirmationCode;
  return { url: statusUrl.toString(), confirmation_code: confirmationCode };
}

module.exports = { deleteThreadsData, getDeletionStatus };
