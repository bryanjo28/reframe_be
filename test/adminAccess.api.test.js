const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");

async function main() {
  const authMiddlewarePath = require.resolve("../src/middlewares/authMiddleware");
  const mockedAuthModule = new Module(authMiddlewarePath, module);
  mockedAuthModule.filename = authMiddlewarePath;
  mockedAuthModule.loaded = true;
  mockedAuthModule.exports = async (req, _res, next) => {
    req.user = { id: "regular-user", user_metadata: { role: "admin" } };
    req.supabase = {
      from(table) {
        assert.equal(table, "profiles");
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: { role: "user" }, error: null }),
        };
      },
    };
    next();
  };
  require.cache[authMiddlewarePath] = mockedAuthModule;

  const adminRoutesPath = require.resolve("../src/routes/admin/adminRoutes");
  delete require.cache[adminRoutesPath];
  const adminRoutes = require(adminRoutesPath);
  const app = express();
  app.use("/api/admin", adminRoutes);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    const paths = [
      "/overview", "/users", "/users/11111111-1111-4111-8111-111111111111", "/profitability",
      "/transactions", "/ai-usage", "/scheduled-posts", "/audit-logs",
    ];
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin${path}`, {
        headers: { Authorization: "Bearer valid-user-session" },
      });
      const payload = await response.json();
      assert.equal(response.status, 403, path);
      assert.equal(payload.error_code, "ADMIN_ACCESS_REQUIRED", path);
      assert.equal(payload.data, undefined, path);
    }
    console.log("ok - regular users receive 403 on every admin data API, including user detail and profitability");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[authMiddlewarePath];
  }
}

main().catch((error) => {
  console.error("not ok - direct admin API authorization");
  console.error(error);
  process.exitCode = 1;
});
