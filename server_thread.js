require("dotenv").config();

const express = require("express");
const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.THREADS_APP_ID || process.env.META_APP_ID;
const CLIENT_SECRET =
  process.env.THREADS_APP_SECRET || process.env.META_APP_SECRET;
const REDIRECT_URI =
  process.env.THREADS_REDIRECT_URI || process.env.REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  throw new Error(
    "Missing Threads OAuth config. Set THREADS_APP_ID, THREADS_APP_SECRET, and THREADS_REDIRECT_URI."
  );
}

const THREADS_API_BASE = "https://graph.threads.net";
const THREADS_API_VERSION = "v1.0";
const TOKEN_STORE_PATH = path.join(__dirname, "data", "threads-token-store.json");

async function ensureTokenStoreDir() {
  await fs.mkdir(path.dirname(TOKEN_STORE_PATH), { recursive: true });
}

function toExpiryInfo(tokenData, fallbackDate = new Date()) {
  const expiresIn = Number(tokenData?.expires_in);

  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return {
      expires_in: tokenData?.expires_in ?? null,
      issued_at: fallbackDate.toISOString(),
      expires_at: null
    };
  }

  return {
    expires_in: expiresIn,
    issued_at: fallbackDate.toISOString(),
    expires_at: new Date(fallbackDate.getTime() + expiresIn * 1000).toISOString()
  };
}

