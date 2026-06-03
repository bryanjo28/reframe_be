const threadsAccountsService = require("./threadsAccountsService");
const threadsAuthService = require("./threadsAuthService");
const scheduledJobsService = require("./scheduledJobsService");
const {
  createScheduledJobRun,
  updateScheduledJobRun,
} = require("./contentOutputsService");

const THREADS_API_BASE = "https://graph.threads.net";
const THREADS_API_VERSION = "v1.0";

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  url.search = searchParams.toString();
  return url.toString();
}

function normalizeRowValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isDraftStatus(status) {
  return normalizeRowValue(status).toLowerCase() === "draft";
}

function isApprovedStatus(status) {
  return normalizeRowValue(status).toLowerCase() === "approved";
}

function isThreadsPlatform(platform) {
  return normalizeRowValue(platform).toLowerCase() === "threads";
}

function isDueForPublish(row) {
  if (!row?.scheduled_at) {
    return true;
  }

  const scheduledAt = Date.parse(row.scheduled_at);
  if (Number.isNaN(scheduledAt)) {
    return true;
  }

  return scheduledAt <= Date.now();
}

function mapContentOutputRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    personaConfigId: row.persona_config_id,
    contentPillarId: row.content_pillar_id,
    topicId: row.topic_id,
    scheduledJobId: row.scheduled_job_id,
    scheduledJobRunId: row.scheduled_job_run_id,
    platform: row.platform,
    formatOutput: row.format_output,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    retryCount: row.retry_count,
    scheduledAt: row.scheduled_at,
    externalPostId: row.external_post_id,
  };
}

function mapPublishedPostRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    socialAccountId: row.social_account_id,
    contentOutputId: row.content_output_id,
    platform: row.platform,
    platformPostId: row.platform_post_id,
    postUrl: row.post_url,
    postedAt: row.posted_at,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

async function requestThreadsApi(path, { method = "GET", accessToken, params = {}, body = null } = {}) {
  const url = new URL(`${THREADS_API_BASE}/${THREADS_API_VERSION}/${path}`);
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  if (accessToken) {
    searchParams.set("access_token", accessToken);
  }

  url.search = searchParams.toString();

  const requestOptions = {
    method,
    headers: {
      Accept: "application/json",
    },
  };

  if (body) {
    requestOptions.headers["Content-Type"] = "application/x-www-form-urlencoded";
    requestOptions.body = new URLSearchParams(body).toString();
  }

  const response = await fetch(url.toString(), requestOptions);
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw createHttpError("Threads API returned invalid JSON", 502, { responseText: text });
    }
  }

  if (!response.ok) {
    throw createHttpError(
      `Threads API request failed with status ${response.status}`,
      response.status,
      data
    );
  }

  return data;
}

function getPublishedPostUrl({ username, postId, responseData }) {
  if (responseData?.permalink) {
    return responseData.permalink;
  }

  if (!username || !postId) {
    return null;
  }

  return `https://www.threads.net/@${username}/post/${postId}`;
}

async function ensureFreshThreadsAccount({ supabase, userId }) {
  const account = await threadsAccountsService.getThreadsAccount({ supabase, userId });

  if (!account) {
    throw createHttpError("Threads account not connected", 404);
  }

  if (!account.accessToken) {
    throw createHttpError("Threads access token is missing", 400);
  }

  if (!account.threadsId) {
    throw createHttpError("Threads account id is missing", 400);
  }

  if (!account.expiresAt) {
    return account;
  }

  const expiresAt = Date.parse(account.expiresAt);
  if (!Number.isNaN(expiresAt) && expiresAt > Date.now()) {
    return account;
  }

  if (!account.refreshToken) {
    return account;
  }

  const refreshedToken = await threadsAuthService.refreshLongLivedToken({
    accessToken: account.accessToken,
  });

  const activeAccessToken = refreshedToken.accessToken || account.accessToken;
  const activeRefreshToken = refreshedToken.refreshToken || account.refreshToken;
  const activeExpiresAt =
    refreshedToken.expiresIn && Number.isFinite(Number(refreshedToken.expiresIn))
      ? new Date(Date.now() + Number(refreshedToken.expiresIn) * 1000).toISOString()
      : account.expiresAt;

  return threadsAccountsService.saveThreadsAccount({
    supabase,
    userId,
    payload: {
      accessToken: activeAccessToken,
      accountId: account.accountId,
      threadsId: account.threadsId,
      refreshToken: activeRefreshToken,
      expiresAt: activeExpiresAt,
    },
  });
}

