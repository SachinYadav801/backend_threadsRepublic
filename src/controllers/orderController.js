import mongoose from "mongoose";

import Order from "../models/Order.js";
import Product from "../models/Product.js";

import {
  reserveProductStock,
  releaseProductStock,
  commitProductStock,
} from "../services/inventoryService.js";

/*
|--------------------------------------------------------------------------
| Generate Human-Readable Order Number
|--------------------------------------------------------------------------
|
| Example:
| TR-12345678-4821
|
*/

const generateOrderNumber = () => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(1000 + Math.random() * 9000);

  return `TR-${timestamp}-${random}`;
};

/*
|--------------------------------------------------------------------------
| CREATE ORDER
|--------------------------------------------------------------------------
|
| POST /api/orders
|
| Flow:
|
| PAYU:
|   Validate
|      ↓
|   Reserve inventory
|      ↓
|   Create order
|      ↓
|   Commit transaction
|      ↓
|   Wait for PayU
|
| COD:
|   Validate
|      ↓
|   Reserve inventory
|      ↓
|   Create order
|      ↓
|   Commit inventory
|      ↓
|   Mark CONFIRMED
|      ↓
|   Commit transaction
|
|--------------------------------------------------------------------------
*/

export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      items,
      shippingAddress,
      paymentMethod,
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | 1. Validate Items
    |--------------------------------------------------------------------------
    */

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Order must contain at least one product",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Prevent absurdly large orders
    |--------------------------------------------------------------------------
    */

    if (items.length > 50) {
      return res.status(400).json({
        success: false,
        message:
          "Order contains too many different products",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Validate Shipping Address
    |--------------------------------------------------------------------------
    */

    if (!shippingAddress) {
      return res.status(400).json({
        success: false,
        message: "Shipping address is required",
      });
    }

    const requiredAddressFields = [
      "fullName",
      "phone",
      "address",
      "city",
      "state",
      "pincode",
    ];

    for (const field of requiredAddressFields) {
      if (
        !shippingAddress[field] ||
        !shippingAddress[field]
          .toString()
          .trim()
      ) {
        return res.status(400).json({
          success: false,
          message: `${field} is required`,
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Basic phone validation
    |--------------------------------------------------------------------------
    */

    const phone = shippingAddress.phone
      .toString()
      .trim();

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Basic pincode validation
    |--------------------------------------------------------------------------
    */

    const pincode = shippingAddress.pincode
      .toString()
      .trim();

    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        message: "Invalid pincode",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | 3. Validate Payment Method
    |--------------------------------------------------------------------------
    */

    if (
      !["PAYU", "COD"].includes(paymentMethod)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | 4. Start MongoDB Transaction
    |--------------------------------------------------------------------------
    */

    let createdOrder = null;

    await session.withTransaction(async () => {
      const orderItems = [];

      let subtotal = 0;

      /*
      |--------------------------------------------------------------------------
      | 5. Validate Products + Variants
      |--------------------------------------------------------------------------
      */

      for (const item of items) {
        /*
        |--------------------------------------------------------------------------
        | Validate Product ID
        |--------------------------------------------------------------------------
        */

        if (
          !item.product ||
          !mongoose.Types.ObjectId.isValid(
            item.product
          )
        ) {
          throw new Error(
            "Invalid product ID"
          );
        }

        /*
        |--------------------------------------------------------------------------
        | Validate Variant ID
        |--------------------------------------------------------------------------
        */

        if (
          !item.variantId ||
          !mongoose.Types.ObjectId.isValid(
            item.variantId
          )
        ) {
          throw new Error(
            "Invalid variant ID"
          );
        }

        /*
        |--------------------------------------------------------------------------
        | Validate Quantity
        |--------------------------------------------------------------------------
        */

        const quantity = Number(item.quantity);

        if (
          !Number.isInteger(quantity) ||
          quantity < 1
        ) {
          throw new Error(
            "Invalid product quantity"
          );
        }

        /*
        |--------------------------------------------------------------------------
        | Optional maximum quantity per line
        |--------------------------------------------------------------------------
        |
        | Prevents someone from requesting ridiculous quantities.
        |
        */

        if (quantity > 100) {
          throw new Error(
            "Maximum quantity per product is 100"
          );
        }

        /*
        |--------------------------------------------------------------------------
        | Load Product
        |--------------------------------------------------------------------------
        */

        const product =
          await Product.findOne({
            _id: item.product,
            isActive: true,
          }).session(session);

        if (!product) {
          throw new Error(
            `Product not found: ${item.product}`
          );
        }

        /*
        |--------------------------------------------------------------------------
        | Find Exact Variant
        |--------------------------------------------------------------------------
        */

        const selectedVariant =
          product.variants?.find(
            (variant) =>
              variant._id.toString() ===
              item.variantId.toString()
          );

        if (!selectedVariant) {
          throw new Error(
            `Selected variant unavailable for ${product.name}`
          );
        }

        /*
        |--------------------------------------------------------------------------
        | Validate Product Price
        |--------------------------------------------------------------------------
        |
        | IMPORTANT:
        | Never trust price coming from frontend.
        |
        */

        const price = Number(product.price);

        if (
          !Number.isFinite(price) ||
          price < 0
        ) {
          throw new Error(
            `Invalid price for ${product.name}`
          );
        }

        /*
        |--------------------------------------------------------------------------
        | Check Available Stock
        |--------------------------------------------------------------------------
        |
        | This is only an early user-friendly check.
        |
        | The actual race-condition protection is performed by
        | reserveProductStock(), which performs the atomic
        | database operation.
        |
        */

        const availableStock =
          Number(selectedVariant.stock || 0) -
          Number(
            selectedVariant.reservedStock || 0
          );

        if (availableStock < quantity) {
          throw new Error(
            `Not enough stock for ${product.name}`
          );
        }

        /*
        |--------------------------------------------------------------------------
        | Create Order Item Snapshot
        |--------------------------------------------------------------------------
        */

        orderItems.push({
          product: product._id,

          variantId: selectedVariant._id,

          name: product.name,

          image:
            product.images?.[0] || "",

          price,

          quantity,

          size:
            selectedVariant.size || "",

          color: {
            name:
              selectedVariant.color?.name ||
              "",

            hex:
              selectedVariant.color?.hex ||
              "",
          },

          inventoryCommitted: false,
        });

        subtotal +=
          price * quantity;
      }

      /*
      |--------------------------------------------------------------------------
      | 6. Reserve Inventory
      |--------------------------------------------------------------------------
      |
      | IMPORTANT:
      |
      | reserveProductStock() performs the actual atomic
      | stock check + reservation.
      |
      | Because it receives the transaction session, if ANY
      | item fails, all reservations roll back automatically.
      |
      */

      for (const item of orderItems) {
        await reserveProductStock({
          productId: item.product,
          variantId: item.variantId,
          quantity: item.quantity,
          session,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | 7. Calculate Shipping
      |--------------------------------------------------------------------------
      */

      const shippingCharge =
        subtotal >= 999 ? 0 : 79;

      const totalAmount =
        subtotal + shippingCharge;

      /*
      |--------------------------------------------------------------------------
      | 8. Create Order
      |--------------------------------------------------------------------------
      */

      const orders = await Order.create(
        [
          {
            orderNumber:
              generateOrderNumber(),

            items: orderItems,

            shippingAddress: {
              fullName:
                shippingAddress.fullName
                  .toString()
                  .trim(),

              phone,

              email:
                shippingAddress.email
                  ?.toString()
                  .trim()
                  .toLowerCase() || "",

              address:
                shippingAddress.address
                  .toString()
                  .trim(),

              city:
                shippingAddress.city
                  .toString()
                  .trim(),

              state:
                shippingAddress.state
                  .toString()
                  .trim(),

              pincode,
            },

            subtotal,

            shippingCharge,

            totalAmount,

            paymentMethod,

            /*
             * PAYU:
             * Payment hasn't happened yet.
             *
             * COD:
             * Don't mark it PAID here.
             *
             * COD means payment happens on delivery.
             */
            paymentStatus: "PENDING",

            orderStatus: "PENDING",
          },
        ],
        {
          session,
        }
      );

      createdOrder = orders[0];

      /*
      |--------------------------------------------------------------------------
      | 9. COD Inventory Commit
      |--------------------------------------------------------------------------
      |
      | COD has no future online payment callback.
      |
      | Therefore inventory is committed immediately.
      |
      | This happens inside the SAME MongoDB transaction.
      |
      */

      // // this is for COD orders
      // if (paymentMethod === "COD") {
      //   for (const item of createdOrder.items) {
      //     await commitProductStock({
      //       productId: item.product,
      //       variantId: item.variantId,
      //       quantity: item.quantity,
      //       session,
      //     });

      //     item.inventoryCommitted = true;
      //   }

      //   await createdOrder.save({
      //     session,
      //   });
      // }


    });

    /*
    |--------------------------------------------------------------------------
    | 10. Return Created Order
    |--------------------------------------------------------------------------
    */

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: createdOrder,
    });
  } catch (error) {
    console.error(
      "Create order error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Unable to create order",
    });
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| GET ALL ORDERS
|--------------------------------------------------------------------------
|
| GET /api/orders/admin/all
|
|--------------------------------------------------------------------------
*/

export const getAllOrders = async (
  req,
  res
) => {
  try {

    const orders = await Order.find()
      .sort({
        createdAt: -1,
      })
      .populate(
        "items.product",
        "name slug images"
      );

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error(
      "Get all orders error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to fetch orders",
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET SINGLE ORDER
|--------------------------------------------------------------------------
|
| GET /api/orders/admin/:id
|
|--------------------------------------------------------------------------
*/

export const getOrderById = async (
  req,
  res
) => {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const order =
      await Order.findById(
        req.params.id
      ).populate(
        "items.product",
        "name slug images price"
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error(
      "Get order error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to fetch order",
    });
  }
};

/*
|--------------------------------------------------------------------------
| ORDER STATUS TRANSITIONS
|--------------------------------------------------------------------------
|
| We use explicit transitions instead of simply comparing numbers.
|
| PENDING
|   ├── CONFIRMED
|   └── CANCELLED
|
| CONFIRMED
|   ├── PROCESSING
|   └── CANCELLED (only if inventory hasn't been committed)
|
| PROCESSING
|   └── SHIPPED
|
| SHIPPED
|   └── DELIVERED
|
| DELIVERED
|   └── no normal transition
|
| CANCELLED
|   └── no normal transition
|
|--------------------------------------------------------------------------
*/

const allowedOrderTransitions = {
  PENDING: [
    "CONFIRMED",
    "CANCELLED",
  ],

  CONFIRMED: [
    "PROCESSING",
    "CANCELLED",
  ],

  PROCESSING: [
    "SHIPPED",
  ],

  SHIPPED: [
    "DELIVERED",
  ],

  DELIVERED: [],

  CANCELLED: [],
};

/*
|--------------------------------------------------------------------------
| UPDATE ORDER STATUS
|--------------------------------------------------------------------------
|
| PUT /api/orders/admin/:id/status
|
|--------------------------------------------------------------------------
*/

export const updateOrderStatus = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    const { id } = req.params;
    const { status } = req.body;

    /*
    |--------------------------------------------------------------------------
    | Validate Order ID
    |--------------------------------------------------------------------------
    */

    if (
      !mongoose.Types.ObjectId.isValid(id)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Validate Status
    |--------------------------------------------------------------------------
    */

    const allowedStatuses = [
      "PENDING",
      "CONFIRMED",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
    ];

    if (
      !allowedStatuses.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid order status",
      });
    }

    let updatedOrder = null;

    /*
    |--------------------------------------------------------------------------
    | Transaction
    |--------------------------------------------------------------------------
    */

    await session.withTransaction(
      async () => {
        const order =
          await Order.findById(id).session(
            session
          );

        if (!order) {
          throw new Error(
            "Order not found"
          );
        }

        const currentStatus =
          order.orderStatus;

        /*
        |--------------------------------------------------------------------------
        | No-op
        |--------------------------------------------------------------------------
        */

        if (currentStatus === status) {
          updatedOrder = order;
          return;
        }

        /*
        |--------------------------------------------------------------------------
        | Validate Transition
        |--------------------------------------------------------------------------
        */

        const possibleTransitions =
          allowedOrderTransitions[
          currentStatus
          ] || [];

        if (
          !possibleTransitions.includes(
            status
          )
        ) {
          throw new Error(
            `Cannot move order from ${currentStatus} to ${status}`
          );
        }

        /*
        |--------------------------------------------------------------------------
        | CONFIRMED
        |--------------------------------------------------------------------------
        |
        | PAYU must actually be paid.
        |
        | COD can be confirmed because payment is
        | collected on delivery.
        |
        */

        if (status === "CONFIRMED") {
          // PayU orders must be paid through verified PayU callbacks.
          if (
            order.paymentMethod === "PAYU" &&
            order.paymentStatus !== "PAID"
          ) {
            throw new Error(
              "Cannot confirm an unpaid online order"
            );
          }

          if (
            order.paymentMethod === "PAYU" &&
            !order.items.every((item) => item.inventoryCommitted)
          ) {
            throw new Error(
              "Order inventory has not been committed"
            );
          }

          // COD: commit the reserved inventory when admin confirms.
          if (order.paymentMethod === "COD") {
            for (const item of order.items) {
              if (item.inventoryCommitted) {
                continue;
              }

              await commitProductStock({
                productId: item.product,
                variantId: item.variantId,
                quantity: item.quantity,
                session,
              });

              item.inventoryCommitted = true;
            }
          }
        }

        /*
        |--------------------------------------------------------------------------
        | CANCEL ORDER
        |--------------------------------------------------------------------------
        */

        if (status === "CANCELLED") {
          /*
           * If any inventory has already been committed,
           * we cannot simply call releaseProductStock().
           *
           * releaseProductStock() only releases reservations.
           *
           * A committed order requires a separate return/restock
           * operation.
           */
          const hasCommittedInventory =
            order.items.some(
              (item) =>
                item.inventoryCommitted
            );

          if (hasCommittedInventory) {
            throw new Error(
              "This order has committed inventory and cannot be cancelled automatically"
            );
          }

          /*
           * Release reservations.
           */
          for (const item of order.items) {
            if (
              item.inventoryCommitted
            ) {
              continue;
            }

            if (!item.variantId) {
              throw new Error(
                `Variant ID missing for ${item.name}`
              );
            }

            await releaseProductStock({
              productId: item.product,
              variantId: item.variantId,
              quantity: item.quantity,
              session,
            });
          }

          /*
           * If this was an unpaid PAYU order,
           * it is a failed/cancelled payment.
           */
          if (
            order.paymentStatus !== "PAID"
          ) {
            order.paymentStatus =
              "FAILED";
          }

          order.orderStatus =
            "CANCELLED";

          await order.save({
            session,
          });

          updatedOrder = order;

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | Normal Status Update
        |--------------------------------------------------------------------------
        */

        order.orderStatus = status;

        await order.save({
          session,
        });

        updatedOrder = order;
      }
    );

    return res.status(200).json({
      success: true,
      message:
        "Order status updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    console.error(
      "Update order status error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Unable to update order status",
    });
  } finally {
    await session.endSession();
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE PAYMENT STATUS
|--------------------------------------------------------------------------
|
| PUT /api/orders/admin/:id/payment-status
|
| IMPORTANT:
|
| The admin panel must NOT be able to simply change
| a PAYU order to PAID.
|
| PayU payment status must come from a verified PayU
| callback.
|
|--------------------------------------------------------------------------
*/


export const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // 1. Validate Order ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    // 2. Validate Payment Status
    const allowedStatuses = [
      "PENDING",
      "PAID",
      "FAILED",
      "REFUNDED",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status",
      });
    }

    // 3. Find Order
    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // 4. Protect PayU Payments
    // PayU payments must be verified through the actual PayU callback.
    if (
      status === "PAID" &&
      order.paymentMethod === "PAYU" &&
      order.paymentStatus !== "PAID"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "PayU orders can only be marked as paid through a verified PayU callback.",
      });
    }

    // 5. COD Payments
    // COD can only be marked as paid after delivery and collection.
    if (
      status === "PAID" &&
      order.paymentMethod === "COD" &&
      order.orderStatus !== "DELIVERED"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "COD payment can only be marked as paid after delivery and collection.",
      });
    }

    // 6. Prevent PAID → FAILED
    if (
      order.paymentStatus === "PAID" &&
      status === "FAILED"
    ) {
      return res.status(400).json({
        success: false,
        message: "A paid order cannot be marked as failed.",
      });
    }

    // 7. Validate Refund
    if (status === "REFUNDED") {
      if (order.paymentStatus !== "PAID") {
        return res.status(400).json({
          success: false,
          message: "Only paid orders can be refunded.",
        });
      }

      // Actual refund processing should be handled separately
      // through the payment provider.
    }

    // 8. Update Payment Status
    order.paymentStatus = status;

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
      order,
    });
  } catch (error) {
    console.error("Update payment status error:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Unable to update payment status",
    });
  }
};
