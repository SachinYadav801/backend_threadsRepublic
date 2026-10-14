import mongoose from "mongoose";
import Product from "../models/Product.js";

const getObjectId = (id, fieldName = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`Invalid ${fieldName}`);
  }

  return new mongoose.Types.ObjectId(id);
};

/*
|--------------------------------------------------------------------------
| RESERVE STOCK
|--------------------------------------------------------------------------
*/

export const reserveProductStock = async ({
  productId,
  variantId,
  quantity,
  session = null,
}) => {
  const productObjectId = getObjectId(productId, "product ID");
  const variantObjectId = getObjectId(variantId, "variant ID");

  const requestedQuantity = Number(quantity);

  if (
    !Number.isInteger(requestedQuantity) ||
    requestedQuantity <= 0
  ) {
    throw new Error("Invalid quantity");
  }

  const filter = {
    _id: productObjectId,
    isActive: true,

    $expr: {
      $gt: [
        {
          $size: {
            $filter: {
              input: "$variants",
              as: "variant",
              cond: {
                $and: [
                  {
                    $eq: [
                      "$$variant._id",
                      variantObjectId,
                    ],
                  },
                  {
                    $gte: [
                      {
                        $subtract: [
                          "$$variant.stock",
                          "$$variant.reservedStock",
                        ],
                      },
                      requestedQuantity,
                    ],
                  },
                ],
              },
            },
          },
        },
        0,
      ],
    },
  };

  const options = {
    new: true,
    updatePipeline: true,
  };

  if (session) {
    options.session = session;
  }

  const updatedProduct =
    await Product.findOneAndUpdate(
      filter,
      [
        {
          $set: {
            variants: {
              $map: {
                input: "$variants",
                as: "variant",
                in: {
                  $cond: [
                    {
                      $eq: [
                        "$$variant._id",
                        variantObjectId,
                      ],
                    },
                    {
                      $mergeObjects: [
                        "$$variant",
                        {
                          reservedStock: {
                            $add: [
                              "$$variant.reservedStock",
                              requestedQuantity,
                            ],
                          },
                        },
                      ],
                    },
                    "$$variant",
                  ],
                },
              },
            },
          },
        },
      ],
      options
    );

  if (!updatedProduct) {
    const productQuery = Product.findById(productObjectId);

    if (session) {
      productQuery.session(session);
    }

    const product = await productQuery;

    if (!product) {
      throw new Error("Product not found");
    }

    if (!product.isActive) {
      throw new Error("Product is not available");
    }

    const variant = product.variants?.find(
      (item) =>
        item._id.toString() ===
        variantObjectId.toString()
    );

    if (!variant) {
      throw new Error(
        `Selected variant unavailable for ${product.name}`
      );
    }

    const availableStock =
      variant.stock - variant.reservedStock;

    if (availableStock < requestedQuantity) {
      throw new Error(
        `Not enough stock for ${product.name}`
      );
    }

    throw new Error(
      `Unable to reserve stock for ${product.name}`
    );
  }

  return updatedProduct;
};

/*
|--------------------------------------------------------------------------
| COMMIT STOCK
|--------------------------------------------------------------------------
*/

