const assert = require("node:assert/strict");

const authMiddleware = require("../src/middlewares/authMiddleware");

function run(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

run("authMiddleware returns the standard missing-token response", async () => {
  let statusCode = null;
  let responseBody = null;
  const response = {
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };

  await authMiddleware({ headers: {} }, response, () => {
    throw new Error("next must not be called");
  });

  assert.equal(statusCode, 401);
  assert.deepEqual(responseBody, {
    success: false,
    error_code: "UNAUTHORIZED",
    message: "Unauthorized",
  });
});
