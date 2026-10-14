import mongoose from "mongoose";

const variantSchema = new mongoose.Schema(

  {
    size: {
      type: String,
      trim: true,
    },

    color: {
      name: {
        type: String,
        trim: true,
      },
      hex: {
        type: String,
        trim: true,
      },
    },

    sku: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    stock: {
      type: Number,
      default: 0,
      min: 0,
    },

    reservedStock: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: true }

);

const productSchema = new mongoose.Schema(

  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    compareAtPrice: {
      type: Number,
      default: null,
      min: 0,
    },

    images: [
      {
        type: String,
        trim: true,
      },
    ],

    colorImages: [
      {
        _id: false,
        color: {
          type: String,
          required: true,
          trim: true,
        },
        images: [
          {
            type: String,
            trim: true,
          },
        ],
      },
    ],


    relatedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],


    category: {
      type: String,
      trim: true,
    },

    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    variants: [variantSchema],

    isFeatured: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }

);

const Product = mongoose.model("Product", productSchema);

export default Product;