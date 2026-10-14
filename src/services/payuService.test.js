
import { describe, test, expect } from "bun:test";
import crypto from "crypto";
import { verifyPayUResponseHash } from "./payuService.js";

const makeResponseHash = (response) => {
  const {
    status,
    udf1 = "",
    udf2 = "",
    udf3 = "",
    udf4 = "",
    udf5 = "",
    email,
    firstname,
    productinfo,
    amount,
    txnid,
    key,
  } = response;

  const hashString = [
    process.env.PAYU_MERCHANT_SALT,
    status,
    "",
    "",
    "",
    "",
    "",
    udf5,
    udf4,
    udf3,
    udf2,
    udf1,
    email,
    firstname,
    productinfo,
    amount,
    txnid,
    key,
  ].join("|");

  return crypto
    .createHash("sha512")
    .update(hashString)
    .digest("hex");
};

describe("PayU response hash verification", () => {
  test("accepts a correctly generated failure response hash", () => {
    expect(process.env.PAYU_MERCHANT_KEY).toBeTruthy();
    expect(process.env.PAYU_MERCHANT_SALT).toBeTruthy();

    const response = {
      txnid: "LOCAL-TEST-001",
      status: "failure",
      amount: "928.00",
      email: "rahul.test@example.com",
      firstname: "Rahul Sharma",
      productinfo: "ThreadsRepublic Order",
      key: process.env.PAYU_MERCHANT_KEY,
    };

    response.hash = makeResponseHash(response);

    expect(verifyPayUResponseHash(response)).toBe(true);
  });

  test("rejects a modified response", () => {
    const response = {
      txnid: "LOCAL-TEST-002",
      status: "failure",
      amount: "928.00",
      email: "rahul.test@example.com",
      firstname: "Rahul Sharma",
      productinfo: "ThreadsRepublic Order",
      key: process.env.PAYU_MERCHANT_KEY,
    };

    response.hash = makeResponseHash(response);

    // Change the amount after generating the hash.
    response.amount = "929.00";

    expect(verifyPayUResponseHash(response)).toBe(false);
  });

  test("rejects a response with the wrong merchant key", () => {
    const response = {
      txnid: "LOCAL-TEST-003",
      status: "failure",
      amount: "928.00",
      email: "rahul.test@example.com",
      firstname: "Rahul Sharma",
      productinfo: "ThreadsRepublic Order",
      key: process.env.PAYU_MERCHANT_KEY,
    };

    response.hash = makeResponseHash(response);
    response.key = "WRONG_MERCHANT_KEY";

    expect(verifyPayUResponseHash(response)).toBe(false);
  });
});
