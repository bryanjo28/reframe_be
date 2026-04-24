const threadsConfig = {
  appId: process.env.THREADS_APP_ID || "",
  appSecret: process.env.THREADS_APP_SECRET || "",
  redirectUri: process.env.THREADS_REDIRECT_URI || "",
  scopes: process.env.THREADS_SCOPES || "threads_basic,threads_content_publish",
};

module.exports = threadsConfig;
