const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const threadsAccountsController = require("../controllers/threadsAccountsController");
const {
  validateThreadsAccountRequest,
} = require("../middlewares/threadsAccountsValidationMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", threadsAccountsController.getThreadsAccount);
router.post("/", validateThreadsAccountRequest, threadsAccountsController.saveThreadsAccount);

module.exports = router;
