const { isSupabaseConfigured } = require("../config/supabase");

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

function getSource(payload) {
  return payload && typeof payload === "object" ? payload : {};
}

function hasKey(source, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function readOptionalText(source, keys) {
  if (!hasKey(source, keys)) {
    return undefined;
  }

  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
  const value = source[matchedKey];

  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeThreadsAccountPayload(payload = {}) {
  const source = getSource(payload);

  return {
    accessToken: readOptionalText(source, ["accessToken", "access_token"]),
    accountId: readOptionalText(source, ["accountId", "account_id", "username"]),
    threadsId: readOptionalText(source, ["threadsId", "threads_id", "platformUserId"]),
    refreshToken: readOptionalText(source, ["refreshToken", "refresh_token"]),
    expiresAt: readOptionalText(source, ["expiresAt", "expires_at"]),
  };
}

function assertCreateThreadsAccountPayload(payload) {
  if (!payload.accessToken || payload.accessToken.length === 0) {
    throw createHttpError("Missing required field: accessToken", 400);
  }

  if (!payload.accountId || payload.accountId.length === 0) {
    throw createHttpError("Missing required field: accountId", 400);
  }

  if (!payload.threadsId || payload.threadsId.length === 0) {
    throw createHttpError("Missing required field: threadsId", 400);
  }
}

function mapThreadsAccountRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    threadsId: row.platform_user_id,
    accountId: row.username,
    createdAt: row.created_at,
  };
}

function buildInsertPayload({ userId, input }) {
  const payload = {
    user_id: userId,
    platform: "threads",
    access_token: input.accessToken,
    platform_user_id: input.threadsId,
    username: input.accountId,
  };

  if (input.refreshToken !== undefined) {
    payload.refresh_token = input.refreshToken;
  }

  if (input.expiresAt !== undefined) {
    payload.expires_at = input.expiresAt;
  }

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {
    access_token: input.accessToken,
    platform: "threads",
    platform_user_id: input.threadsId,
    username: input.accountId,
  };

  if (input.refreshToken !== undefined) {
    payload.refresh_token = input.refreshToken;
  }

  if (input.expiresAt !== undefined) {
    payload.expires_at = input.expiresAt;
  }

  return payload;
}

async function saveThreadsAccount({ supabase, userId, payload }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeThreadsAccountPayload(payload);
  assertCreateThreadsAccountPayload(input);

  const { data: existingAccount, error: existingError } = await supabase
    .from("social_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "threads")
    .maybeSingle();

  if (existingError) {
    throw createHttpError(existingError.message, 500, existingError);
  }

  if (existingAccount) {
    const { data, error } = await supabase
      .from("social_accounts")
      .update(buildUpdatePayload(input))
      .eq("id", existingAccount.id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      throw createHttpError(error.message, 400, error);
    }

    return mapThreadsAccountRow(data);
  }

  const { data, error } = await supabase
    .from("social_accounts")
    .insert(buildInsertPayload({ userId, input }))
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapThreadsAccountRow(data);
}

async function getThreadsAccount({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const { data, error } = await supabase
    .from("social_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "threads")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return mapThreadsAccountRow(data);
}

async function disconnectThreadsAccount({ supabase, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const existingAccount = await getThreadsAccount({ supabase, userId });

  if (!existingAccount) {
    throw createHttpError("Threads account not found", 404);
  }

  const { error: publishedPostsError } = await supabase
    .from("published_posts")
    .update({
      social_account_id: null,
    })
    .eq("user_id", userId)
    .eq("social_account_id", existingAccount.id);

  if (publishedPostsError) {
    throw createHttpError(publishedPostsError.message, 400, publishedPostsError);
  }

  const { data, error } = await supabase
    .from("social_accounts")
    .delete()
    .eq("user_id", userId)
    .eq("platform", "threads")
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return mapThreadsAccountRow(data);
}

module.exports = {
  disconnectThreadsAccount,
  getThreadsAccount,
  normalizeThreadsAccountPayload,
  saveThreadsAccount,
};
