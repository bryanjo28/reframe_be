const { isSupabaseConfigured } = require("../config/supabase");
const { mapPublishedPostRow } = require("./threadsPublishProgressService");
const {
  applyPagination,
  buildPaginationMetadata,
  normalizePagination,
} = require("../utils/pagination");

async function listPublishedPosts({ supabase, userId, query = {} }) {
  if (!isSupabaseConfigured || !supabase) {
    const error = new Error("Supabase is not configured. Fill SUPABASE_URL and SUPABASE_ANON_KEY first.");
    error.status = 500;
    throw error;
  }

  const pagination = normalizePagination(query);
  const databaseQuery = supabase
    .from("published_posts")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .ilike("platform", "threads")
    .eq("status", "success")
    .eq("publish_status", "success")
    .not("platform_post_id", "is", null)
    .not("post_url", "is", null)
    .order("posted_at", { ascending: false })
    .order("id", { ascending: false });

  const contentOutputId = query.contentOutputId || query.content_output_id;
  if (contentOutputId) {
    databaseQuery.eq("content_output_id", contentOutputId);
  }

  const { data, count, error } = await applyPagination(databaseQuery, pagination);
  if (error) {
    const result = new Error(error.message);
    result.status = 500;
    result.details = error;
    throw result;
  }

  return {
    data: (data || []).map(mapPublishedPostRow),
    pagination: buildPaginationMetadata({
      page: pagination.page,
      limit: pagination.limit,
      total: count,
    }),
  };
}

module.exports = { listPublishedPosts };
