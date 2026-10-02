const threadsAccountsService = require("./threadsAccountsService");
const threadsAuthService = require("./threadsAuthService");
const scheduledJobsService = require("./scheduledJobsService");
const { performance } = require("node:perf_hooks");
const {
  createScheduledJobRun,
  parseThreadParts,
  updateScheduledJobRun,
} = require("./contentOutputsService");
const {
  loadThreadPublishProgress,
  markThreadSequenceFailure,
  markThreadSequenceSuccess,
  recordThreadContainer,
  reserveThreadSequence,
  validateThreadResumeState,
} = require("./threadsPublishProgressService");

const THREADS_API_BASE = "https://graph.threads.net";
const THREADS_API_VERSION = "v1.0";
const THREADS_POST_INTERVAL_MS = Math.max(
  0,
  Number.parseInt(process.env.THREADS_POST_INTERVAL_MS || "2000", 10) || 0
);

function getPositiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const THREADS_CONTAINER_POLL_INTERVAL_MS = getPositiveIntegerEnv(
  "THREADS_CONTAINER_POLL_INTERVAL_MS",
  5000
);
const THREADS_CONTAINER_MAX_WAIT_MS = getPositiveIntegerEnv(
  "THREADS_CONTAINER_MAX_WAIT_MS",
  60000
);

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
    publishScheduledJobId: row.publish_scheduled_job_id,
    publishScheduledJobRunId: row.publish_scheduled_job_run_id,
    platform: row.platform,
    threadType: row.thread_type || "short",
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
    parentPublishedPostId: row.parent_published_post_id,
    sequenceNumber: row.sequence_number,
    postContent: row.post_content,
    createdAt: row.created_at,
    creationId: row.creation_id,
    publishStatus: row.publish_status,
    publishErrorMessage: row.publish_error_message,
    publishStartedAt: row.publish_started_at,
    publishFinishedAt: row.publish_finished_at,
  };
}

