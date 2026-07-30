const crypto = require("crypto");

const threadsConfig = require("../config/threads");
const { isSupabaseAdminConfigured, supabaseAdmin } = require("../config/supabase");
const threadsAccountsService = require("./threadsAccountsService");
const threadsTokenRepository = require("../repositories/threadsTokenRepository");
const oauthStateStore = require("../store/oauthStateStore");

const THREADS_API_BASE = "https://graph.threads.net";
const THREADS_API_VERSION = "v1.0";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function createHttpError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

function normalizeTokenResponse(data = {}) {
  return {
    accessToken: data.access_token || "",
    refreshToken: data.refresh_token || null,
    tokenType: data.token_type || "Bearer",
    expiresIn:
      data.expires_in === undefined || data.expires_in === null
        ? null
        : Number(data.expires_in),
    scope: data.scope || null,
    raw: data,
  };
}

function normalizeExpiry(expiresIn) {
  if (!expiresIn || Number.isNaN(Number(expiresIn))) {
    return null;
  }

  const seconds = Number(expiresIn);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(Date.now() + seconds * 1000).toISOString();
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  url.search = searchParams.toString();
  return url.toString();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw createHttpError("Threads API returned invalid JSON", 502, {
        responseText: text,
      });
    }
  }

  if (!response.ok) {
    throw createHttpError(
      `Threads API request failed with status ${response.status}`,
      response.status,
      data
    );
  }

  return { data };
}

function getDisplayUsername(threadsUser) {
  if (!threadsUser) {
    return null;
  }

  return threadsUser.username || threadsUser.name || null;
}

function getOAuthStateSecret() {
  return (
    process.env.THREADS_OAUTH_STATE_SECRET ||
    threadsConfig.appSecret ||
    process.env.APP_BASE_URL ||
    "threads-oauth-state-fallback"
  );
}

function encodeStatePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function signStatePayload(encodedPayload) {
  return crypto.createHmac("sha256", getOAuthStateSecret()).update(encodedPayload).digest("base64url");
}

function createSignedState({ userId }) {
  const payload = {
    provider: "threads",
    userId,
    nonce: crypto.randomUUID(),
    createdAt: Date.now(),
  };

  const encodedPayload = encodeStatePayload(payload);
  const signature = signStatePayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function parseSignedState(state) {
  if (!state || typeof state !== "string") {
    return null;
  }

  const [encodedPayload, signature] = state.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signStatePayload(encodedPayload);
  const providedSignature = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    providedSignature.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(providedSignature, expectedSignatureBuffer)
  ) {
    return null;
  }

  let payload = null;

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }

  if (!payload || payload.provider !== "threads" || !payload.userId || !payload.createdAt) {
    return null;
  }

  if (Date.now() - Number(payload.createdAt) > OAUTH_STATE_TTL_MS) {
    return null;
  }

  return {
    userId: payload.userId,
    provider: payload.provider,
    createdAt: new Date(payload.createdAt).toISOString(),
  };
}

function buildAuthorizationUrl({ state }) {
  const query = new URLSearchParams({
    client_id: threadsConfig.appId,
    redirect_uri: threadsConfig.redirectUri,
    scope: threadsConfig.scopes,
    response_type: "code",
    state,
  });

  return `https://threads.net/oauth/authorize?${query.toString()}`;
}

async function exchangeCodeForShortLivedToken({ code }) {
  if (!threadsConfig.appSecret) {
    throw createHttpError(
      "THREADS_APP_SECRET is missing. Fill it before exchanging the authorization code.",
      500
    );
  }

  const url = buildUrl(`${THREADS_API_BASE}/oauth/access_token`, {
    client_id: threadsConfig.appId,
    client_secret: threadsConfig.appSecret,
    grant_type: "authorization_code",
    redirect_uri: threadsConfig.redirectUri,
    code,
  });

  const response = await requestJson(url, {
    method: "POST",
  });

  return normalizeTokenResponse(response.data);
}

async function exchangeForLongLivedToken({ accessToken }) {
  const url = buildUrl(`${THREADS_API_BASE}/access_token`, {
    grant_type: "th_exchange_token",
    client_secret: threadsConfig.appSecret,
    access_token: accessToken,
  });

  const response = await requestJson(url);

  return normalizeTokenResponse(response.data);
}