export const commitProductStock = async ({
  productId,
  variantId,
  quantity,
  session = null,
}) => {
  const productObjectId = getObjectId(productId, "product ID");
  const variantObjectId = getObjectId(variantId, "variant ID");

  const requestedQuantity = Number(quantity);

  if (
    !Number.isInteger(requestedQuantity) ||
    requestedQuantity <= 0
  ) {
    throw new Error("Invalid quantity");
  }

  const filter = {
    _id: productObjectId,

    $expr: {
      $gt: [
        {
          $size: {
            $filter: {
              input: "$variants",
              as: "variant",
              cond: {
                $and: [
                  {
                    $eq: [
                      "$$variant._id",
                      variantObjectId,
                    ],
                  },
                  {
                    $gte: [
                      "$$variant.reservedStock",
                      requestedQuantity,
                    ],
                  },
                ],
              },
            },
          },
        },
        0,
      ],
    },
  };

  const options = {
    new: true,
    updatePipeline: true,
  };

  if (session) {
    options.session = session;
  }

  const updatedProduct =
    await Product.findOneAndUpdate(
      filter,
      [
        {
          $set: {
            variants: {
              $map: {
                input: "$variants",
                as: "variant",
                in: {
                  $cond: [
                    {
                      $eq: [
                        "$$variant._id",
                        variantObjectId,
                      ],
                    },
                    {
                      $mergeObjects: [
                        "$$variant",
                        {
                          reservedStock: {
                            $subtract: [
                              "$$variant.reservedStock",
                              requestedQuantity,
                            ],
                          },

                          stock: {
                            $subtract: [
                              "$$variant.stock",
                              requestedQuantity,
                            ],
                          },
                        },
                      ],
                    },
                    "$$variant",
                  ],
                },
              },
            },
          },
        },
      ],
      options
    );

  if (!updatedProduct) {
    const productQuery = Product.findById(productObjectId);

    if (session) {
      productQuery.session(session);
    }

    const product = await productQuery;

    if (!product) {
      throw new Error("Product not found");
    }

    const variant = product.variants?.find(
      (item) =>
        item._id.toString() ===
        variantObjectId.toString()
    );

    if (!variant) {
      throw new Error(
        `Variant not found for ${product.name}`
      );
    }

    if (variant.reservedStock < requestedQuantity) {
      throw new Error(
        `Reserved stock is lower than requested quantity for ${product.name}`
      );
    }

    throw new Error(
      `Unable to commit stock for ${product.name}`
    );
  }

  return updatedProduct;
};

/*
|--------------------------------------------------------------------------
| RELEASE STOCK
|--------------------------------------------------------------------------
*/

export const releaseProductStock = async ({
  productId,
  variantId,
  quantity,
  session = null,
}) => {
  const productObjectId = getObjectId(productId, "product ID");
  const variantObjectId = getObjectId(variantId, "variant ID");

  const requestedQuantity = Number(quantity);

  if (
    !Number.isInteger(requestedQuantity) ||
    requestedQuantity <= 0
  ) {
    throw new Error("Invalid quantity");
  }

  const filter = {
    _id: productObjectId,

    $expr: {
      $gt: [
        {
          $size: {
            $filter: {
              input: "$variants",
              as: "variant",
              cond: {
                $and: [
                  {
                    $eq: [
                      "$$variant._id",
                      variantObjectId,
                    ],
                  },
                  {
                    $gte: [
                      "$$variant.reservedStock",
                      requestedQuantity,
                    ],
                  },
                ],
              },
            },
          },
        },
        0,
      ],
    },
  };

  const options = {
    new: true,
    updatePipeline: true,
  };

  if (session) {
    options.session = session;
  }

  const updatedProduct =
    await Product.findOneAndUpdate(
      filter,
      [
        {
          $set: {
            variants: {
              $map: {
                input: "$variants",
                as: "variant",
                in: {
                  $cond: [
                    {
                      $eq: [
                        "$$variant._id",
                        variantObjectId,
                      ],
                    },
                    {
                      $mergeObjects: [
                        "$$variant",
                        {
                          reservedStock: {
                            $subtract: [
                              "$$variant.reservedStock",
                              requestedQuantity,
                            ],
                          },
                        },
                      ],
                    },
                    "$$variant",
                  ],
                },
              },
            },
          },
        },
      ],
      options
    );
  
  // It's the If & else
  if (!updatedProduct) {
    const productQuery = Product.findById(productObjectId);

    if (session) {
      productQuery.session(session);
    }

    const product = await productQuery;

    if (!product) {
      throw new Error("Product not found");
    }

    const variant = product.variants?.find(
      (item) =>
        item._id.toString() ===
        variantObjectId.toString()
    );

    if (!variant) {
      throw new Error(
        `Variant not found for ${product.name}`
      );
    }

    if (variant.reservedStock < requestedQuantity) {
      throw new Error(
        `Cannot release more stock than reserved for ${product.name}`
      );
    }

    throw new Error(
      `Unable to release stock for ${product.name}`
    );
  }

  return updatedProduct;
};