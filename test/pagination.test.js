const assert = require("node:assert/strict");

const {
  applyPagination,
  buildPaginationMetadata,
  normalizePagination,
} = require("../src/utils/pagination");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("pagination defaults invalid query values to the first 20 records", () => {
  assert.deepEqual(normalizePagination({ page: "invalid", limit: "0" }), {
    page: 1,
    limit: 20,
    from: 0,
    to: 19,
  });
});

run("pagination caps the requested limit at 100", () => {
  assert.deepEqual(normalizePagination({ page: "3", limit: "500" }), {
    page: 3,
    limit: 100,
    from: 200,
    to: 299,
  });
});

run("pagination applies an inclusive database range for the requested page", () => {
  const calls = [];
  const query = {
    range(from, to) {
      calls.push([from, to]);
      return this;
    },
  };

  assert.equal(applyPagination(query, { from: 20, to: 39 }), query);
  assert.deepEqual(calls, [[20, 39]]);
});

run("pagination metadata reports totals and whether another page exists", () => {
  assert.deepEqual(buildPaginationMetadata({ page: 2, limit: 20, total: 42 }), {
    page: 2,
    limit: 20,
    total: 42,
    totalPages: 3,
    hasNextPage: true,
  });
});

run("pagination metadata handles an empty result", () => {
  assert.deepEqual(buildPaginationMetadata({ page: 1, limit: 20, total: 0 }), {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
  });
});
