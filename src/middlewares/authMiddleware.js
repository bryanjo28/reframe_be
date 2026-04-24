const {
  createSupabaseUserClient,
  getUserFromToken,
} = require("../config/supabase");

function getBearerToken(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim();
}

async function authMiddleware(req, res, next) {
  try {
    const accessToken = getBearerToken(req);

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const user = await getUserFromToken(accessToken);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    req.user = user;
    req.accessToken = accessToken;
    req.supabase = createSupabaseUserClient(accessToken);

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = authMiddleware;