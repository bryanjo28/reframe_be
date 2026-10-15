const assert = require("node:assert/strict");
const requireAdmin = require("../src/middlewares/adminMiddleware");

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function makeRequest(profileResult) {
  const filters = [];
  const query = {
    select(columns) { this.columns = columns; return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    maybeSingle() { return Promise.resolve(profileResult); },
  };
  return {
    user: { id: "user-123", user_metadata: { role: "admin" } },
    supabase: { from: (table) => { assert.equal(table, "profiles"); return query; } },
    filters,
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

(async () => {
  await run("rejects normal users even when user-editable metadata says admin", async () => {
    const req = makeRequest({ data: { role: "user" }, error: null });
    const res = makeResponse();
    let calledNext = false;

    await requireAdmin(req, res, () => { calledNext = true; });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error_code, "ADMIN_ACCESS_REQUIRED");
    assert.equal(calledNext, false);
    assert.deepEqual(req.filters, [["id", "user-123"]]);
  });

  await run("allows only a server-owned admin profile role", async () => {
    const req = makeRequest({ data: { role: "admin" }, error: null });
    const res = makeResponse();
    let calledNext = false;

    await requireAdmin(req, res, () => { calledNext = true; });

    assert.equal(calledNext, true);
    assert.equal(req.adminRole, "admin");
    assert.equal(res.statusCode, null);
  });

  await run("fails closed when the role lookup errors", async () => {
    const req = makeRequest({ data: null, error: new Error("database unavailable") });
    const res = makeResponse();
    let calledNext = false;

    await requireAdmin(req, res, () => { calledNext = true; });

    assert.equal(res.statusCode, 503);
    assert.equal(calledNext, false);
  });
})();