async function saveTokenStore(payload) {
  await ensureTokenStoreDir();
  await fs.writeFile(
    TOKEN_STORE_PATH,
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

async function readTokenStore() {
  try {
    const content = await fs.readFile(TOKEN_STORE_PATH, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function buildConnectionStatus(tokenStore) {
  if (!tokenStore?.active_token?.access_token) {
    return {
      connected: false,
      reason: "No saved token found."
    };
  }

  const expiresAt = tokenStore.active_token.expires_at;

  if (!expiresAt) {
    return {
      connected: false,
      reason: "Saved token has no expiry metadata."
    };
  }

  const expiresAtTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const isConnected = Number.isFinite(expiresAtTime) && expiresAtTime > now;

  return {
    connected: isConnected,
    reason: isConnected ? null : "Saved token has expired.",
    expires_at: expiresAt,
    now: new Date(now).toISOString(),
    remaining_seconds: isConnected
      ? Math.max(0, Math.floor((expiresAtTime - now) / 1000))
      : 0
  };
}

function getAccessToken(req) {
  const authHeader = req.headers.authorization || "";

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return req.body.access_token || req.query.access_token;
}

async function getLongLivedToken(shortLivedToken) {
  const response = await axios.get(`${THREADS_API_BASE}/access_token`, {
    params: {
      grant_type: "th_exchange_token",
      client_secret: CLIENT_SECRET,
      access_token: shortLivedToken
    }
  });

  return response.data;
}

async function refreshLongLivedToken(longLivedToken) {
  const response = await axios.get(
    `${THREADS_API_BASE}/refresh_access_token`,
    {
      params: {
        grant_type: "th_refresh_token",
        access_token: longLivedToken
      }
    }
  );

  return response.data;
}

async function getThreadsUser(accessToken) {
  const response = await axios.get(
    `${THREADS_API_BASE}/${THREADS_API_VERSION}/me`,
    {
      params: {
        fields: "id,username,name,threads_profile_picture_url",
        access_token: accessToken
      }
    }
  );

  return response.data;
}

// =========================
// HOME
// =========================
app.get("/", (req, res) => {

  res.send(`
    <h1>Threads OAuth Test</h1>

    <a href="/auth/threads">
      Connect Threads
    </a>

    <br /><br />

    <a href="/status">
      View Status
    </a>
  `);

});

// =========================
// THREADS LOGIN
// =========================
app.get("/auth/threads", (req, res) => {

  const scope = [
    "threads_basic",
    "threads_content_publish"
  ].join(",");

  const authUrl =
    `https://threads.net/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${scope}` +
    `&response_type=code`;

  console.log("Redirecting to:");
  console.log(authUrl);

  res.redirect(authUrl);

});

// =========================
// CALLBACK
// =========================
const handleThreadsCallback = async (req, res) => {

  const { code, error, error_reason } = req.query;

  // kalau user cancel login
  if (error) {

    return res.status(400).json({
      success: false,
      error,
      error_reason
    });

  }

  try {

    // =========================
    // EXCHANGE CODE -> TOKEN
    // =========================
    const tokenResponse = await axios.post(
      "https://graph.threads.net/oauth/access_token",
      null,
      {
        params: {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI,
          code
        }
      }
    );

    console.log("TOKEN RESPONSE:");
    console.log(tokenResponse.data);

    const tokenIssuedAt = new Date();
    const shortLivedToken = tokenResponse.data.access_token;
    let longLivedTokenData = null;

    try {
      longLivedTokenData = await getLongLivedToken(shortLivedToken);
      console.log("LONG LIVED TOKEN RESPONSE:");
      console.log(longLivedTokenData);
    } catch (exchangeError) {
      console.error("LONG LIVED TOKEN ERROR:");
      console.error(exchangeError.response?.data || exchangeError.message);
    }

    // =========================
    // GET USER PROFILE
    // =========================
    const user = await getThreadsUser(shortLivedToken);
    console.log("USER PROFILE:");
    console.log(user);

    const shortLivedTokenRecord = {
      ...tokenResponse.data,
      ...toExpiryInfo(tokenResponse.data, tokenIssuedAt)
    };
    const longLivedTokenRecord = longLivedTokenData
      ? {
          ...longLivedTokenData,
          ...toExpiryInfo(longLivedTokenData, tokenIssuedAt)
        }
      : null;
    const activeTokenRecord = longLivedTokenRecord || shortLivedTokenRecord;
    const tokenStore = {
      provider: "threads",
      connected_at: tokenIssuedAt.toISOString(),
      updated_at: new Date().toISOString(),
      user,
      active_token: {
        type: longLivedTokenRecord ? "long_lived_token" : "short_lived_token",
        access_token: activeTokenRecord.access_token,
        expires_in: activeTokenRecord.expires_in,
        issued_at: activeTokenRecord.issued_at,
        expires_at: activeTokenRecord.expires_at
      },
      short_lived_token: shortLivedTokenRecord,
      long_lived_token: longLivedTokenRecord
    };

    await saveTokenStore(tokenStore);

    // =========================
    // RESPONSE
    // =========================
    res.json({
      success: true,
      message: "Connected. Token data saved to local JSON mock store.",
      short_lived_token: shortLivedTokenRecord,
      long_lived_token: longLivedTokenRecord,
      active_token: tokenStore.active_token,
      user
    });

  } catch (err) {

    console.error("ERROR:");

    console.error(
      err.response?.data || err.message
    );

    res.status(500).json({
      success: false,
      error: err.response?.data || err.message
    });

  }

};

app.get("/auth/threads/callback", handleThreadsCallback);
app.get("/auth/meta/callback", handleThreadsCallback);

// =========================
// TOKEN HELPERS
// =========================
app.post("/threads/token/exchange", async (req, res) => {
  const accessToken = getAccessToken(req);

  if (!accessToken) {
    return res.status(400).json({
      success: false,
      error: "Missing access_token. Send it in JSON body, query string, or Authorization Bearer header."
    });
  }

  try {
    const tokenData = await getLongLivedToken(accessToken);
    const issuedAt = new Date();
    const tokenRecord = {
      ...tokenData,
      ...toExpiryInfo(tokenData, issuedAt)
    };
    const currentStore = await readTokenStore();
    const tokenStore = {
      provider: "threads",
      connected_at: currentStore?.connected_at || issuedAt.toISOString(),
      updated_at: issuedAt.toISOString(),
      user: currentStore?.user || null,
      active_token: {
        type: "long_lived_token",
        access_token: tokenRecord.access_token,
        expires_in: tokenRecord.expires_in,
        issued_at: tokenRecord.issued_at,
        expires_at: tokenRecord.expires_at
      },
      short_lived_token: currentStore?.short_lived_token || null,
      long_lived_token: tokenRecord
    };

    await saveTokenStore(tokenStore);

    res.json({
      success: true,
      message: "Long-lived token exchanged and saved.",
      token_data: tokenRecord
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
});

app.post("/threads/token/refresh", async (req, res) => {
  const accessToken = getAccessToken(req);

  if (!accessToken) {
    return res.status(400).json({
      success: false,
      error: "Missing access_token. Send it in JSON body, query string, or Authorization Bearer header."
    });
  }

  try {
    const tokenData = await refreshLongLivedToken(accessToken);
    const issuedAt = new Date();
    const tokenRecord = {
      ...tokenData,
      ...toExpiryInfo(tokenData, issuedAt)
    };
    const currentStore = await readTokenStore();
    const tokenStore = {
      provider: "threads",
      connected_at: currentStore?.connected_at || issuedAt.toISOString(),
      updated_at: issuedAt.toISOString(),
      user: currentStore?.user || null,
      active_token: {
        type: "long_lived_token",
        access_token: tokenRecord.access_token,
        expires_in: tokenRecord.expires_in,
        issued_at: tokenRecord.issued_at,
        expires_at: tokenRecord.expires_at
      },
      short_lived_token: currentStore?.short_lived_token || null,
      long_lived_token: tokenRecord
    };

    await saveTokenStore(tokenStore);

    res.json({
      success: true,
      message: "Long-lived token refreshed and saved.",
      token_data: tokenRecord
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
});

app.get("/status", async (req, res) => {
  try {
    const tokenStore = await readTokenStore();
    const status = buildConnectionStatus(tokenStore);

    res.send(`
      <h1>Threads Connection Status</h1>
      <p><strong>Status:</strong> ${status.connected ? "connected" : "disconnected"}</p>
      <p><strong>Now:</strong> ${status.now || "-"}</p>
      <p><strong>Expires At:</strong> ${status.expires_at || "-"}</p>
      <p><strong>Remaining Seconds:</strong> ${status.remaining_seconds ?? "-"}</p>
      <p><strong>User:</strong> ${tokenStore?.user?.username || "-"}</p>
      <p><strong>Active Token Type:</strong> ${tokenStore?.active_token?.type || "-"}</p>
      <p><strong>Reason:</strong> ${status.reason || "-"}</p>
      <p><a href="/">Back</a></p>
    `);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/status/json", async (req, res) => {
  try {
    const tokenStore = await readTokenStore();
    const status = buildConnectionStatus(tokenStore);

    res.json({
      success: true,
      status,
      token_store: tokenStore
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// =========================
// CREATE THREADS POST
// =========================
app.post("/threads/posts", async (req, res) => {
  const accessToken = getAccessToken(req);
  const { user_id: userIdFromBody, text, reply_control } = req.body;

  if (!accessToken) {
    return res.status(400).json({
      success: false,
      error: "Missing access_token. Send it in JSON body, query string, or Authorization Bearer header."
    });
  }

  if (!text || !String(text).trim()) {
    return res.status(400).json({
      success: false,
      error: "Missing text."
    });
  }

  try {
    const user =
      userIdFromBody
        ? { id: userIdFromBody }
        : await getThreadsUser(accessToken);

    const createResponse = await axios.post(
      `${THREADS_API_BASE}/${THREADS_API_VERSION}/${user.id}/threads`,
      null,
      {
        params: {
          media_type: "TEXT",
          text,
          reply_control: reply_control || "everyone",
          access_token: accessToken
        }
      }
    );

    const publishResponse = await axios.post(
      `${THREADS_API_BASE}/${THREADS_API_VERSION}/${user.id}/threads_publish`,
      null,
      {
        params: {
          creation_id: createResponse.data.id,
          access_token: accessToken
        }
      }
    );

    res.json({
      success: true,
      user_id: user.id,
      creation: createResponse.data,
      publish: publishResponse.data
    });
  } catch (err) {
    console.error("THREADS POST ERROR:");
    console.error(err.response?.data || err.message);

    res.status(500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
});

// =========================
// TEST CALLBACKS
// =========================
app.get("/health", (req, res) => {
  res.send("OK");
});

app.post("/delete", (req, res) => {
  res.sendStatus(200);
});

app.post("/uninstall", (req, res) => {
  res.sendStatus(200);
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {

  console.log(`
===================================
Threads OAuth Server Running
===================================

PORT:
${PORT}

REDIRECT_URI:
${REDIRECT_URI}

CLIENT_ID:
${CLIENT_ID}

===================================
  `);

});
