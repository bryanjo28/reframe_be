const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const scheduledJobsController = require("../controllers/scheduledJobsController");
const {
  validateCreateScheduledJobRequest,
  validateScheduledJobIdParam,
  validateUpdateScheduledJobRequest,
} = require("../middlewares/scheduledJobsValidationMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", scheduledJobsController.listScheduledJobs);
router.get(
  "/:id",
  validateScheduledJobIdParam,
  scheduledJobsController.getScheduledJobById
);
router.post(
  "/",
  validateCreateScheduledJobRequest,
  scheduledJobsController.createScheduledJob
);
router.patch(
  "/:id",
  validateScheduledJobIdParam,
  validateUpdateScheduledJobRequest,
  scheduledJobsController.updateScheduledJob
);
router.delete(
  "/:id",
  validateScheduledJobIdParam,
  scheduledJobsController.deleteScheduledJob
);

module.exports = router;
