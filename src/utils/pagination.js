const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePagination(query = {}) {
  const page = toPositiveInteger(query.page, DEFAULT_PAGE);
  const requestedLimit = toPositiveInteger(query.limit, DEFAULT_LIMIT);
  const limit = Math.min(requestedLimit, MAX_LIMIT);
  const from = (page - 1) * limit;

  return {
    page,
    limit,
    from,
    to: from + limit - 1,
  };
}

function applyPagination(query, pagination) {
  return query.range(pagination.from, pagination.to);
}

function buildPaginationMetadata({ page, limit, total }) {
  const safeTotal = Number.isFinite(total) ? total : 0;
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / limit);

  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasNextPage: page < totalPages,
  };
}

module.exports = {
  applyPagination,
  buildPaginationMetadata,
  normalizePagination,
};
