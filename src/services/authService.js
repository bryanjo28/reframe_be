const { createSupabaseUserClient, isSupabaseConfigured, supabase } = require("../config/supabase");

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

function isAuthDebugEnabled() {
  const value = String(process.env.AUTH_DEBUG || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function debugAuthLog(label, payload) {
  if (!isAuthDebugEnabled()) {
    return;
  }

  console.log(`[auth-debug] ${label}`, payload);
}

function getFirstDefined(payload, keys) {
  const source = payload && typeof payload === "object" ? payload : {};

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

function normalizeText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);

  return text.length > 0 ? text : null;
}

function normalizeAuthPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const email = normalizeText(getFirstDefined(source, ["email"])).toLowerCase();
  const password = getFirstDefined(source, ["password"]);
  const accountName = normalizeText(
    getFirstDefined(source, ["accountName", "account_name"])
  );
  const fullName = normalizeOptionalText(
    getFirstDefined(source, ["fullName", "full_name"])
  );

  return {
    email,
    password: password === undefined || password === null ? "" : String(password),
    accountName,
    fullName,
  };
}

function assertRequiredAuthFields(payload, fields) {
  const source = payload && typeof payload === "object" ? payload : {};
  const missingFields = fields.filter((field) => {
    const value = source[field];

    if (typeof value === "string") {
      return value.trim().length === 0;
    }

    return value === undefined || value === null || value === "";
  });

  if (missingFields.length > 0) {
    throw createHttpError(`Missing required fields: ${missingFields.join(", ")}`, 400);
  }
}

function normalizeProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    accountName: profile.account_name,
    fullName: profile.full_name,
    createdAt: profile.created_at,
    role: profile.role,
  };
}

function buildThreadsConnectionStatus(row) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (!row) {
    return {
      connected: false,
      canUseToken: false,
      needsReconnect: false,
      status: "disconnected",
      reason: "No saved token found.",
      accountId: null,
      threadsId: null,
      expiresAt: null,
      remainingSeconds: 0,
      updatedAt: null,
      checkedAt: nowIso,
    };
  }

  const accessToken = typeof row.access_token === "string" ? row.access_token.trim() : row.access_token;
  const expiresAt = row.expires_at || null;

  if (!accessToken) {
    return {
      connected: false,
      canUseToken: false,
      needsReconnect: true,
      status: "needs_reconnect",
      reason: "Saved token is missing.",
      accountId: row.username || null,
      threadsId: row.platform_user_id || null,
      expiresAt,
      remainingSeconds: 0,
      updatedAt: row.updated_at || null,
      checkedAt: nowIso,
    };
  }

  if (!expiresAt) {
    return {
      connected: false,
      canUseToken: false,
      needsReconnect: true,
      status: "needs_reconnect",
      reason: "Saved token has no expiry metadata.",
      accountId: row.username || null,
      threadsId: row.platform_user_id || null,
      expiresAt: null,
      remainingSeconds: 0,
      updatedAt: row.updated_at || null,
      checkedAt: nowIso,
    };
  }

  const expiresAtTime = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiresAtTime)) {
    return {
      connected: false,
      canUseToken: false,
      needsReconnect: true,
      status: "needs_reconnect",
      reason: "Saved token has invalid expiry metadata.",
      accountId: row.username || null,
      threadsId: row.platform_user_id || null,
      expiresAt,
      remainingSeconds: 0,
      updatedAt: row.updated_at || null,
      checkedAt: nowIso,
    };
  }

  const remainingSeconds = Math.max(0, Math.floor((expiresAtTime - now) / 1000));
  const isConnected = expiresAtTime > now;

  return {
    connected: isConnected,
    canUseToken: isConnected,
    needsReconnect: !isConnected,
    status: isConnected ? "connected" : "needs_reconnect",
    reason: isConnected ? null : "Saved token has expired.",
    accountId: row.username || null,
    threadsId: row.platform_user_id || null,
    expiresAt,
    remainingSeconds: isConnected ? remainingSeconds : 0,
    updatedAt: row.updated_at || null,
    checkedAt: nowIso,
  };
}

