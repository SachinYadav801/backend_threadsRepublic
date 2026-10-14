import express from "express";

import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";

import protectAdmin from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getProducts);  // getting all products
router.get("/:slug", getProductBySlug);  // getting a single product

// Admin-only routes
router.post("/", protectAdmin, createProduct);  // Create A Product
router.put("/:id", protectAdmin, updateProduct);    // Update a Product
router.delete("/:id", protectAdmin, deleteProduct);  // Delete a Product.

export default router;