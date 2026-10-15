async function requireAdmin(req, res, next) {
  try {
    // Read the role from the server-owned profile row. Never authorize from
    // user-editable auth metadata or a frontend supplied role value.
    const { data, error } = await req.supabase
      .from("profiles")
      .select("role")
      .eq("id", req.user.id)
      .maybeSingle();

    if (error) {
      return res.status(503).json({
        success: false,
        error_code: "ADMIN_ACCESS_UNAVAILABLE",
        message: "Admin access could not be verified",
      });
    }

    if (data?.role !== "admin") {
      return res.status(403).json({
        success: false,
        error_code: "ADMIN_ACCESS_REQUIRED",
        message: "Administrator access required",
      });
    }

    req.adminRole = data.role;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = requireAdmin;
