
import express from "express";

import {
  initiatePayUPayment,
  handlePayUResponse,
} from "../controllers/paymentController.js";

const router = express.Router();

// Initiate PayU payment
router.post("/payu", initiatePayUPayment);

// Handle successful and failed PayU responses
router.post("/payu/success", handlePayUResponse);
router.post("/payu/failure", handlePayUResponse);

// General PayU callback
router.post("/callback", handlePayUResponse);

export default router;
