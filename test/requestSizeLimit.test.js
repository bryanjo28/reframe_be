const assert = require("node:assert/strict");
const app = require("../src/app");

async function main() {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const normal = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "", password: "" }),
    });
    assert.equal(normal.status, 400);
    assert.match(normal.headers.get("content-type"), /application\/json/);

    const oversizedJson = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(101 * 1024) }),
    });
    assert.equal(oversizedJson.status, 413);
    assert.deepEqual(await oversizedJson.json(), {
      success: false,
      error_code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large.",
    });

    const oversizedForm = await fetch(`${baseUrl}/api/threads/delete`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ signed_request: "x".repeat(101 * 1024) }),
    });
    assert.equal(oversizedForm.status, 413);
    assert.deepEqual(await oversizedForm.json(), {
      success: false,
      error_code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large.",
    });

    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      success: false,
      error_code: "INVALID_JSON",
      message: "Request body contains invalid JSON.",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("ok - request body limits return stable JSON errors");
}

main().catch((error) => {
  console.error("not ok - request body limits return stable JSON errors");
  console.error(error);
  process.exitCode = 1;
});
