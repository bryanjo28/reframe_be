const assert = require("node:assert/strict");

const contentPillarsRoutes = require("../src/routes/contentPillarsRoutes");

const routePaths = contentPillarsRoutes.stack
  .filter((layer) => layer.route)
  .map((layer) => layer.route.path);

assert.equal(routePaths.includes("/enhance"), false);
assert.equal(routePaths.includes("/enhance/:id"), false);

console.log("ok - content pillar enhance routes are not mounted");
