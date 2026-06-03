const scheduledJobsService = require("../services/scheduledJobsService");

async function listScheduledJobs(req, res, next) {
  try {
    const data = await scheduledJobsService.listScheduledJobs({
      supabase: req.supabase,
      userId: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Scheduled jobs fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function getScheduledJobById(req, res, next) {
  try {
    const data = await scheduledJobsService.getScheduledJobById({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Scheduled job fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function createScheduledJob(req, res, next) {
  try {
    const data = await scheduledJobsService.createScheduledJob({
      supabase: req.supabase,
      userId: req.user.id,
      payload: req.scheduledJobInput || req.body,
    });

    res.status(201).json({
      success: true,
      message: "Scheduled job created successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function updateScheduledJob(req, res, next) {
  try {
    const data = await scheduledJobsService.updateScheduledJob({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
      payload: req.scheduledJobInput || req.body,
    });

    res.status(200).json({
      success: true,
      message: "Scheduled job updated successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteScheduledJob(req, res, next) {
  try {
    const data = await scheduledJobsService.deleteScheduledJob({
      supabase: req.supabase,
      userId: req.user.id,
      id: req.params.id,
    });

    res.status(200).json({
      success: true,
      message: "Scheduled job deleted successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createScheduledJob,
  deleteScheduledJob,
  getScheduledJobById,
  listScheduledJobs,
  updateScheduledJob,
};
