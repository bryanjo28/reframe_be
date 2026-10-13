const { isSupabaseConfigured, supabaseAdmin } = require("../config/supabase");
const credentialsRepository = require("../repositories/socialAccountCredentialsRepository");
const { assertThreadsAccess } = require("./entitlementsService");

function createHttpError(message, status = 500, details, code) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  if (code) {
    error.code = code;
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

  const account = {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    expiresAt: row.expires_at,
    threadsId: row.platform_user_id,
    accountId: row.username,
    createdAt: row.created_at,
  };

  return account;
}

function buildInsertPayload({ userId, input }) {
  const payload = {
    user_id: userId,
    platform: "threads",
    platform_user_id: input.threadsId,
    username: input.accountId,
  };

  if (input.expiresAt !== undefined) {
    payload.expires_at = input.expiresAt;
  }

  return payload;
}

function buildUpdatePayload(input) {
  const payload = {
    platform: "threads",
    platform_user_id: input.threadsId,
    username: input.accountId,
  };

  if (input.expiresAt !== undefined) {
    payload.expires_at = input.expiresAt;
  }

  return payload;
}

async function saveThreadsAccount({
  supabase,
  credentialSupabase = supabaseAdmin,
  userId,
  payload,
  includeCredentials = false,
  skipEntitlementCheck = false,
}) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const input = normalizeThreadsAccountPayload(payload);
  assertCreateThreadsAccountPayload(input);
  if (!skipEntitlementCheck) await assertThreadsAccess({ supabase, userId });

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
    await credentialsRepository.upsert({
      supabase: credentialSupabase,
      socialAccountId: existingAccount.id,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    });

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

    const account = mapThreadsAccountRow(data);
    return includeCredentials ? { ...account, accessToken: input.accessToken, refreshToken: input.refreshToken } : account;
  }

  const { data, error } = await supabase
    .from("social_accounts")
    .insert(buildInsertPayload({ userId, input }))
    .select("*")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  try {
    await credentialsRepository.upsert({
      supabase: credentialSupabase,
      socialAccountId: data.id,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    });
  } catch (credentialError) {
    await supabase.from("social_accounts").delete().eq("id", data.id).eq("user_id", userId);
    throw credentialError;
  }
  const account = mapThreadsAccountRow(data);
  return includeCredentials ? { ...account, accessToken: input.accessToken, refreshToken: input.refreshToken } : account;
}

async function getThreadsAccount({
  supabase,
  credentialSupabase = supabaseAdmin,
  userId,
  includeCredentials = false,
}) {
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
    throw createHttpError(
      "Failed to load Threads account",
      500,
      error,
      "THREADS_SERVICE_ERROR"
    );
  }

  const account = mapThreadsAccountRow(data);
  if (!account || !includeCredentials) return account;
  const credentials = await credentialsRepository.getBySocialAccountId({
    supabase: credentialSupabase,
    socialAccountId: account.id,
  });
  return credentials ? { ...account, ...credentials } : account;
}

async function disconnectThreadsAccount({ supabase, credentialSupabase = supabaseAdmin, userId }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Threads service is not configured",
      500,
      undefined,
      "THREADS_SERVICE_ERROR"
    );
  }

  const existingAccount = await getThreadsAccount({ supabase, userId });

  if (!existingAccount) {
    throw createHttpError(
      "Threads account not found",
      404,
      undefined,
      "THREADS_ACCOUNT_NOT_FOUND"
    );
  }

  const { data, error } = await supabase
    .from("social_accounts")
    .update({
      expires_at: null,
    })
    .eq("id", existingAccount.id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw createHttpError(
      "Failed to disconnect Threads account",
      400,
      error,
      "THREADS_DISCONNECT_FAILED"
    );
  }

  try {
    await credentialsRepository.deleteBySocialAccountId({
      supabase: credentialSupabase,
      socialAccountId: existingAccount.id,
    });
  } catch (credentialError) {
    throw createHttpError(
      "Failed to disconnect Threads account",
      400,
      credentialError,
      "THREADS_DISCONNECT_FAILED"
    );
  }

  return mapThreadsAccountRow(data);
}

module.exports = {
  disconnectThreadsAccount,
  getThreadsAccount,
  normalizeThreadsAccountPayload,
  saveThreadsAccount,
};
