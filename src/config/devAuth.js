const DEV_AUTH_ENABLED =
  process.env.REFRAME_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";

const DEV_AUTH_EMAIL = "dummy@reframe.local";
const DEV_AUTH_PASSWORD = "Dummy123!";
const DEV_AUTH_TOKEN = "reframe-dev-dummy-token";

const DEV_AUTH_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: DEV_AUTH_EMAIL,
  email_confirmed_at: new Date(0).toISOString(),
};

const DEV_AUTH_PROFILE = {
  id: DEV_AUTH_USER.id,
  account_name: "reframe_dummy",
  full_name: "Reframe Dummy",
  role: "user",
};

function matchesDevCredentials({ email, password } = {}) {
  return DEV_AUTH_ENABLED &&
    String(email || "").trim().toLowerCase() === DEV_AUTH_EMAIL &&
    String(password || "") === DEV_AUTH_PASSWORD;
}

function isDevAuthToken(token) {
  return DEV_AUTH_ENABLED && token === DEV_AUTH_TOKEN;
}

module.exports = {
  DEV_AUTH_PROFILE,
  DEV_AUTH_TOKEN,
  DEV_AUTH_USER,
  isDevAuthToken,
  matchesDevCredentials,
};
