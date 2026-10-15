const assert = require("node:assert/strict");
require("dotenv").config();

const adminService = require("../src/services/adminService");
const { supabaseAdmin } = require("../src/config/supabase");

async function main() {
  assert.deepEqual(adminService.normalizeReportRange({}), { from: null, to: null });
  assert.deepEqual(adminService.normalizeReportRange({ from: "2026-01-01", to: "2026-02-01" }), {
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-02-01T00:00:00.000Z",
  });
  assert.throws(() => adminService.normalizeReportRange({ from: "bad-date" }), { status: 400, code: "ADMIN_INVALID_FILTER" });
  assert.throws(() => adminService.normalizeReportRange({ from: "2026-02-01", to: "2026-01-01" }), { status: 400, code: "ADMIN_INVALID_FILTER" });

  const originalRpc = supabaseAdmin.rpc;
  let invoked;
  supabaseAdmin.rpc = async (name, args) => {
    invoked = { name, args };
    return { data: { items: [], total: 0, page: args.p_page, limit: args.p_limit }, error: null };
  };
  try {
    const report = await adminService.getProfitability({
      from: "2026-01-01", to: "2026-02-01", plan: "creator", sort: "highest_ai_cost",
      page: 3, limit: 500, query: "  j.jeremy  ",
    });
    assert.equal(report.page, 3);
    assert.equal(invoked.name, "admin_user_profitability");
    assert.equal(invoked.args.p_from, "2026-01-01T00:00:00.000Z");
    assert.equal(invoked.args.p_to, "2026-02-01T00:00:00.000Z");
    assert.equal(invoked.args.p_plan, "creator");
    assert.equal(invoked.args.p_sort, "highest_ai_cost");
    assert.equal(invoked.args.p_page, 3);
    assert.equal(invoked.args.p_limit, 100);
    assert.equal(invoked.args.p_query, "j.jeremy");
    console.log("ok - admin profitability forwards validated date filters, sort, search, and bounded pagination to SQL");
  } finally {
    supabaseAdmin.rpc = originalRpc;
  }
}

main().catch((error) => {
  console.error("not ok - admin reporting range and query validation");
  console.error(error);
  process.exitCode = 1;
});
