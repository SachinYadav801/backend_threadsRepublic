import express from "express";

import {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  updatePaymentStatus,
} from "../controllers/orderController.js";

import protectAdmin from "../middleware/authMiddleware.js";

const router = express.Router();


// Customer
router.post("/", createOrder);


// Admin
router.get("/admin/all", protectAdmin, getAllOrders);

router.get("/admin/:id", protectAdmin, getOrderById);

router.put(
  "/admin/:id/status",
  protectAdmin,
  updateOrderStatus
);

router.put(
  "/admin/:id/payment-status",
  protectAdmin,
  updatePaymentStatus
);


export default router;