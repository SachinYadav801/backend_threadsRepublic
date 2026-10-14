import express from "express";
import {
  getProductReviews,
  createReview,
  moderateReview,
} from "../controllers/reviewController.js";
import protectAdmin from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/product/:productId", getProductReviews);
router.post("/", createReview);
router.patch("/:reviewId/moderation", protectAdmin, moderateReview);

export default router;