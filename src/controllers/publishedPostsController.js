const publishedPostsService = require("../services/publishedPostsService");

async function listPublishedPosts(req, res, next) {
  try {
    const result = await publishedPostsService.listPublishedPosts({
      supabase: req.supabase,
      userId: req.user.id,
      query: req.query,
    });

    res.status(200).json({
      success: true,
      message: "Published posts fetched successfully",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listPublishedPosts };
