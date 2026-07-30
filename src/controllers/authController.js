const authService = require("../services/authService");

async function register(req, res, next) {
  try {
    const result = await authService.register(req.authInput || req.body);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.authInput || req.body);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function me(req, res, next) {
  try {
    const result = await authService.getCurrentUserProfile({
      user: req.user,
      supabase: req.supabase,
    });

    res.status(200).json({
      success: true,
      message: "Current user fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function meThreads(req, res, next) {
  try {
    const result = await authService.getCurrentUserThreadsConnection({
      user: req.user,
      supabase: req.supabase,
    });

    res.status(200).json({
      success: true,
      message: "Threads connection fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function updateMe(req, res, next) {
  try {
    const data = await authService.updateCurrentUserProfile({
      user: req.user,
      supabase: req.supabase,
      payload: req.body,
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const result = await authService.changePassword({
      user: req.user,
      supabase: req.supabase,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      confirmPassword: req.body.confirmPassword,
    });

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    const result = await authService.logout({
      supabase: req.supabase,
    });

    res.status(200).json({
      success: true,
      message: "Logout successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function handleMetaUninstall(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      message: "Meta uninstall callback received",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  changePassword,
  handleMetaUninstall,
  login,
  me,
  meThreads,
  logout,
  register,
  updateMe,
};