function normalizeThreadsConnection(row) {
  return buildThreadsConnectionStatus(row);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getThreadsConnectionStatus({ supabase, userId }) {
  const maxAttempts = 3;
  const retryDelayMs = 250;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await supabase
      .from("social_accounts")
      .select("access_token, username, platform_user_id, expires_at, updated_at")
      .eq("user_id", userId)
      .eq("platform", "threads")
      .maybeSingle();

    if (error) {
      lastError = error;
      break;
    }

    if (data) {
      const normalized = normalizeThreadsConnection(data);
      debugAuthLog("threads-connection-row", {
        userId,
        raw: data,
        normalized,
      });
      return normalized;
    }

    if (attempt < maxAttempts - 1) {
      await sleep(retryDelayMs);
    }
  }

  if (lastError) {
    throw createHttpError(lastError.message, 500, lastError);
  }

  const normalized = normalizeThreadsConnection(null);
  debugAuthLog("threads-connection-row", {
    userId,
    raw: null,
    normalized,
  });
  return normalized;
}

function normalizeUpdateProfilePayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const accountNameValue = getFirstDefined(source, ["accountName", "account_name"]);
  const fullNameValue = getFirstDefined(source, ["fullName", "full_name"]);

  return {
    accountName:
      accountNameValue === undefined || accountNameValue === null
        ? undefined
        : String(accountNameValue).trim(),
    fullName:
      fullNameValue === undefined || fullNameValue === null
        ? undefined
        : String(fullNameValue).trim(),
  };
}

function normalizePasswordChangePayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};

  return {
    currentPassword:
      source.currentPassword === undefined || source.currentPassword === null
        ? ""
        : String(source.currentPassword),
    newPassword:
      source.newPassword === undefined || source.newPassword === null
        ? ""
        : String(source.newPassword),
    confirmPassword:
      source.confirmPassword === undefined || source.confirmPassword === null
        ? ""
        : String(source.confirmPassword),
  };
}

function assertValidPasswordChangePayload(payload) {
  const missingFields = [];

  if (!payload.currentPassword || String(payload.currentPassword).trim().length === 0) {
    missingFields.push("currentPassword");
  }

  if (!payload.newPassword || String(payload.newPassword).trim().length === 0) {
    missingFields.push("newPassword");
  }

  if (!payload.confirmPassword || String(payload.confirmPassword).trim().length === 0) {
    missingFields.push("confirmPassword");
  }

  if (missingFields.length > 0) {
    throw createHttpError(`Missing required fields: ${missingFields.join(", ")}`, 400);
  }

  if (String(payload.newPassword) !== String(payload.confirmPassword)) {
    throw createHttpError("newPassword and confirmPassword do not match", 400);
  }

  if (String(payload.newPassword).length < 8) {
    throw createHttpError("newPassword must be at least 8 characters", 400);
  }
}

function normalizeAuthResponse({ user, session, profile }) {
  return {
    user: {
      id: user.id,
      email: user.email,
    },
    profile,
    session: session
      ? {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at,
          tokenType: session.token_type,
        }
      : null,
  };
}

async function getProfileByUserId({ userId, accessToken }) {
  const userClient = createSupabaseUserClient(accessToken);

  if (!userClient) {
    throw createHttpError("Missing access token for profile lookup.", 401);
  }

  const { data, error } = await userClient
    .from("profiles")
    .select("id, account_name, full_name, created_at, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  return normalizeProfile(data);
}

async function register({ email, password, accountName, fullName }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const normalizedInput = normalizeAuthPayload({
    email,
    password,
    accountName,
    fullName,
  });

  assertRequiredAuthFields(normalizedInput, ["email", "password", "accountName"]);

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: normalizedInput.email,
    password: normalizedInput.password,
    options: {
      data: {
        account_name: normalizedInput.accountName,
        full_name: normalizedInput.fullName,
      },
    },
  });

  if (signUpError) {
    throw createHttpError(signUpError.message, 400, signUpError);
  }

  if (!signUpData.user) {
    throw createHttpError("Supabase signup did not return a user.", 500);
  }

  const profile = signUpData.session?.access_token
    ? await getProfileByUserId({
        userId: signUpData.user.id,
        accessToken: signUpData.session.access_token,
      })
    : null;

  return {
    ...normalizeAuthResponse({
      user: signUpData.user,
      session: signUpData.session,
      profile,
    }),
    emailConfirmationRequired: !signUpData.session,
  };
}