function normalizeScheduledJobRow(row) {
  if (!row) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(row, "targetCount")) {
    return row;
  }

  return scheduledJobsService.mapScheduledJobRow(row);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestThreadsApi(
  path,
  { method = "GET", accessToken, params = {}, body = null, signal } = {}
) {
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
    signal,
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

async function waitForThreadsContainerReady({
  accessToken,
  creationId,
  pollIntervalMs = THREADS_CONTAINER_POLL_INTERVAL_MS,
  maxWaitMs = THREADS_CONTAINER_MAX_WAIT_MS,
  requestApi = requestThreadsApi,
  sleepFn = sleep,
  nowFn = () => performance.now(),
}) {
  const resolvedPollIntervalMs = Math.max(1, Number(pollIntervalMs) || 1);
  const resolvedMaxWaitMs = Math.max(1, Number(maxWaitMs) || 1);
  const startedAt = nowFn();
  let lastStatus = null;

  function throwTimeout() {
    console.error("[Threads Container] timeout", {
      creationId,
      maxWaitMs: resolvedMaxWaitMs,
      lastStatus,
    });
    throw createHttpError(
      `Threads container processing timed out after ${resolvedMaxWaitMs} ms`,
      504,
      { creationId, lastStatus }
    );
  }

  console.log("[Threads Container] waiting", {
    creationId,
    maxWaitMs: resolvedMaxWaitMs,
  });

  while (nowFn() - startedAt < resolvedMaxWaitMs) {
    const remainingBeforeRequestMs = resolvedMaxWaitMs - (nowFn() - startedAt);
    const abortController = new AbortController();
    const abortTimer = setTimeout(
      () => abortController.abort(),
      Math.max(1, Math.ceil(remainingBeforeRequestMs))
    );
    let statusResponse;

    try {
      statusResponse = await requestApi(creationId, {
        method: "GET",
        accessToken,
        params: { fields: "id,status,error_message" },
        signal: abortController.signal,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        throwTimeout();
      }
      throw error;
    } finally {
      clearTimeout(abortTimer);
    }

    const status = String(statusResponse?.status || "").trim().toUpperCase();
    lastStatus = status || null;

    console.log("[Threads Container] status", {
      creationId,
      status: lastStatus || "UNKNOWN",
      elapsedMs: Math.round(nowFn() - startedAt),
    });

    if (status === "FINISHED") {
      console.log("[Threads Container] ready", { creationId });
      return statusResponse;
    }

    if (status === "ERROR") {
      const apiMessage = statusResponse?.error_message;
      throw createHttpError(
        `Threads container processing failed${apiMessage ? `: ${apiMessage}` : ""}`,
        502,
        statusResponse
      );
    }

    if (status === "EXPIRED") {
      const apiMessage = statusResponse?.error_message;
      throw createHttpError(
        `Threads container expired${apiMessage ? `: ${apiMessage}` : ""}`,
        502,
        statusResponse
      );
    }

    if (status === "PUBLISHED") {
      throw createHttpError(
        "Threads container has already been published",
        409,
        statusResponse
      );
    }

    const elapsedMs = nowFn() - startedAt;
    const remainingMs = resolvedMaxWaitMs - elapsedMs;

    if (remainingMs <= 0) {
      break;
    }

    await sleepFn(Math.min(resolvedPollIntervalMs, remainingMs));
  }

  throwTimeout();
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

async function publishTextThread({
  accessToken,
  threadsId,
  content,
  replyToId = null,
  replyControl = "everyone",
  creationId: existingCreationId = null,
  requestApi = requestThreadsApi,
  onContainerCreated,
  onPublishStarted,
  pollIntervalMs = THREADS_CONTAINER_POLL_INTERVAL_MS,
  maxWaitMs = THREADS_CONTAINER_MAX_WAIT_MS,
  sleepFn = sleep,
  nowFn = () => performance.now(),
}) {
  if (!content || String(content).trim().length === 0) {
    throw createHttpError("Content is empty", 400);
  }

  if (String(content).length > 500) {
    throw createHttpError(
      "Each Threads post must not exceed 500 characters",
      400
    );
  }
  let creationResponse = null;
  let creationId = existingCreationId;

  if (!creationId) {
    creationResponse = await requestApi(`${threadsId}/threads`, {
      method: "POST",
      accessToken,
      params: {
        media_type: "TEXT",
        text: content,
        reply_control: replyControl,
        reply_to_id: replyToId,
      },
    });

    creationId = creationResponse?.id || creationResponse?.creation_id;
  }

  if (!creationId) {
    throw createHttpError("Threads API did not return a creation id", 502, creationResponse);
  }

  if (!existingCreationId && onContainerCreated) {
    await onContainerCreated({ creationId, rawCreationResponse: creationResponse });
  }

  await waitForThreadsContainerReady({
    accessToken,
    creationId,
    pollIntervalMs,
    maxWaitMs,
    requestApi,
    sleepFn,
    nowFn,
  });

  if (onPublishStarted) {
    await onPublishStarted({ creationId });
  }

  const publishResponse = await requestApi(`${threadsId}/threads_publish`, {
    method: "POST",
    accessToken,
    params: {
      creation_id: creationId,
    },
  });

  const platformPostId = publishResponse?.id || publishResponse?.post_id;

  if (!platformPostId) {
    throw createHttpError("Threads API did not return a post id", 502, publishResponse);
  }

  return {
    creationId,
    platformPostId,
    rawCreationResponse: creationResponse,
    rawPublishResponse: publishResponse,
  };
}

async function publishThreadChain({
  accessToken,
  threadsId,
  content,
  threadType = "short",
  replyControl = "everyone",
  publishPart = publishTextThread,
  onPartPublished = null,
}) {
  const threadParts = parseThreadParts(content, threadType);
  const publishedParts = [];
  let previousPlatformPostId = null;

  console.log("[Threads Chain] started", {
    threadType,
    totalParts: threadParts.length,
  });

  for (const [index, part] of threadParts.entries()) {
    const replyToId = previousPlatformPostId;
    const sequenceNumber = index + 1;
    console.log("[Threads Chain] sequence started", {
      sequenceNumber,
      totalParts: threadParts.length,
      replyToId,
    });

    let publishResult;
    try {
      publishResult = await publishPart({
        accessToken,
        threadsId,
        content: part,
        replyToId,
        replyControl,
      });
    } catch (error) {
      console.error("[Threads Chain] sequence failed", {
        sequenceNumber,
        totalParts: threadParts.length,
        error: error.message,
      });
      throw error;
    }

    console.log("[Threads Chain] sequence published", {
      sequenceNumber,
      totalParts: threadParts.length,
      platformPostId: publishResult.platformPostId,
      replyToId,
    });

    const publishedPart = {
      sequenceNumber,
      content: part,
      replyToId,
      ...publishResult,
    };

    if (onPartPublished) {
      await onPartPublished(publishedPart);
    }

    publishedParts.push(publishedPart);
    previousPlatformPostId = publishResult.platformPostId;
  }

  console.log("[Threads Chain] completed", {
    rootPlatformPostId: publishedParts[0].platformPostId,
    publishedCount: publishedParts.length,
  });

  return {
    rootPlatformPostId: publishedParts[0].platformPostId,
    parts: publishedParts,
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
    .eq("status", "approved")
    .ilike("platform", "threads")
    .order("created_at", { ascending: true })
    .limit(queryLimit > 0 ? queryLimit : 10);

  if (personaConfigId) {
    query = query.eq("persona_config_id", personaConfigId);
  }

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
        scheduledAt,
        contentOutputId,
      },
      targetCount: queryLimit,
      scheduleType: "once",
      scheduleValue: scheduledAt,
      nextRunAt: null,
      status: "inactive",
    },
  });

  const results = [];

  for (const row of rows) {
    const { data: updatedRow, error: updateError } = await supabase
      .from("content_outputs")
      .update({
        scheduled_at: scheduledAt,
        publish_scheduled_job_id: scheduledJob.id,
        publish_scheduled_job_run_id: null,
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

  const activatedJob = await scheduledJobsService.updateScheduledJob({
    supabase,
    userId,
    id: scheduledJob.id,
    payload: {
      nextRunAt: scheduledAt,
      status: "active",
    },
  });

  return {
    scheduledJob: activatedJob || scheduledJob,
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
  parentPublishedPostId = null,
  sequenceNumber = 1,
  postContent = null,
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
      parent_published_post_id: parentPublishedPostId,
      sequence_number: sequenceNumber,
      post_content: postContent,
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

async function publishAndPersistThreadChain({
  supabase,
  userId,
  account,
  contentOutput,
  publishPart = publishTextThread,
  assertLeaseOwnership = async () => {},
}) {
  const threadType = contentOutput.threadType || contentOutput.thread_type || "short";
  const parts = parseThreadParts(contentOutput.content, threadType);
  const storedRows = await loadThreadPublishProgress({
    supabase,
    userId,
    contentOutputId: contentOutput.id,
  });
  const resumeState = validateThreadResumeState({ rows: storedRows, parts });
  const publishedPosts = [...resumeState.completedRows];
  const publishedParts = resumeState.completedRows.map((row) => ({
    sequenceNumber: row.sequenceNumber,
    content: row.postContent,
    replyToId: null,
    creationId: row.creationId,
    platformPostId: row.platformPostId,
  }));
  let previousPublishedPost = publishedPosts.at(-1) || null;
  let previousPlatformPostId = resumeState.previousPlatformPostId;

  console.log("[Threads Chain] resumed", {
    contentOutputId: contentOutput.id,
    completedCount: publishedPosts.length,
    totalParts: parts.length,
  });

  for (let index = resumeState.nextSequenceNumber - 1; index < parts.length; index += 1) {
    const sequenceNumber = index + 1;
    const content = parts[index];
    await assertLeaseOwnership();

    let progressRow = await reserveThreadSequence({
      supabase,
      userId,
      account,
      contentOutput,
      sequenceNumber,
      content,
      parentPublishedPostId: previousPublishedPost?.id || null,
    });
    let publishStarted = false;

    console.log("[Threads Chain] sequence reserved", {
      contentOutputId: contentOutput.id,
      sequenceNumber,
      publishedPostId: progressRow.id,
    });

    try {
      const publishResult = await publishPart({
        accessToken: account.accessToken,
        threadsId: account.threadsId,
        content,
        replyToId: previousPlatformPostId,
        creationId: progressRow.creationId,
        onContainerCreated: async ({ creationId }) => {
          progressRow = await recordThreadContainer({
            supabase,
            userId,
            publishedPostId: progressRow.id,
            creationId,
          });
          console.log("[Threads Chain] container persisted", {
            contentOutputId: contentOutput.id,
            sequenceNumber,
            creationId,
          });
        },
        onPublishStarted: async () => {
          await assertLeaseOwnership();
          progressRow = await markThreadSequenceFailure({
            supabase,
            userId,
            publishedPostId: progressRow.id,
            status: "uncertain",
            errorMessage: "Threads publish request started; awaiting confirmation",
          });
          publishStarted = true;
        },
      });
      const postUrl = getPublishedPostUrl({
        username: account.accountId,
        postId: publishResult.platformPostId,
        responseData: publishResult.rawPublishResponse,
      });
      progressRow = await markThreadSequenceSuccess({
        supabase,
        userId,
        publishedPostId: progressRow.id,
        platformPostId: publishResult.platformPostId,
        postUrl,
      });

      publishedPosts.push(progressRow);
      publishedParts.push({
        sequenceNumber,
        content,
        replyToId: previousPlatformPostId,
        ...publishResult,
      });
      previousPublishedPost = progressRow;
      previousPlatformPostId = progressRow.platformPostId;

      console.log("[Threads Chain] sequence persisted", {
        contentOutputId: contentOutput.id,
        sequenceNumber,
        platformPostId: progressRow.platformPostId,
        publishedPostId: progressRow.id,
      });
    } catch (error) {
      const failureStatus = publishStarted ? "uncertain" : "failed";
      try {
        await markThreadSequenceFailure({
          supabase,
          userId,
          publishedPostId: progressRow.id,
          status: failureStatus,
          errorMessage: error.message,
        });
      } catch (persistenceError) {
        if (failureStatus !== "uncertain") throw persistenceError;
      }
      if (failureStatus === "uncertain") {
        console.error("[Threads Chain] uncertain", {
          contentOutputId: contentOutput.id,
          sequenceNumber,
          error: error.message,
        });
      }
      throw error;
    }
  }

  console.log("[Threads Chain] completed", {
    rootPlatformPostId: publishedPosts[0].platformPostId,
    publishedCount: publishedPosts.length,
  });

  return {
    rootPlatformPostId: publishedPosts[0].platformPostId,
    parts: publishedParts,
    publishedPosts,
    rootPublishedPost: publishedPosts[0] || null,
  };
}

async function markContentOutputFailed({ supabase, userId, contentOutputId }) {
  const { data, error } = await supabase
    .from("content_outputs")
    .update({
      status: "failed",
      external_post_id: null,
      publish_scheduled_job_run_id: null,
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

  const publication = await publishAndPersistThreadChain({
    supabase,
    userId,
    account,
    contentOutput,
  });
  const rootPart = publication.parts[0];
  const publishedPost = publication.rootPublishedPost;
  const postUrl = publishedPost?.postUrl || null;
  let warning = null;

  let contentOutputUpdate = {
    contentOutput: null,
    warning: null,
  };

  try {
    contentOutputUpdate = await markContentOutputPublished({
      supabase,
      userId,
      contentOutputId: contentOutput.id,
      platformPostId: publication.rootPlatformPostId,
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
    publishedPosts: publication.publishedPosts,
    creationId: rootPart.creationId,
    platformPostId: publication.rootPlatformPostId,
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

async function retryFailedThreadsPost({ supabase, userId, payload = {} }) {
  const input = {
    contentOutputId: payload.contentOutputId || payload.content_output_id || null,
    scheduledAt: payload.scheduledAt || payload.scheduled_at || new Date().toISOString(),
  };

  if (!input.contentOutputId) {
    throw createHttpError("Missing required field: contentOutputId", 400);
  }

  if (Number.isNaN(Date.parse(input.scheduledAt))) {
    throw createHttpError("scheduledAt must be a valid date-time string", 400);
  }

  const { data: existingContentOutput, error: existingError } = await supabase
    .from("content_outputs")
    .select("*")
    .eq("id", input.contentOutputId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw createHttpError(existingError.message, 400, existingError);
  }

  if (!existingContentOutput) {
    throw createHttpError("Content output not found", 404);
  }

  if (!isThreadsPlatform(existingContentOutput.platform)) {
    throw createHttpError("Content output platform must be Threads", 400);
  }

  if (normalizeRowValue(existingContentOutput.status).toLowerCase() === "posted") {
    throw createHttpError("Posted content cannot be retried", 409);
  }

  if (normalizeRowValue(existingContentOutput.status).toLowerCase() !== "failed") {
    throw createHttpError("Only failed content output can be retried", 409);
  }

  const { data: resetRow, error: resetError } = await supabase
    .from("content_outputs")
    .update({
      status: "approved",
      external_post_id: null,
      publish_scheduled_job_id: null,
      publish_scheduled_job_run_id: null,
      scheduled_at: null,
      retry_count: (Number(existingContentOutput.retry_count) || 0) + 1,
    })
    .eq("id", input.contentOutputId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (resetError) {
    throw createHttpError(resetError.message, 400, resetError);
  }

  if (!resetRow) {
    throw createHttpError("Failed to prepare content output for retry", 404);
  }

  const scheduledBatch = await scheduleApprovedContentOutputs({
    supabase,
    userId,
    personaConfigId: resetRow.persona_config_id,
    limit: 1,
    scheduledAt: input.scheduledAt,
    contentOutputId: resetRow.id,
  });

  if (!scheduledBatch.results.length) {
    throw createHttpError("Failed to schedule retry for content output", 500);
  }

  return {
    retried: true,
    contentOutputId: resetRow.id,
    scheduledAt: scheduledBatch.results[0]?.scheduledAt || input.scheduledAt,
    scheduledJob: scheduledBatch.scheduledJob,
    contentOutput: scheduledBatch.results[0] || mapContentOutputRow(resetRow),
  };
}

async function claimScheduledThreadsJob({ supabase, userId, scheduledJobId }) {
  const { data, error } = await supabase
    .from("scheduled_jobs")
    .update({ status: "running" })
    .eq("id", scheduledJobId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return normalizeScheduledJobRow(data);
}

async function runScheduledThreadsJob({ supabase, userId, scheduledJobId, limit = 20, force = false }) {
  const nowIso = new Date().toISOString();
  const jobsFetchLimit = Number.isInteger(limit) ? limit : 20;

  let jobQuery = supabase
    .from("scheduled_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("next_run_at", { ascending: true })
    .limit(jobsFetchLimit);

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

  const activeJobs = (jobs || []).map(normalizeScheduledJobRow).filter(Boolean);
  console.log(
    "[runScheduledThreadsJob] active jobs found:",
    activeJobs.length,
    activeJobs.map((j) => ({
      id: j.id,
      status: j.status,
      nextRunAt: j.nextRunAt,
      targetCount: j.targetCount,
      jobType: j.jobType,
    }))
  );

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
  let skippedCount = 0;

  for (const candidateJob of activeJobs) {
    const scheduledJob = await claimScheduledThreadsJob({
      supabase,
      userId,
      scheduledJobId: candidateJob.id,
    });

    if (!scheduledJob) {
      skippedCount += 1;
      console.log("[runScheduledThreadsJob] skipped job already claimed", {
        scheduledJobId: candidateJob.id,
        userId,
      });
      continue;
    }

    console.log("[runScheduledThreadsJob] claimed job", {
      scheduledJobId: scheduledJob.id,
      status: scheduledJob.status,
    });

    const scheduledJobRun = await createScheduledJobRun({
      supabase,
      userId,
      payload: {
        scheduledJobId: scheduledJob.id,
        targetCount: scheduledJob.targetCount,
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
      .eq("publish_scheduled_job_id", scheduledJob.id)
      .eq("status", "approved")
      .ilike("platform", "threads")
      .is("publish_scheduled_job_run_id", null)
      .order("scheduled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(
        Number.isInteger(scheduledJob.targetCount) && scheduledJob.targetCount > 0
          ? scheduledJob.targetCount
          : 10
      );

    if (!force) {
      dueQuery = dueQuery.lte("scheduled_at", nowIso);
    }

    const { data: dueRows, error: dueError } = await dueQuery;

    console.log(
      "[runScheduledThreadsJob] due content_outputs for job",
      scheduledJob.id,
      ":",
      (dueRows || []).length,
      (dueRows || []).map((r) => ({
        id: r.id,
        status: r.status,
        platform: r.platform,
        scheduled_at: r.scheduled_at,
        publish_scheduled_job_id: r.publish_scheduled_job_id,
        publish_scheduled_job_run_id: r.publish_scheduled_job_run_id,
      }))
    );

    if (!dueError && (!dueRows || dueRows.length === 0)) {
      const { data: linkedRows, error: linkedRowsError } = await supabase
        .from("content_outputs")
        .select("id, status, platform, scheduled_at, publish_scheduled_job_id, publish_scheduled_job_run_id")
        .eq("user_id", userId)
        .eq("publish_scheduled_job_id", scheduledJob.id)
        .order("created_at", { ascending: true })
        .limit(10);

      const { data: userRows, error: userRowsError } = await supabase
        .from("content_outputs")
        .select("id, status, platform, scheduled_at, publish_scheduled_job_id, publish_scheduled_job_run_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      console.log("[runScheduledThreadsJob] debug linked content_outputs:", {
        scheduledJobId: scheduledJob.id,
        linkedRowsError: linkedRowsError?.message || null,
        linkedRows: linkedRows || [],
      });

      console.log("[runScheduledThreadsJob] debug recent user content_outputs:", {
        userId,
        userRowsError: userRowsError?.message || null,
        userRows: userRows || [],
      });
    }

    if (dueError) {
      failedCount += 1;
      const finishedAt = new Date().toISOString();
      await updateScheduledJobRun({
        supabase,
        userId,
        id: scheduledJobRun.id,
        payload: {
          status: "failed",
          failedCount: 1,
          errorMessage: dueError.message,
          finishedAt,
        },
      });
      await supabase
        .from("scheduled_jobs")
        .update({
          status: "failed",
          last_run_at: finishedAt,
          last_run_status: "failed",
          last_run_error: dueError.message,
          error_message: dueError.message,
        })
        .eq("id", scheduledJob.id)
        .eq("user_id", userId);
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
          publish_scheduled_job_run_id: scheduledJobRun.id,
        })
        .eq("id", row.id)
        .eq("user_id", userId)
        .is("publish_scheduled_job_run_id", null)
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
        const publication = await publishAndPersistThreadChain({
          supabase,
          userId,
          account,
          contentOutput: claimedRow,
        });
        const rootPart = publication.parts[0];
        const postUrl = publication.rootPublishedPost?.postUrl || null;

        const { data: postedRow, error: postedUpdateError } = await supabase
          .from("content_outputs")
          .update({
            status: "posted",
            external_post_id: publication.rootPlatformPostId,
          })
          .eq("id", claimedRow.id)
          .eq("user_id", userId)
          .select("*")
          .maybeSingle();

        if (postedUpdateError) {
          throw createHttpError(postedUpdateError.message, 400, postedUpdateError);
        }

        console.log("[runScheduledThreadsJob] published successfully:", { contentOutputId: claimedRow.id, platformPostId: publication.rootPlatformPostId, postUrl });
        jobSuccessCount += 1;
        jobResults.push({
          contentOutputId: claimedRow.id,
          status: "success",
          contentOutput: mapContentOutputRow(postedRow),
          creationId: rootPart.creationId,
          platformPostId: publication.rootPlatformPostId,
          postUrl,
          publishedPosts: publication.publishedPosts,
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
      } finally {
        if (THREADS_POST_INTERVAL_MS > 0) {
          await sleep(THREADS_POST_INTERVAL_MS);
        }
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
        skippedCount,
    },
    results,
  };
}

module.exports = {
  autoPostThreadsDrafts,
  getDraftContentOutputById,
  getDraftContentOutputs,
  publishSingleDraft,
  retryFailedThreadsPost,
  scheduleApprovedContentOutputs,
  runScheduledThreadsJob,
  claimScheduledThreadsJob,
  publishTextThread,
  publishThreadChain,
  publishAndPersistThreadChain,
  savePublishedPost,
  requestThreadsApi,
  waitForThreadsContainerReady,
};
