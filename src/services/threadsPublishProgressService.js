function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function databaseError(error) {
  const result = new Error(error.message);
  result.status = 400;
  result.details = error;
  return result;
}

function mapPublishedPostRow(row) {
  if (!row) return null;
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

async function loadThreadPublishProgress({ supabase, userId, contentOutputId }) {
  const { data, error } = await supabase
    .from("published_posts")
    .select("*")
    .eq("user_id", userId)
    .eq("content_output_id", contentOutputId)
    .order("sequence_number", { ascending: true });
  if (error) throw databaseError(error);
  return (data || []).map(mapPublishedPostRow);
}

function validateThreadResumeState({ rows, parts }) {
  const orderedRows = [...rows].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const completedRows = [];
  let unfinished = false;

  for (const row of orderedRows) {
    const expectedSequence = completedRows.length + (unfinished ? 2 : 1);
    if (
      !Number.isInteger(row.sequenceNumber) ||
      row.sequenceNumber !== expectedSequence ||
      row.sequenceNumber > parts.length
    ) {
      throw conflict("Threads sequence progress is not contiguous");
    }
    if (row.postContent !== parts[row.sequenceNumber - 1]) {
      throw conflict("Threads sequence content has changed");
    }

    const status = row.publishStatus ?? row.status;
    if (status === "uncertain") {
      throw conflict("Threads sequence publish result is uncertain");
    }
    if (status === "success") {
      if (unfinished || !row.platformPostId) {
        throw conflict("Threads successful sequence has invalid progress");
      }
      completedRows.push(row);
    } else if (status === "failed" || status === "processing") {
      if (unfinished || row.platformPostId) {
        throw conflict("Threads unfinished sequence has invalid progress");
      }
      unfinished = true;
    } else {
      throw conflict("Threads sequence has unknown publish status");
    }
  }

  return {
    completedRows,
    nextSequenceNumber: completedRows.length + 1,
    previousPlatformPostId: completedRows.at(-1)?.platformPostId || null,
    rootPlatformPostId: completedRows[0]?.platformPostId || null,
    complete: completedRows.length === parts.length,
  };
}

async function reserveThreadSequence({
  supabase, userId, account, contentOutput, sequenceNumber, content,
  parentPublishedPostId,
}) {
  const existingQuery = supabase.from("published_posts")
    .select("*")
    .eq("user_id", userId)
    .eq("content_output_id", contentOutput.id)
    .eq("sequence_number", sequenceNumber);
  const { data: existing, error: lookupError } = await existingQuery.maybeSingle();
  if (lookupError) throw databaseError(lookupError);

  const startedAt = new Date().toISOString();
  let query;
  if (existing) {
    const row = mapPublishedPostRow(existing);
    if (
      row.postContent !== content ||
      row.parentPublishedPostId !== (parentPublishedPostId ?? null) ||
      row.socialAccountId !== account.id ||
      (row.publishStatus !== "failed" && row.publishStatus !== "processing") ||
      row.platformPostId
    ) {
      throw conflict("Threads sequence cannot be safely reserved again");
    }
    if (row.publishStatus === "processing") return row;
    query = supabase.from("published_posts").update({
      status: "processing",
      error_message: null,
      platform_post_id: null,
      post_url: null,
      posted_at: null,
      creation_id: null,
      publish_status: "processing",
      publish_error_message: null,
      publish_started_at: startedAt,
      publish_finished_at: null,
    })
      .eq("id", row.id)
      .eq("user_id", userId)
      .eq("publish_status", "failed");
  } else {
    query = supabase.from("published_posts").insert({
      user_id: userId,
      social_account_id: account.id,
      content_output_id: contentOutput.id,
      platform: "threads",
      platform_post_id: null,
      post_url: null,
      posted_at: null,
      status: "processing",
      error_message: null,
      parent_published_post_id: parentPublishedPostId ?? null,
      sequence_number: sequenceNumber,
      post_content: content,
      creation_id: null,
      publish_status: "processing",
      publish_error_message: null,
      publish_started_at: startedAt,
      publish_finished_at: null,
    });
  }
  const { data, error } = await query.select("*").single();
  if (error?.code === "23505") {
    throw conflict("Threads sequence was reserved by another publish run");
  }
  if (error) throw databaseError(error);
  if (!data) throw conflict("Threads sequence reservation was not persisted");
  return mapPublishedPostRow(data);
}

async function updateOwnedPost({ supabase, userId, publishedPostId, payload }) {
  const { data, error } = await supabase.from("published_posts")
    .update(payload)
    .eq("id", publishedPostId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw conflict("Threads sequence progress row was not updated");
  return mapPublishedPostRow(data);
}

function recordThreadContainer({ supabase, userId, publishedPostId, creationId }) {
  return updateOwnedPost({
    supabase, userId, publishedPostId,
    payload: { creation_id: creationId },
  });
}

async function markThreadSequenceSuccess({
  supabase, userId, publishedPostId, platformPostId, postUrl,
}) {
  if (!platformPostId) {
    throw conflict("Threads publish response did not confirm a platform post ID");
  }
  const finishedAt = new Date().toISOString();
  return updateOwnedPost({
    supabase, userId, publishedPostId,
    payload: {
      platform_post_id: platformPostId,
      post_url: postUrl,
      posted_at: finishedAt,
      status: "success",
      error_message: null,
      publish_status: "success",
      publish_error_message: null,
      publish_finished_at: finishedAt,
    },
  });
}

function markThreadSequenceFailure({
  supabase, userId, publishedPostId, status, errorMessage,
}) {
  if (status !== "failed" && status !== "uncertain") {
    const error = new Error("Invalid Threads publish failure status");
    error.status = 400;
    throw error;
  }
  return updateOwnedPost({
    supabase, userId, publishedPostId,
    payload: {
      status,
      error_message: errorMessage,
      publish_status: status,
      publish_error_message: errorMessage,
      publish_finished_at: new Date().toISOString(),
    },
  });
}

module.exports = {
  loadThreadPublishProgress,
  validateThreadResumeState,
  reserveThreadSequence,
  recordThreadContainer,
  markThreadSequenceSuccess,
  markThreadSequenceFailure,
};