async function login({ email, password }) {
  if (!isSupabaseConfigured || !supabase) {
    throw createHttpError(
      "Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.",
      500
    );
  }

  const normalizedInput = normalizeAuthPayload({ email, password });
  assertRequiredAuthFields(normalizedInput, ["email", "password"]);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedInput.email,
    password: normalizedInput.password,
  });

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  const profile = await getProfileByUserId({
    userId: data.user.id,
    accessToken: data.session?.access_token,
  });

  return normalizeAuthResponse({
    user: data.user,
    session: data.session,
    profile,
  });
}

async function getCurrentUserProfile({ user, supabase }) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, account_name, full_name, created_at, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw createHttpError(error.message, 500, error);
  }

  const threadsConnection = await getThreadsConnectionStatus({
    supabase,
    userId: user.id,
  });

  debugAuthLog("me-response", {
    userId: user.id,
    email: user.email,
    profile: normalizeProfile(data),
    socialAccounts: {
      threads: threadsConnection,
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    profile: normalizeProfile(data),
    socialAccounts: {
      threads: threadsConnection,
    },
  };
}

async function getCurrentUserThreadsConnection({ user, supabase }) {
  const threadsConnection = await getThreadsConnectionStatus({
    supabase,
    userId: user.id,
  });

  debugAuthLog("me-threads-response", {
    userId: user.id,
    email: user.email,
    threads: threadsConnection,
  });

  return threadsConnection;
}

async function updateCurrentUserProfile({ user, supabase, payload }) {
  const input = normalizeUpdateProfilePayload(payload);
  const updatePayload = {};

  if (input.accountName !== undefined) {
    if (input.accountName.length === 0) {
      throw createHttpError("accountName cannot be empty", 400);
    }

    updatePayload.account_name = input.accountName;
  }

  if (input.fullName !== undefined) {
    updatePayload.full_name = input.fullName.length > 0 ? input.fullName : null;
  }

  if (Object.keys(updatePayload).length === 0) {
    throw createHttpError("No valid fields to update", 400);
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", user.id)
    .select("id, account_name, full_name, created_at, role")
    .single();

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return normalizeProfile(data);
}

async function changePassword({ user, supabase, currentPassword, newPassword, confirmPassword }) {
  const normalizedInput = normalizePasswordChangePayload({
    currentPassword,
    newPassword,
    confirmPassword,
  });

  assertValidPasswordChangePayload(normalizedInput);

  if (!user?.email) {
    throw createHttpError("User email is required to change password", 400);
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: normalizedInput.currentPassword,
  });

  if (reauthError) {
    throw createHttpError("Current password is wrong", 400, reauthError);
  }

  const { data, error } = await supabase.auth.updateUser({
    password: normalizedInput.newPassword,
  });

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return {
    user: {
      id: data.user.id,
      email: data.user.email,
    },
  };
}

async function logout({ supabase }) {
  if (!supabase) {
    throw createHttpError("Supabase client is not available", 500);
  }

  const { error } = await supabase.auth.signOut({ scope: "global" });

  if (error) {
    throw createHttpError(error.message, 400, error);
  }

  return {
    loggedOut: true,
  };
}

module.exports = {
  assertRequiredAuthFields,
  changePassword,
  getCurrentUserProfile,
  getCurrentUserThreadsConnection,
  login,
  normalizeAuthPayload,
  normalizeThreadsConnection,
  logout,
  getThreadsConnectionStatus,
  register,
  updateCurrentUserProfile,
  buildThreadsConnectionStatus,
};
