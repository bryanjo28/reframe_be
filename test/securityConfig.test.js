const assert = require("node:assert/strict");

async function withApp(action) {
  for (const modulePath of [
    "../src/app",
    "../src/routes/index",
    "../src/routes/threadsRoutes",
    "../src/routes/sumopodRoutes",
  ]) {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch {}
  }

  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    await action(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function main() {
  await withApp(async (baseUrl) => {
    const threadsResponse = await fetch(`${baseUrl}/api/threads/post`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "test" }),
    });
    const sumopodResponse = await fetch(`${baseUrl}/api/sumopod/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });

    assert.equal(threadsResponse.status, 404);
    assert.equal(sumopodResponse.status, 404);
  });

  console.log("ok - test-only API routes are not mounted");
}

main().catch((error) => {
  console.error("not ok - test-only API routes are not mounted");
  console.error(error);
  process.exitCode = 1;
});
