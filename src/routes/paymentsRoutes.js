const router=require("express").Router();
const auth=require("../middlewares/authMiddleware");
const controller=require("../controllers/paymentsController");
router.use(auth);
router.get("/me",controller.getPage);
router.post("/orders",controller.createOrder);
router.patch("/notifications/:id/read",controller.readNotification);
module.exports=router;
