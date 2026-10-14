
import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    // Optional because reviews can be submitted by guests.
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: undefined,
    },

    // Optional because a guest does not need to provide an order ID.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: false,
      default: undefined,
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: "Rating must be a whole number from 1 to 5.",
      },
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    // You can manually change this after checking the purchase.
    isVerifiedPurchase: {
      type: Boolean,
      default: false,
    },

    // Reviews remain hidden until you approve them.
    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// Do not use the old unique index for guest reviews.
// Multiple guests must be able to review the same product.

export default mongoose.model("Review", reviewSchema);
