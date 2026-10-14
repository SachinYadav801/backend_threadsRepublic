import mongoose from "mongoose";
import Product from "../models/Product.js";

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

/**
 * Check whether a value is a valid MongoDB ObjectId.
 */
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

/**
 * Normalize a string for comparisons.
 *
 * Example:
 *
 * " Black " -> "black"
 * "BLACK"   -> "black"
 */
const normalizeString = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
};

/**
 * Validate a positive integer.
 */
const isPositiveInteger = (value) => {
  return Number.isInteger(value) && value > 0;
};

/**
 * Validate a non-negative integer.
 */
const isNonNegativeInteger = (value) => {
  return Number.isInteger(value) && value >= 0;
};

/**
 * Validate and normalize variants before creating/updating
 * a product.
 *
 * IMPORTANT:
 *
 * reservedStock is NOT accepted from the client.
 *
 * Inventory reservations are controlled by inventoryService.js.
 */
const validateVariants = (variants) => {
  if (variants === undefined) {
    return {
      valid: true,
      variants: undefined,
    };
  }

  if (!Array.isArray(variants)) {
    return {
      valid: false,
      message: "Variants must be an array",
    };
  }

  const seenVariantIds = new Set();
  const seenSkus = new Set();
  const seenCombinations = new Set();

  const normalizedVariants = variants.map((variant, index) => {
    if (!variant || typeof variant !== "object") {
      throw new Error(
        `Invalid variant at index ${index}`
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Variant ID
    |--------------------------------------------------------------------------
    */

    let variantId = variant._id;

    if (variantId !== undefined && variantId !== null) {
      if (!isValidObjectId(variantId)) {
        throw new Error(
          `Invalid variant ID at index ${index}`
        );
      }

      variantId = variantId.toString();

      if (seenVariantIds.has(variantId)) {
        throw new Error(
          `Duplicate variant ID: ${variantId}`
        );
      }

      seenVariantIds.add(variantId);
    }

    /*
    |--------------------------------------------------------------------------
    | Size
    |--------------------------------------------------------------------------
    */

    const size =
      typeof variant.size === "string"
        ? variant.size.trim()
        : "";

    /*
    |--------------------------------------------------------------------------
    | Color
    |--------------------------------------------------------------------------
    */

    const color =
      variant.color &&
        typeof variant.color === "object"
        ? variant.color
        : {};

    const colorName =
      typeof color.name === "string"
        ? color.name.trim()
        : "";

    const colorHex =
      typeof color.hex === "string"
        ? color.hex.trim()
        : "";

    /*
    |--------------------------------------------------------------------------
    | SKU
    |--------------------------------------------------------------------------
    */

    const sku =
      typeof variant.sku === "string"
        ? variant.sku.trim()
        : "";

    if (!sku) {
      throw new Error(
        `SKU is required for variant at index ${index}`
      );
    }

    const normalizedSku = normalizeString(sku);

    if (seenSkus.has(normalizedSku)) {
      throw new Error(
        `Duplicate SKU: ${sku}`
      );
    }

    seenSkus.add(normalizedSku);

    /*
    |--------------------------------------------------------------------------
    | Size + Color Combination
    |--------------------------------------------------------------------------
    |
    | We don't want:
    |
    | Black / M
    | Black / M
    |
    | appearing twice in the same product.
    |
    */

    const combinationKey = [
      normalizeString(size),
      normalizeString(colorName),
    ].join("|");

    if (seenCombinations.has(combinationKey)) {
      throw new Error(
        `Duplicate variant combination: ${size || "No size"
        } / ${colorName || "No color"}`
      );
    }

    seenCombinations.add(combinationKey);

    /*
    |--------------------------------------------------------------------------
    | Stock
    |--------------------------------------------------------------------------
    */

    const stock =
      variant.stock === undefined
        ? 0
        : Number(variant.stock);

    if (!isNonNegativeInteger(stock)) {
      throw new Error(
        `Stock must be a non-negative integer for SKU ${sku}`
      );
    }

    /*
    |--------------------------------------------------------------------------
    | RESERVED STOCK
    |--------------------------------------------------------------------------
    |
    | NEVER trust reservedStock coming from the frontend/admin.
    |
    | The inventory service is the only thing that should modify it.
    |
    */

    const cleanedVariant = {
      ...(variantId
        ? {
          _id: new mongoose.Types.ObjectId(
            variantId
          ),
        }
        : {}),

      size,

      color: {
        name: colorName,
        hex: colorHex,
      },

      sku,

      stock,

      /*
      * This will be handled separately when updating
      * an existing product.
      *
      * For newly created products there cannot be
      * any reservation.
      */
      reservedStock: 0,
    };

    return cleanedVariant;
  });

  return {
    valid: true,
    variants: normalizedVariants,
  };
};

/**
 * Validate product ID from params.
 */
const validateProductId = (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    res.status(400).json({
      success: false,
      message: "Invalid product ID",
    });

    return false;
  }

  return true;
};

/*
|--------------------------------------------------------------------------
| GET /api/products
|--------------------------------------------------------------------------
|
| Public product listing.
|
*/

export const getProducts = async (req, res) => {
  try {
    const products = await Product.find({
      isActive: true,
    }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error(
      "getProducts error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET /api/products/:slug
|--------------------------------------------------------------------------
|
| Public single-product endpoint.
|
*/

export const getProductBySlug = async (
  req,
  res
) => {
  try {
    
    const product = await Product.findOne({
      slug: req.params.slug,
      isActive: true,

    }).populate({
      path: "relatedProducts",
      match: { isActive: true },
      select: "name slug price compareAtPrice images variants isActive",
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    console.error(
      "getProductBySlug error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
};

/*
|--------------------------------------------------------------------------
| POST /api/products
|--------------------------------------------------------------------------
|
| Create a new product.
|
*/

export const createProduct = async (
  req,
  res
) => {
  try {
    const body = {
      ...req.body,
    };

    /*
    |--------------------------------------------------------------------------
    | Validate variants
    |--------------------------------------------------------------------------
    */

    if (body.variants !== undefined) {
      let variantResult;

      try {
        variantResult = validateVariants(
          body.variants
        );
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      if (!variantResult.valid) {
        return res.status(400).json({
          success: false,
          message: variantResult.message,
        });
      }

      body.variants =
        variantResult.variants;
    }

    /*
    |--------------------------------------------------------------------------
    | Never allow client to control reserved inventory
    |--------------------------------------------------------------------------
    */

    if (Array.isArray(body.variants)) {
      body.variants =
        body.variants.map((variant) => ({
          ...variant,
          reservedStock: 0,
        }));
    }

    /*
    |--------------------------------------------------------------------------
    | Basic product validation
    |--------------------------------------------------------------------------
    */

    if (
      typeof body.name !== "string" ||
      !body.name.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    if (
      typeof body.slug !== "string" ||
      !body.slug.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Product slug is required",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Check duplicate slug
    |--------------------------------------------------------------------------
    */

    const existingProduct =
      await Product.findOne({
        slug: body.slug.trim(),
      });

    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message:
          "A product with this slug already exists",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Create
    |--------------------------------------------------------------------------
    */

    const product =
      await Product.create(body);

    res.status(201).json({
      success: true,
      message:
        "Product created successfully",
      product,
    });
  } catch (error) {
    console.error(
      "createProduct error:",
      error
    );

    /*
    |--------------------------------------------------------------------------
    | Duplicate key
    |--------------------------------------------------------------------------
    */

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A product with this unique value already exists",
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| PUT /api/products/:id
|--------------------------------------------------------------------------
|
| Update an existing product.
|
| IMPORTANT:
|
| We do NOT use:
|
| Product.findByIdAndUpdate(req.params.id, req.body)
|
| because doing that would allow the frontend to blindly
| overwrite inventory state.
|
*/

export const updateProduct = async (
  req,
  res
) => {
  try {
    if (!validateProductId(req, res)) {
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Load current product
    |--------------------------------------------------------------------------
    */

    const product =
      await Product.findById(
        req.params.id
      );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const body = {
      ...req.body,
    };

    /*
    |--------------------------------------------------------------------------
    | Fields that should NEVER be blindly modified
    |--------------------------------------------------------------------------
    */

    delete body._id;
    delete body.createdAt;
    delete body.updatedAt;

    /*
    |--------------------------------------------------------------------------
    | Variants
    |--------------------------------------------------------------------------
    */

    if (body.variants !== undefined) {
      if (!Array.isArray(body.variants)) {
        return res.status(400).json({
          success: false,
          message: "Variants must be an array",
        });
      }

      let variantResult;

      try {
        variantResult =
          validateVariants(
            body.variants
          );
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      if (!variantResult.valid) {
        return res.status(400).json({
          success: false,
          message:
            variantResult.message,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Protect reserved inventory
      |--------------------------------------------------------------------------
      |
      | Existing variants can have reservedStock.
      |
      | Example:
      |
      | Variant A
      | stock = 10
      | reservedStock = 3
      |
      | Admin sends an update:
      |
      | stock = 2
      |
      | That would be invalid because 3 units are already reserved.
      |
      */

      const existingVariants =
        product.variants || [];

      const existingVariantMap =
        new Map();

      for (const existingVariant of existingVariants) {
        existingVariantMap.set(
          existingVariant._id.toString(),
          existingVariant
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Validate each incoming variant
      |--------------------------------------------------------------------------
      */

      for (const incomingVariant of body.variants) {
        if (!incomingVariant._id) {
          /*
          * New variant.
          *
          * New variants cannot have reservations.
          */
          incomingVariant.reservedStock = 0;

          continue;
        }

        const variantId =
          incomingVariant._id.toString();

        const existingVariant =
          existingVariantMap.get(
            variantId
          );

        if (!existingVariant) {
          return res.status(400).json({
            success: false,
            message:
              `Variant ${variantId} does not belong to this product`,
          });
        }

        const reservedStock =
          Number(
            existingVariant.reservedStock || 0
          );

        /*
        |--------------------------------------------------------------------------
        | Never allow admin/frontend to alter reservedStock.
        |--------------------------------------------------------------------------
        */

        incomingVariant.reservedStock =
          reservedStock;

        /*
        |--------------------------------------------------------------------------
        | Stock cannot be lower than reservedStock.
        |--------------------------------------------------------------------------
        */

        const newStock =
          Number(
            incomingVariant.stock
          );

        if (
          !isNonNegativeInteger(
            newStock
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              `Stock must be a non-negative integer for variant ${variantId}`,
          });
        }

        if (
          newStock <
          reservedStock
        ) {
          return res.status(400).json({
            success: false,
            message:
              `Stock cannot be lower than reserved stock for variant ${variantId}. Reserved: ${reservedStock}`,
          });
        }
      }

      /*
      |--------------------------------------------------------------------------
      | Prevent deleting variants with reserved inventory.
      |--------------------------------------------------------------------------
      */

      const incomingVariantIds =
        new Set(
          body.variants
            .filter(
              (variant) =>
                variant._id
            )
            .map(
              (variant) =>
                variant._id.toString()
            )
        );

      for (const existingVariant of existingVariants) {
        const variantId =
          existingVariant._id.toString();

        const reservedStock =
          Number(
            existingVariant.reservedStock || 0
          );

        /*
        * Variant is being removed.
        */
        if (
          !incomingVariantIds.has(
            variantId
          )
        ) {
          if (reservedStock > 0) {
            return res.status(409).json({
              success: false,
              message:
                `Cannot remove variant ${variantId} because ${reservedStock} unit(s) are currently reserved`,
            });
          }
        }
      }

      /*
      |--------------------------------------------------------------------------
      | Preserve reservedStock.
      |--------------------------------------------------------------------------
      */

      body.variants =
        body.variants.map(
          (variant) => {
            if (!variant._id) {
              return {
                ...variant,
                reservedStock: 0,
              };
            }

            const existingVariant =
              existingVariantMap.get(
                variant._id.toString()
              );

            return {
              ...variant,
              reservedStock:
                existingVariant.reservedStock ||
                0,
            };
          }
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Product slug
    |--------------------------------------------------------------------------
    */

    if (body.slug !== undefined) {
      if (
        typeof body.slug !==
        "string" ||
        !body.slug.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Product slug cannot be empty",
        });
      }

      body.slug =
        body.slug.trim();

      /*
      |--------------------------------------------------------------------------
      | Prevent duplicate slug
      |--------------------------------------------------------------------------
      */

      const duplicateSlug =
        await Product.findOne({
          slug: body.slug,
          _id: {
            $ne: product._id,
          },
        });

      if (duplicateSlug) {
        return res.status(409).json({
          success: false,
          message:
            "Another product already uses this slug",
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Product name
    |--------------------------------------------------------------------------
    */

    if (body.name !== undefined) {
      if (
        typeof body.name !==
        "string" ||
        !body.name.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Product name cannot be empty",
        });
      }

      body.name =
        body.name.trim();
    }

    /*
    |--------------------------------------------------------------------------
    | Price validation
    |--------------------------------------------------------------------------
    */

    if (body.price !== undefined) {
      const price =
        Number(body.price);

      if (
        !Number.isFinite(price) ||
        price < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Price must be a non-negative number",
        });
      }

      body.price = price;
    }

    /*
    |--------------------------------------------------------------------------
    | Compare-at price validation
    |--------------------------------------------------------------------------
    */

    if (
      body.compareAtPrice !==
      undefined &&
      body.compareAtPrice !==
      null &&
      body.compareAtPrice !== ""
    ) {
      const compareAtPrice =
        Number(
          body.compareAtPrice
        );

      if (
        !Number.isFinite(
          compareAtPrice
        ) ||
        compareAtPrice < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "compareAtPrice must be a non-negative number",
        });
      }

      body.compareAtPrice =
        compareAtPrice;
    }

    /*
    |--------------------------------------------------------------------------
    | Update fields safely
    |--------------------------------------------------------------------------
    */

    Object.keys(body).forEach(
      (key) => {
        product[key] = body[key];
      }
    );

    /*
    |--------------------------------------------------------------------------
    | Save
    |--------------------------------------------------------------------------
    */

    await product.save();

    res.status(200).json({
      success: true,
      message:
        "Product updated successfully",
      product,
    });
  } catch (error) {
    console.error(
      "updateProduct error:",
      error
    );

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A product with this unique value already exists",
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| DELETE /api/products/:id
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| We don't physically delete a product if it has
| active inventory reservations.
|
*/

export const deleteProduct = async (
  req,
  res
) => {
  try {
    if (!validateProductId(req, res)) {
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Load product
    |--------------------------------------------------------------------------
    */

    const product =
      await Product.findById(
        req.params.id
      );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Check active reservations
    |--------------------------------------------------------------------------
    */

    const reservedVariant =
      (product.variants || []).find(
        (variant) =>
          Number(
            variant.reservedStock || 0
          ) > 0
      );

    if (reservedVariant) {
      return res.status(409).json({
        success: false,
        message:
          "Cannot delete product because one or more variants have reserved inventory",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Soft delete
    |--------------------------------------------------------------------------
    |
    | Instead of physically removing the document,
    | mark it inactive.
    |
    | This is much safer because existing orders still
    | reference this Product document.
    |
    */

    product.isActive = false;

    await product.save();

    res.status(200).json({
      success: true,
      message:
        "Product deactivated successfully",
    });
  } catch (error) {
    console.error(
      "deleteProduct error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Failed to delete product",
    });
  }
};