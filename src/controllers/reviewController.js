
import mongoose from "mongoose";
import Review from "../models/Review.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const getProductRatingSummary = async (productId) => {
  const [summary] = await Review.aggregate([
    {
      $match: {
        product: new mongoose.Types.ObjectId(productId),
        isPublished: true,
      },
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
        fiveStars: {
          $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] },
        },
        fourStars: {
          $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] },
        },
        threeStars: {
          $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] },
        },
        twoStars: {
          $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] },
        },
        oneStar: {
          $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] },
        },
      },
    },
  ]);

  return {
    averageRating: summary
      ? Number(summary.averageRating.toFixed(1))
      : 0,
    totalReviews: summary?.totalReviews || 0,
    ratingDistribution: {
      5: summary?.fiveStars || 0,
      4: summary?.fourStars || 0,
      3: summary?.threeStars || 0,
      2: summary?.twoStars || 0,
      1: summary?.oneStar || 0,
    },
  };
};

// GET /api/reviews/product/:productId
export const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    const product = await Product.findOne({
      _id: productId,
      isActive: true,
    }).select("_id");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    );

    const sortOptions = {
      newest: { createdAt: -1 },
      highest: { rating: -1, createdAt: -1 },
      lowest: { rating: 1, createdAt: -1 },
    };

    const sort = sortOptions[req.query.sort] || sortOptions.newest;

    const [reviews, summary] = await Promise.all([
      Review.find({
        product: productId,
        isPublished: true,
      })
        .populate("customer", "name")
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      getProductRatingSummary(productId),
    ]);

    const formattedReviews = reviews.map((review) => ({
      _id: review._id,
      customerName: review.customer?.name || "Customer",
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      isVerifiedPurchase: review.isVerifiedPurchase,
      isPublished: review.isPublished,
      createdAt: review.createdAt,
    }));

    return res.status(200).json({
      success: true,
      reviews: formattedReviews,
      summary,
      pagination: {
        page,
        limit,
        hasMore: formattedReviews.length === limit,
      },
    });
  } catch (error) {
    console.error("getProductReviews error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch reviews.",
    });
  }
};

// POST /api/reviews
// Requires authenticated customer

 // POST /api/reviews
 // Public guest review submission
 export const createReview = async (req, res) => {
    try {
      const { productId, rating, title, comment } = req.body;
  
      if (!isValidObjectId(productId)) {
        return res.status(400).json({
          success: false,
          message: "A valid product ID is required.",
        });
      }
  
      if (
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
      ) {
        return res.status(400).json({
          success: false,
          message: "Rating must be a whole number from 1 to 5.",
        });
      }
  
      if (
        typeof title !== "string" ||
        !title.trim() ||
        title.trim().length > 100 ||
        typeof comment !== "string" ||
        !comment.trim() ||
        comment.trim().length > 2000
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a title and review within the allowed length.",
        });
      }
  
      const product = await Product.findOne({
        _id: productId,
        isActive: true,
      }).select("_id");
  
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found.",
        });
      }
  
      // Never trust verification or publication flags from the client.
      const review = await Review.create({
        product: product._id,
        rating,
        title: title.trim(),
        comment: comment.trim(),
        isVerifiedPurchase: false,
        isPublished: false,
      });
  
      return res.status(201).json({
        success: true,
        message:
          "Thank you! Your review has been submitted and is awaiting approval.",
        review: {
          _id: review._id,
          rating: review.rating,
          title: review.title,
          comment: review.comment,
          isVerifiedPurchase: review.isVerifiedPurchase,
          isPublished: review.isPublished,
          createdAt: review.createdAt,
        },
      });
    } catch (error) {
      console.error("createReview error:", error);
  
      return res.status(500).json({
        success: false,
        message: "Failed to submit review.",
      });
    }
  };

  // PATCH /api/reviews/:reviewId/moderation
// Requires admin authorization
export const moderateReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { isPublished } = req.body;

    if (!isValidObjectId(reviewId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID.",
      });
    }

    if (typeof isPublished !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isPublished must be true or false.",
      });
    }

    const review = await Review.findByIdAndUpdate(
      reviewId,
      { $set: { isPublished } },
      { new: true, runValidators: true }
    );

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: isPublished
        ? "Review approved."
        : "Review hidden.",
      review,
    });
  } catch (error) {
    console.error("moderateReview error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update review moderation.",
    });
  }
};