async function refreshLongLivedToken({ accessToken }) {
  const url = buildUrl(`${THREADS_API_BASE}/refresh_access_token`, {
    grant_type: "th_refresh_token",
    access_token: accessToken,
  });

  const response = await requestJson(url);

  return normalizeTokenResponse(response.data);
}

async function getThreadsUser(accessToken) {
  const url = buildUrl(`${THREADS_API_BASE}/${THREADS_API_VERSION}/me`, {
    fields: "id,username,name,threads_profile_picture_url",
    access_token: accessToken,
  });

  const response = await requestJson(url);

  return response.data;
}

async function saveThreadsAccount({
  userId,
  accessToken,
  refreshToken,
  expiresIn,
  threadsUser,
}) {
  const payload = {
    accessToken,
    accountId: getDisplayUsername(threadsUser),
    threadsId: threadsUser.id,
    refreshToken,
    expiresAt: normalizeExpiry(expiresIn),
  };

  if (isSupabaseAdminConfigured && supabaseAdmin) {
    const tokenRecord = await threadsAccountsService.saveThreadsAccount({
      supabase: supabaseAdmin,
      userId,
      payload,
    });

    return {
      storage: "database",
      tokenRecord,
    };
  }

  const tokenRecord = await threadsTokenRepository.save({
    userId,
    provider: "threads",
    threadsUserId: threadsUser.id,
    username: getDisplayUsername(threadsUser),
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: normalizeExpiry(expiresIn),
    tokenType: "Bearer",
    scope: threadsConfig.scopes.split(",").map((scope) => scope.trim()).filter(Boolean),
  });

  return {
    storage: "memory",
    tokenRecord,
  };
}

function createAuthorizationRequest({ userId }) {
  if (!userId) {
    throw createHttpError("userId is required", 400);
  }

  if (!threadsConfig.appId || !threadsConfig.appSecret || !threadsConfig.redirectUri) {
    throw createHttpError(
      "Threads OAuth config is incomplete. Please fill THREADS_APP_ID, THREADS_APP_SECRET, and THREADS_REDIRECT_URI.",
      500
    );
  }

  const state = createSignedState({ userId });

  oauthStateStore.save(state, {
    userId,
    provider: "threads",
    createdAt: new Date().toISOString(),
  });

  return {
    userId,
    state,
    provider: "threads",
    redirectUri: threadsConfig.redirectUri,
    authorizationUrl: buildAuthorizationUrl({ state }),
  };
}

async function handleCallback({ code, state }) {
  if (!code) {
    throw createHttpError("Missing OAuth code", 400);
  }

  if (!state) {
    throw createHttpError("Missing OAuth state", 400);
  }

  const oauthSession = oauthStateStore.consume(state);
  const verifiedSession =
    oauthSession && oauthSession.provider === "threads"
      ? oauthSession
      : parseSignedState(state);

  if (!verifiedSession || verifiedSession.provider !== "threads") {
    throw createHttpError("Invalid or expired OAuth state", 400);
  }

  const shortLivedToken = await exchangeCodeForShortLivedToken({ code });
  const longLivedToken = await exchangeForLongLivedToken({
    accessToken: shortLivedToken.accessToken,
  });

  const activeAccessToken = longLivedToken.accessToken || shortLivedToken.accessToken;
  const activeRefreshToken = longLivedToken.refreshToken || shortLivedToken.refreshToken;
  const activeExpiresIn = longLivedToken.expiresIn || shortLivedToken.expiresIn;

  const threadsUser = await getThreadsUser(activeAccessToken);
  const persisted = await saveThreadsAccount({
    userId: verifiedSession.userId,
    accessToken: activeAccessToken,
    refreshToken: activeRefreshToken,
    expiresIn: activeExpiresIn,
    threadsUser,
  });

  return {
    userId: verifiedSession.userId,
    provider: "threads",
    threadsUserId: threadsUser.id,
    threadsUsername: getDisplayUsername(threadsUser),
    accessTokenStored: true,
    storage: persisted.storage,
    tokenRecord: persisted.tokenRecord,
    shortLivedToken: {
      tokenType: shortLivedToken.tokenType,
      expiresIn: shortLivedToken.expiresIn,
    },
    longLivedToken: {
      tokenType: longLivedToken.tokenType,
      expiresIn: longLivedToken.expiresIn,
    },
  };
}

module.exports = {
  createAuthorizationRequest,
  exchangeForLongLivedToken,
  exchangeCodeForShortLivedToken,
  handleCallback,
  getThreadsUser,
  refreshLongLivedToken,
};
