const crypto = require("crypto");

const threadsConfig = require("../config/threads");
const threadsTokenRepository = require("../repositories/threadsTokenRepository");
const oauthStateStore = require("../store/oauthStateStore");

function createAuthorizationRequest({ userId }) {
  if (!userId) {
    const error = new Error("userId is required");
    error.status = 400;
    throw error;
  }

  if (!threadsConfig.appId || !threadsConfig.redirectUri) {
    const error = new Error(
      "Threads OAuth config is incomplete. Please fill THREADS_APP_ID and THREADS_REDIRECT_URI."
    );
    error.status = 500;
    throw error;
  }

  const state = crypto.randomUUID();

  oauthStateStore.save(state, {
    userId,
    provider: "threads",
    createdAt: new Date().toISOString(),
  });

  const query = new URLSearchParams({
    client_id: threadsConfig.appId,
    redirect_uri: threadsConfig.redirectUri,
    scope: threadsConfig.scopes,
    response_type: "code",
    state,
  });

  return {
    userId,
    state,
    authorizationUrl: `https://threads.net/oauth/authorize?${query.toString()}`,
  };
}

async function handleCallback({ code, state }) {
  if (!code) {
    const error = new Error("Missing OAuth code");
    error.status = 400;
    throw error;
  }

  if (!state) {
    const error = new Error("Missing OAuth state");
    error.status = 400;
    throw error;
  }

  const oauthSession = oauthStateStore.consume(state);

  if (!oauthSession || oauthSession.provider !== "threads") {
    const error = new Error("Invalid or expired OAuth state");
    error.status = 400;
    throw error;
  }

  const shortLivedToken = await exchangeCodeForShortLivedToken({ code });
  const longLivedToken = await exchangeForLongLivedToken({
    accessToken: shortLivedToken.accessToken,
  });

  const savedToken = await threadsTokenRepository.save({
    userId: oauthSession.userId,
    provider: "threads",
    threadsUserId: shortLivedToken.threadsUserId,
    shortLivedAccessToken: shortLivedToken.accessToken,
    accessToken: longLivedToken.accessToken,
    tokenType: "Bearer",
    expiresIn: longLivedToken.expiresIn,
    scope: threadsConfig.scopes.split(","),
  });

  return {
    userId: oauthSession.userId,
    provider: "threads",
    threadsUserId: shortLivedToken.threadsUserId,
    accessTokenStored: true,
    tokenRecord: savedToken,
    nextStep:
      "Replace the mock token exchange with real calls to graph.threads.net and persist this record to your database.",
  };
}

async function exchangeCodeForShortLivedToken({ code }) {
  if (!threadsConfig.appSecret) {
    const error = new Error(
      "THREADS_APP_SECRET is missing. Fill it before implementing the real token exchange."
    );
    error.status = 500;
    throw error;
  }

  // TODO: Real implementation:
  // POST https://graph.threads.net/oauth/access_token
  // client_id, client_secret, grant_type=authorization_code, redirect_uri, code
  return {
    accessToken: `mock_threads_short_token_${code}`,
    threadsUserId: "mock_threads_user_id",
  };
}

async function exchangeForLongLivedToken({ accessToken }) {
  // TODO: Real implementation:
  // GET https://graph.threads.net/access_token
  // grant_type=th_exchange_token&client_secret=...&access_token=...
  return {
    accessToken: `mock_threads_long_token_${accessToken}`,
    expiresIn: 5184000,
  };
}

module.exports = {
  createAuthorizationRequest,
  handleCallback,
};
