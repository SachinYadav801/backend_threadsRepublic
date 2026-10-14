import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| ORDER ITEM SCHEMA
|--------------------------------------------------------------------------
*/

const orderItemSchema = new mongoose.Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Product reference
    |--------------------------------------------------------------------------
    */

    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Exact Variant Purchased
    |--------------------------------------------------------------------------
    |
    | This is now REQUIRED.
    |
    | Inventory is identified by:
    |
    | product + variantId
    |
    | We no longer depend on:
    |
    | product + size + color
    |
    */

    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Product Snapshot
    |--------------------------------------------------------------------------
    |
    | These values are copied into the order so an old order
    | doesn't change when the product is edited later.
    |
    */

    name: {
      type: String,
      required: true,
      trim: true,
    },

    image: {
      type: String,
      default: "",
    },

    /*
    |--------------------------------------------------------------------------
    | Price Snapshot
    |--------------------------------------------------------------------------
    |
    | This is the price at the moment the order was created.
    |
    | We NEVER use the current Product.price when displaying
    | an old order.
    |
    */

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Quantity
    |--------------------------------------------------------------------------
    */

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    /*
    |--------------------------------------------------------------------------
    | Variant Snapshot
    |--------------------------------------------------------------------------
    |
    | variantId is the source of truth.
    |
    | size/color are only snapshots for displaying the order.
    |
    */

    size: {
      type: String,
      default: "",
      trim: true,
    },

    color: {
      name: {
        type: String,
        default: "",
        trim: true,
      },

      hex: {
        type: String,
        default: "",
        trim: true,
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Inventory State
    |--------------------------------------------------------------------------
    |
    | false:
    | Inventory is reserved but not permanently deducted.
    |
    | true:
    | Inventory has been committed/deducted.
    |
    | This protects against duplicate inventory commits.
    |
    */

    inventoryCommitted: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  }
);

/*
|--------------------------------------------------------------------------
| SHIPPING ADDRESS SCHEMA
|--------------------------------------------------------------------------
*/

const addressSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    city: {
      type: String,
      required: true,
      trim: true,
    },

    state: {
      type: String,
      required: true,
      trim: true,
    },

    pincode: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    _id: false,
  }
);

/*
|--------------------------------------------------------------------------
| ORDER SCHEMA
|--------------------------------------------------------------------------
*/

const orderSchema = new mongoose.Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Human-readable Order Number
    |--------------------------------------------------------------------------
    |
    | Example:
    |
    | TR-12345678-4821
    |
    */

    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Products Purchased
    |--------------------------------------------------------------------------
    */

    items: {
      type: [orderItemSchema],
      required: true,

      validate: {
        validator: (items) =>
          Array.isArray(items) &&
          items.length > 0,

        message:
          "Order must contain at least one item",
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Customer Shipping Information
    |--------------------------------------------------------------------------
    */

    shippingAddress: {
      type: addressSchema,
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Amount Before Shipping
    |--------------------------------------------------------------------------
    */

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Shipping Charge
    |--------------------------------------------------------------------------
    */

    shippingCharge: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Final Order Amount
    |--------------------------------------------------------------------------
    */

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Payment Method
    |--------------------------------------------------------------------------
    */

    paymentMethod: {
      type: String,
      enum: ["PAYU", "COD"],
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Payment Status
    |--------------------------------------------------------------------------
    |
    | PENDING
    |   Payment hasn't been completed.
    |
    | PAID
    |   Payment successfully verified.
    |
    | FAILED
    |   Payment failed.
    |
    | REFUNDED
    |   Payment was refunded.
    |
    */

    paymentStatus: {
      type: String,
      enum: [
        "PENDING",
        "PAID",
        "FAILED",
        "REFUNDED",
      ],
      default: "PENDING",
    },

    /*
    |--------------------------------------------------------------------------
    | Order Status
    |--------------------------------------------------------------------------
    |
    | PENDING
    | CONFIRMED
    | PROCESSING
    | SHIPPED
    | DELIVERED
    | CANCELLED
    | RETURNED
    |
    */

    orderStatus: {
      type: String,
      enum: [
        "PENDING",
        "CONFIRMED",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "RETURNED",
      ],
      default: "PENDING",
    },

    /*
    |--------------------------------------------------------------------------
    | PAYU Transaction ID
    |--------------------------------------------------------------------------
    |
    | Generated by our backend.
    |
    */

    payuTxnId: {
      type: String,
      default: undefined,
    },

    /*
    |--------------------------------------------------------------------------
    | PAYU Payment ID
    |--------------------------------------------------------------------------
    |
    | Usually PayU's mihpayid.
    |
    */

    payuPaymentId: {
      type: String,
      default: null,
      index: true,
    },
  },

  /*
  |--------------------------------------------------------------------------
  | Timestamps
  |--------------------------------------------------------------------------
  */

  {
    timestamps: true,
  }
);

/*
|--------------------------------------------------------------------------
| INDEXES
|--------------------------------------------------------------------------
*/

/*
 * Useful for admin order list.
 */

orderSchema.index(
  { payuTxnId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      payuTxnId: { $type: "string" },
    },
  }
);

orderSchema.index({
  createdAt: -1,
});

/*
 * Useful for filtering orders.
 */
orderSchema.index({
  orderStatus: 1,
});

orderSchema.index({
  paymentStatus: 1,
});

orderSchema.index({
  paymentMethod: 1,
});

/*
|--------------------------------------------------------------------------
| MODEL
|--------------------------------------------------------------------------
*/

const Order = mongoose.model(
  "Order",
  orderSchema
);

export default Order;