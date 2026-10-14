import { log } from "console";
import Order from "../models/Order.js";
import {
  commitProductStock,
  releaseProductStock,
} from "../services/inventoryService.js";

import {
  createPayUHash,
  verifyPayUResponseHash,
} from "../services/payuService.js";

import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| INITIATE PAYU PAYMENT
|--------------------------------------------------------------------------
*/



export const initiatePayUPayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        message: "Order ID is required",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    if (order.paymentMethod !== "PAYU") {
      return res.status(400).json({
        message: "This order is not an online payment order",
      });
    }

    if (order.paymentStatus === "PAID") {
      return res.status(400).json({
        message: "Order has already been paid",
      });
    }

    if (["FAILED", "REFUNDED"].includes(order.paymentStatus)) {
      return res.status(400).json({
        message: "This order cannot be paid in its current state",
      });
    }

    for (const item of order.items) {
      if (!item.variantId) {
        return res.status(400).json({
          message: `Variant information missing for ${item.name}`,
        });
      }
    }

    // Reuse an existing transaction ID for retries.
    const txnid =
      order.payuTxnId || `TR-${order._id}-${Date.now()}`;

    const paymentData = {
      txnid,
      amount: Number(order.totalAmount).toFixed(2),
      productinfo: "ThreadsRepublic Order",
      firstname: order.shippingAddress.fullName,
      phone: order.shippingAddress.phone,
      surl: process.env.PAYU_SUCCESS_URL,
      furl: process.env.PAYU_FAILURE_URL,
      email:
        order.shippingAddress.email ||
        process.env.PAYU_DEFAULT_EMAIL ||
        "customer@threadsrepublic.com",
    };

    const hash = createPayUHash(paymentData);

    if (!order.payuTxnId) {
      order.payuTxnId = txnid;
      order.paymentStatus = "PENDING";
      await order.save();
    }

    return res.json({
      success: true,
      paymentUrl: process.env.PAYU_PAYMENT_URL,
      orderId: order._id,
      data: {
        ...paymentData,
        key: process.env.PAYU_MERCHANT_KEY,
        hash,
      },
    });
  } catch (error) {
    console.error("PayU initiation error:", error);

    return res.status(500).json({
      message: error.message || "Unable to initiate payment",
    });
  }
};


/*
|--------------------------------------------------------------------------
| RELEASE ORDER INVENTORY
|--------------------------------------------------------------------------
|
| This helper releases ONLY items that have not already been
| committed.
|
*/
const releaseOrderInventory = async (order) => {
  for (const item of order.items) {
    if (item.inventoryCommitted) {
      continue;
    }

    if (!item.variantId) {
      console.error(
        `Missing variantId for order item ${item._id}`
      );

      continue;
    }

    try {
      await releaseProductStock({
        productId: item.product,
        variantId: item.variantId,
        quantity: item.quantity,
      });
    } catch (error) {
      /*
       * We don't want one failed release to prevent the
       * remaining reservations from being released.
       */
      console.error(
        `Inventory release failed for ${order._id}:`,
        error
      );
    }
  }
};

/*
|--------------------------------------------------------------------------
| COMMIT ORDER INVENTORY
|--------------------------------------------------------------------------
|
| Called after successful payment.
|
*/

const commitOrderInventory = async (order) => {
  const session = await mongoose.startSession();

  try {
    let updatedOrder;

    await session.withTransaction(async () => {
      /*
       * Reload the order inside the transaction.
       *
       * This is important because the callback may arrive more
       * than once.
       */
      const freshOrder = await Order.findById(order._id).session(
        session
      );

      if (!freshOrder) {
        throw new Error("Order not found");
      }

      /*
       * Already completely committed.
       *
       * This makes the operation idempotent.
       */
      if (
        freshOrder.paymentStatus === "PAID" &&
        freshOrder.items.every(
          (item) => item.inventoryCommitted
        )
      ) {
        updatedOrder = freshOrder;
        return;
      }

      for (const item of freshOrder.items) {
        /*
         * If this item was committed by an earlier attempt,
         * don't commit it again.
         */
        if (item.inventoryCommitted) {
          continue;
        }

        if (!item.variantId) {
          throw new Error(
            `Variant ID missing for ${item.name}`
          );
        }

        await commitProductStock({
          productId: item.product,
          variantId: item.variantId,
          quantity: item.quantity,
          session,
        });

        item.inventoryCommitted = true;
      }

      freshOrder.paymentStatus = "PAID";
      freshOrder.orderStatus = "CONFIRMED";

      await freshOrder.save({ session });

      updatedOrder = freshOrder;
    });

    return updatedOrder;
  } finally {
    await session.endSession();
  }
};