async function publishTextThread({ accessToken, threadsId, content, replyControl = "everyone" }) {
  if (!content || String(content).trim().length === 0) {
    throw createHttpError("Content is empty", 400);
  }

  if (String(content).length > 500) {
    content = String(content).slice(0, 500);
  }
  const creationResponse = await requestThreadsApi(`${threadsId}/threads`, {
    method: "POST",
    accessToken,
    params: {
      media_type: "TEXT",
      text: content,
      reply_control: replyControl,
    },
  });

  const creationId = creationResponse?.id || creationResponse?.creation_id;

  if (!creationId) {
    throw createHttpError("Threads API did not return a creation id", 502, creationResponse);
  }

  const publishResponse = await requestThreadsApi(`${threadsId}/threads_publish`, {
    method: "POST",
    accessToken,
    params: {
      creation_id: creationId,
    },
  });

  const platformPostId =
    publishResponse?.id || publishResponse?.post_id || publishResponse?.creation_id || creationId;

  return {
    creationId,
    platformPostId,
    rawCreationResponse: creationResponse,
    rawPublishResponse: publishResponse,
  };
}

async function getDraftContentOutputs({ supabase, userId, limit = 10, personaConfigId = null }) {
  const queryLimit = Number.isInteger(limit) ? limit : 10;

  let query = supabase
    .from("content_outputs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "approved")
    .ilike("platform", "threads")
    .order("scheduled_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(queryLimit > 0 ? queryLimit : 10);

  if (personaConfigId) {
    query = query.eq("persona_config_id", personaConfigId);
  }

  const { data, error } = await query;

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return (data || []).filter((row) => isDueForPublish(row));
}

async function scheduleApprovedContentOutputs({
  supabase,
  userId,
  personaConfigId,
  limit = 10,
  scheduledAt,
  contentOutputId = null,
}) {
  const queryLimit = Number.isInteger(limit) ? limit : 10;

  let query = supabase
    .from("content_outputs")
    .select("*")
    .eq("user_id", userId)
    .eq("persona_config_id", personaConfigId)
    .eq("status", "approved")
    .ilike("platform", "threads")
    .order("created_at", { ascending: true })
    .limit(queryLimit > 0 ? queryLimit : 10);

  if (contentOutputId) {
    query = query.eq("id", contentOutputId);
  }

  const { data, error } = await query;

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  const rows = data || [];

  // debug: log query params and result count to diagnose why rows are empty
  console.log("[scheduleApprovedContentOutputs] query params:", {
    userId,
    personaConfigId,
    scheduledAt,
    contentOutputId,
    queryLimit,
  });

  if (!rows.length) {
    // fetch without filters to see what actually exists
    const { data: debugData } = await supabase
      .from("content_outputs")
      .select("id, status, platform, scheduled_at, persona_config_id")
      .eq("user_id", userId)
      .limit(5);

    console.log("[scheduleApprovedContentOutputs] sample rows for this user:", debugData || []);

    return {
      scheduledJob: null,
      scheduledCount: 0,
      availableCount: 0,
      results: [],
    };
  }

  const scheduledJob = await scheduledJobsService.createScheduledJob({
    supabase,
    userId,
    payload: {
      personaConfigId,
      jobType: "threads_auto_post",
      config: {
        personaConfigId,
        limit: queryLimit,
        scheduledAt,
        contentOutputId,
      },
      targetCount: queryLimit,
      scheduleType: "once",
      scheduleValue: scheduledAt,
      nextRunAt: scheduledAt,
      status: "active",
    },
  });

  const results = [];

  for (const row of rows) {
    const { data: updatedRow, error: updateError } = await supabase
      .from("content_outputs")
      .update({
        scheduled_at: scheduledAt,
        scheduled_job_id: scheduledJob.id,
      })
      .eq("id", row.id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (updateError) {
      throw createHttpError(updateError.message, 400, updateError);
    }

    if (!updatedRow) {
      throw createHttpError("Failed to update content output schedule", 404);
    }

    results.push(mapContentOutputRow(updatedRow));
  }

  return {
    scheduledJob,
    scheduledCount: results.length,
    availableCount: rows.length,
    results,
  };
}

async function getDraftContentOutputById({ supabase, userId, contentOutputId }) {
  const { data, error } = await supabase
    .from("content_outputs")
    .select("*")
    .eq("id", contentOutputId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content output not found", 404);
  }

  if (!isApprovedStatus(data.status)) {
    throw createHttpError("Content output status must be approved", 400);
  }

  if (!isThreadsPlatform(data.platform)) {
    throw createHttpError("Content output platform must be Threads", 400);
  }

  if (!isDueForPublish(data)) {
    throw createHttpError("Content output is scheduled for later", 400);
  }

  return data;
}

async function getApprovedContentOutputById({
  supabase,
  userId,
  contentOutputId,
  personaConfigId = null,
}) {
  let query = supabase
    .from("content_outputs")
    .select("*")
    .eq("id", contentOutputId)
    .eq("user_id", userId)
    .eq("status", "approved")
    .ilike("platform", "threads");

  if (personaConfigId) {
    query = query.eq("persona_config_id", personaConfigId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  if (!data) {
    throw createHttpError("Content output not found", 404);
  }

  return data;
}

async function savePublishedPost({
  supabase,
  userId,
  socialAccountId,
  contentOutputId,
  platformPostId,
  postUrl,
}) {
  const { data, error } = await supabase
    .from("published_posts")
    .insert({
      user_id: userId,
      social_account_id: socialAccountId,
      content_output_id: contentOutputId,
      platform: "threads",
      platform_post_id: platformPostId,
      post_url: postUrl,
      posted_at: new Date().toISOString(),
      status: "success",
    })
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapPublishedPostRow(data);
}

async function markContentOutputFailed({ supabase, userId, contentOutputId }) {
  const { data, error } = await supabase
    .from("content_outputs")
    .update({
      status: "failed",
      external_post_id: null,
    })
    .eq("id", contentOutputId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapContentOutputRow(data);
}

async function markContentOutputPublished({
  supabase,
  userId,
  contentOutputId,
  platformPostId,
}) {
  const attempts = [
    { status: "posted", external_post_id: platformPostId },
    { external_post_id: platformPostId },
  ];

  let lastError = null;

  for (const updatePayload of attempts) {
    const { data, error } = await supabase
      .from("content_outputs")
      .update(updatePayload)
      .eq("id", contentOutputId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      return {
        contentOutput: mapContentOutputRow(data),
        warning: null,
      };
    }

    lastError = error;
  }

  return {
    contentOutput: null,
    warning: lastError ? lastError.message : "Failed to update content output after publish",
  };
}

async function publishSingleDraft({ supabase, userId, contentOutput }) {
  const account = await ensureFreshThreadsAccount({ supabase, userId });

  if (!contentOutput.content || String(contentOutput.content).trim().length === 0) {
    throw createHttpError("Content output content is empty", 400);
  }

  const publishResult = await publishTextThread({
    accessToken: account.accessToken,
    threadsId: account.threadsId,
    content: contentOutput.content,
  });

  const postUrl = getPublishedPostUrl({
    username: account.accountId,
    postId: publishResult.platformPostId,
    responseData: publishResult.rawPublishResponse,
  });

  let publishedPost = null;
  let warning = null;

  try {
    publishedPost = await savePublishedPost({
      supabase,
      userId,
      socialAccountId: account.id,
      contentOutputId: contentOutput.id,
      platformPostId: publishResult.platformPostId,
      postUrl,
    });
  } catch (error) {
    warning = error.message;
  }

  let contentOutputUpdate = {
    contentOutput: null,
    warning: null,
  };

  try {
    contentOutputUpdate = await markContentOutputPublished({
      supabase,
      userId,
      contentOutputId: contentOutput.id,
      platformPostId: publishResult.platformPostId,
    });
  } catch (error) {
    contentOutputUpdate = {
      contentOutput: null,
      warning: error.message,
    };
  }

  if (!warning && contentOutputUpdate.warning) {
    warning = contentOutputUpdate.warning;
  } else if (warning && contentOutputUpdate.warning) {
    warning = `${warning}; ${contentOutputUpdate.warning}`;
  }

  return {
    contentOutputId: contentOutput.id,
    contentOutput: contentOutputUpdate.contentOutput || mapContentOutputRow(contentOutput),
    publishedPost,
    creationId: publishResult.creationId,
    platformPostId: publishResult.platformPostId,
    postUrl,
    warning,
  };
}

async function autoPostThreadsDrafts({ supabase, userId, payload = {} }) {
  const input = {
    personaConfigId: payload.personaConfigId || payload.persona_config_id || null,
    contentOutputId: payload.contentOutputId || payload.content_output_id || null,
    limit:
      payload.limit === undefined || payload.limit === null || payload.limit === ""
        ? 10
        : Number(payload.limit),
    scheduledAt: payload.scheduledAt || payload.scheduled_at || null,
  };

  if (!input.scheduledAt) {
    throw createHttpError("Missing required field: scheduledAt", 400);
  }

  if (Number.isNaN(Date.parse(input.scheduledAt))) {
    throw createHttpError("scheduledAt must be a valid date-time string", 400);
  }

  if (input.contentOutputId) {
    const scheduledBatch = await scheduleApprovedContentOutputs({
      supabase,
      userId,
      personaConfigId: input.personaConfigId,
      limit: 1,
      scheduledAt: input.scheduledAt,
      contentOutputId: input.contentOutputId,
    });

    if (!scheduledBatch.results.length) {
      throw createHttpError("Content output not found or not eligible for scheduling", 404);
    }

    return {
      success: true,
      summary: {
        requestedCount: 1,
        availableCount: scheduledBatch.availableCount,
        scheduledCount: scheduledBatch.scheduledCount,
      },
      scheduledJob: scheduledBatch.scheduledJob,
      results: [
        {
          contentOutputId: scheduledBatch.results[0]?.id || input.contentOutputId,
          status: "scheduled",
          scheduledAt: scheduledBatch.results[0]?.scheduledAt || input.scheduledAt,
          contentOutput: scheduledBatch.results[0] || null,
        },
      ],
    };
  }

  if (!input.personaConfigId) {
    throw createHttpError("Missing required field: personaConfigId", 400);
  }

  const scheduledBatch = await scheduleApprovedContentOutputs({
    supabase,
    userId,
    personaConfigId: input.personaConfigId,
    limit: Number.isInteger(input.limit) ? input.limit : 10,
    scheduledAt: input.scheduledAt,
    contentOutputId: null,
  });

  return {
    success: true,
    summary: {
      requestedCount: Number.isInteger(input.limit) ? input.limit : 10,
      availableCount: scheduledBatch.availableCount,
      scheduledCount: scheduledBatch.scheduledCount,
    },
    scheduledJob: scheduledBatch.scheduledJob,
    results: scheduledBatch.results.map((contentOutput) => ({
      contentOutputId: contentOutput.id,
      status: "scheduled",
      scheduledAt: contentOutput.scheduledAt,
      contentOutput,
    })),
  };
}

async function runScheduledThreadsJob({ supabase, userId, scheduledJobId, limit = 20, force = false }) {
  const nowIso = new Date().toISOString();
  const queryLimit = Number.isInteger(limit) ? limit : 20;

  let jobQuery = supabase
    .from("scheduled_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("next_run_at", { ascending: true })
    .limit(queryLimit);

  if (!force) {
    jobQuery = jobQuery.lte("next_run_at", nowIso);
  }

  if (scheduledJobId) {
    jobQuery = jobQuery.eq("id", scheduledJobId);
  }

  const { data: jobs, error: jobsError } = await jobQuery;

  console.log("[runScheduledThreadsJob] params:", { userId, scheduledJobId, force, nowIso });

  if (jobsError) {
    throw createHttpError(jobsError.message, 400, jobsError);
  }

  const activeJobs = jobs || [];
  console.log("[runScheduledThreadsJob] active jobs found:", activeJobs.length, activeJobs.map(j => ({ id: j.id, status: j.status, next_run_at: j.next_run_at })));

  if (!activeJobs.length) {
    return {
      success: true,
      summary: {
        fetchedJobs: 0,
        processedJobs: 0,
        successCount: 0,
        failedCount: 0,
      },
      results: [],
    };
  }

  const results = [];
  let successCount = 0;
  let failedCount = 0;

  for (const scheduledJob of activeJobs) {
    const scheduledJobRun = await createScheduledJobRun({
      supabase,
      userId,
      payload: {
        scheduledJobId: scheduledJob.id,
        targetCount: scheduledJob.targetCount || queryLimit,
        runPayload: {
          scheduledJobId: scheduledJob.id,
          personaConfigId: scheduledJob.personaConfigId,
          scheduleType: scheduledJob.scheduleType,
          scheduleValue: scheduledJob.scheduleValue,
        },
      },
    });

    let dueQuery = supabase
      .from("content_outputs")
      .select("*")
      .eq("user_id", userId)
      .eq("scheduled_job_id", scheduledJob.id)
      .eq("status", "approved")
      .ilike("platform", "threads")
      .is("scheduled_job_run_id", null)
      .order("scheduled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(scheduledJob.targetCount || queryLimit);

    if (!force) {
      dueQuery = dueQuery.lte("scheduled_at", nowIso);
    }

    const { data: dueRows, error: dueError } = await dueQuery;

    console.log("[runScheduledThreadsJob] due content_outputs for job", scheduledJob.id, ":", (dueRows || []).length, (dueRows || []).map(r => ({ id: r.id, status: r.status, platform: r.platform, scheduled_at: r.scheduled_at, scheduled_job_run_id: r.scheduled_job_run_id })));

    if (dueError) {
      failedCount += 1;
      results.push({
        scheduledJobId: scheduledJob.id,
        status: "failed",
        error: dueError.message,
      });
      continue;
    }

    const jobResults = [];
    let jobSuccessCount = 0;
    let jobFailedCount = 0;

    for (const row of dueRows || []) {
      const { data: claimedRow, error: claimError } = await supabase
        .from("content_outputs")
        .update({
          scheduled_job_run_id: scheduledJobRun.id,
        })
        .eq("id", row.id)
        .eq("user_id", userId)
        .is("scheduled_job_run_id", null)
        .select("*")
        .maybeSingle();

      if (claimError) {
        jobFailedCount += 1;
        continue;
      }

      if (!claimedRow) {
        continue;
      }

      try {
        console.log("[runScheduledThreadsJob] publishing content_output:", claimedRow.id);
        const account = await ensureFreshThreadsAccount({ supabase, userId });
        console.log("[runScheduledThreadsJob] threads account:", { id: account.id, threadsId: account.threadsId, hasToken: !!account.accessToken });
        const publishResult = await publishTextThread({
          accessToken: account.accessToken,
          threadsId: account.threadsId,
          content: claimedRow.content,
        });

        const postUrl = getPublishedPostUrl({
          username: account.accountId,
          postId: publishResult.platformPostId,
          responseData: publishResult.rawPublishResponse,
        });

        await savePublishedPost({
          supabase,
          userId,
          socialAccountId: account.id,
          contentOutputId: claimedRow.id,
          platformPostId: publishResult.platformPostId,
          postUrl,
        });

        const { data: postedRow, error: postedUpdateError } = await supabase
          .from("content_outputs")
          .update({
            status: "posted",
            external_post_id: publishResult.platformPostId,
          })
          .eq("id", claimedRow.id)
          .eq("user_id", userId)
          .select("*")
          .maybeSingle();

        if (postedUpdateError) {
          throw createHttpError(postedUpdateError.message, 400, postedUpdateError);
        }

        console.log("[runScheduledThreadsJob] published successfully:", { contentOutputId: claimedRow.id, platformPostId: publishResult.platformPostId, postUrl });
        jobSuccessCount += 1;
        jobResults.push({
          contentOutputId: claimedRow.id,
          status: "success",
          contentOutput: mapContentOutputRow(postedRow),
          creationId: publishResult.creationId,
          platformPostId: publishResult.platformPostId,
          postUrl,
        });
      } catch (error) {
        console.error("[runScheduledThreadsJob] publish failed for content_output:", claimedRow.id, error.message, error.details || "");
        jobFailedCount += 1;

        await markContentOutputFailed({
          supabase,
          userId,
          contentOutputId: claimedRow.id,
        }).catch((markError) => {
          console.error("Failed to mark content output as failed:", markError.message);
        });

        jobResults.push({
          contentOutputId: claimedRow.id,
          status: "failed",
          error: error.message,
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const updatedRun = await updateScheduledJobRun({
      supabase,
      userId,
      id: scheduledJobRun.id,
      payload: {
        status: jobFailedCount > 0 ? "completed_with_errors" : "completed",
        fetchedCount: (dueRows || []).length,
        processedCount: jobResults.length,
        successCount: jobSuccessCount,
        failedCount: jobFailedCount,
        resultPayload: {
          scheduledJobId: scheduledJob.id,
          results: jobResults,
        },
        finishedAt,
      },
    });

    await supabase
      .from("scheduled_jobs")
      .update({
        last_run_at: finishedAt,
        next_run_at: null,
        last_run_status: jobFailedCount > 0 ? "completed_with_errors" : "completed",
        last_run_generated_count: jobSuccessCount,
        last_run_error: jobFailedCount > 0 ? "One or more posts failed during auto post" : null,
        error_message: jobFailedCount > 0 ? "One or more posts failed during auto post" : null,
        status: "completed",
      })
      .eq("id", scheduledJob.id)
      .eq("user_id", userId);

    successCount += jobSuccessCount;
    failedCount += jobFailedCount;
    results.push({
      scheduledJobId: scheduledJob.id,
      status: jobFailedCount > 0 ? "completed_with_errors" : "completed",
      scheduledJobRun: updatedRun || scheduledJobRun,
      results: jobResults,
    });
  }

  return {
    success: true,
    summary: {
      fetchedJobs: activeJobs.length,
      processedJobs: results.length,
      successCount,
      failedCount,
    },
    results,
  };
}

module.exports = {
  autoPostThreadsDrafts,
  getDraftContentOutputById,
  getDraftContentOutputs,
  publishSingleDraft,
  scheduleApprovedContentOutputs,
  runScheduledThreadsJob,
  publishTextThread,
  requestThreadsApi,
};
