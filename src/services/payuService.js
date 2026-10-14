
import crypto from "crypto";

const sha512 = (value) =>
  crypto.createHash("sha512").update(value).digest("hex");

// Hash used when initiating a PayU payment.
export const createPayUHash = ({
  txnid,
  amount,
  productinfo,
  firstname,
  email,
  udf1 = "",
  udf2 = "",
  udf3 = "",
  udf4 = "",
  udf5 = "",
}) => {
  const hashString = [
    process.env.PAYU_MERCHANT_KEY,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
    "",
    "",
    "",
    "",
    "",
    process.env.PAYU_MERCHANT_SALT,
  ].join("|");

  return sha512(hashString);
};

// Hash used to verify a PayU response.
// PayU's response hash uses the reverse field order.

export const verifyPayUResponseHash = (params) => {
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
    hash,
  } = params;

  const salt = process.env.PAYU_MERCHANT_SALT;
  const merchantKey = process.env.PAYU_MERCHANT_KEY;

  if (
    !status ||
    !email ||
    !firstname ||
    !productinfo ||
    !amount ||
    !txnid ||
    !key ||
    !hash ||
    !salt ||
    !merchantKey
  ) {
    return false;
  }

  if (key !== merchantKey) return false;

  // PayU responses may use either field name.
  const additionalCharges =
    params.additionalCharges ?? params.additional_charges;

  const hashParts = [
    salt,
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
  ];

  // Additional charges, when present, precede the salt.
  if (
    additionalCharges !== undefined &&
    additionalCharges !== null &&
    additionalCharges !== ""
  ) {
    hashParts.unshift(String(additionalCharges));
  }

  const hashString = hashParts.join("|");

  const calculatedHash = crypto
    .createHash("sha512")
    .update(hashString)
    .digest("hex");

  if (!/^[a-fA-F0-9]{128}$/.test(hash)) {
    return false;
  }

  const expected = Buffer.from(calculatedHash, "hex");
  const received = Buffer.from(hash, "hex");

  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
};