/*
|--------------------------------------------------------------------------
| PAYU CALLBACK
|--------------------------------------------------------------------------
*/
export const handlePayUResponse = async (req, res) => {

  try {
    const response = req.body;

    console.log("PayU response:", response);

    const {
      txnid,
      mihpayid,
      status,
      amount,
    } = response;

    if (!txnid) {
      return res.status(400).send("Invalid payment response");
    }

    const order = await Order.findOne({
      payuTxnId: txnid,
    });

    if (!order) {
      return res.status(404).send("Order not found");
    }

    /*
     * ALWAYS verify the PayU hash before trusting the response.
     */
    const isValidHash = verifyPayUResponseHash(response);

    if (!isValidHash) {

      console.error(
        `Invalid PayU hash for transaction ${txnid}`
      );

      return res.status(400).send("Invalid payment hash");
    }

    /*
     * Verify the amount returned by PayU against the amount
     * stored in our database.
     */
    const returnedAmount = Number(amount);
    const expectedAmount = Number(order.totalAmount);

    if (
      !Number.isFinite(returnedAmount) ||
      Math.abs(returnedAmount - expectedAmount) > 0.01
    ) {
      console.error(
        `Amount mismatch for ${order._id}. Expected ${expectedAmount}, received ${returnedAmount}`
      );

      return res.status(400).send("Payment amount mismatch");
    }


    console.log("############ We run pasded amount checking")

    /*
     * Store PayU's payment ID if available.
     */
    if (mihpayid) {
      order.payuPaymentId = mihpayid;
    }

    console.log("PayId checking##################");

    /*
    |--------------------------------------------------------------------------
    | SUCCESS
    |--------------------------------------------------------------------------
    */
    if (status === "success") {
      // Handle a duplicate callback without committing stock again.
      if (
        order.paymentStatus === "PAID" &&
        order.items.every(
          (item) => item.inventoryCommitted === true
        )
      ) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/order-success?orderId=${order._id}`
        );
      }

      try {
        // This function reloads and commits the order in a transaction.
        const committedOrder = await commitOrderInventory(order);

        // Use the fresh document returned by the transaction.
        // Do not save the older order document here.
        return res.redirect(
          `${process.env.FRONTEND_URL}/order-success?orderId=${committedOrder._id}`
        );
      } catch (inventoryError) {
        console.error(
          `Inventory commit failed after successful payment for ${order._id}:`,
          inventoryError
        );

        // Payment may already have succeeded at PayU.
        // Do not release inventory or mark the payment failed here.
        // This order requires reconciliation.
        return res.status(500).send(
          "Payment received but order inventory could not be committed"
        );
      }

      console.log("################ CHecking transaction Success ################");


      order.paymentStatus = "PAID";
      order.orderStatus = "CONFIRMED";

      await order.save();

      return res.redirect(
        `${process.env.FRONTEND_URL}/order-success?orderId=${order._id}`
      );
    }

    /*
    |--------------------------------------------------------------------------
    | FAILURE
    |--------------------------------------------------------------------------
    */
    if (
      status === "failure" ||
      status === "failed"
    ) {
      /*
       * IDEMPOTENCY:
       *
       * If the order is already failed, don't release stock again.
       */
      if (order.paymentStatus === "FAILED") {
        await order.save();

        return res.redirect(
          `${process.env.FRONTEND_URL}/payment-failed?orderId=${order._id}`
        );
      }

      await releaseOrderInventory(order);

      order.paymentStatus = "FAILED";
      order.orderStatus = "CANCELLED";

      await order.save();

      return res.redirect(
        `${process.env.FRONTEND_URL}/payment-failed?orderId=${order._id}`
      );
    }

    /*
    |--------------------------------------------------------------------------
    | UNKNOWN / PENDING STATUS
    |--------------------------------------------------------------------------
    */
    order.paymentStatus = "PENDING";

    await order.save();

    return res.redirect(
      `${process.env.FRONTEND_URL}/checkout?payment=pending&orderId=${order._id}`
    );
  } catch (error) {
    console.error("PayU response error:", error);

    return res.status(500).send(
      error.message || "Payment processing failed"
    );
  }
};