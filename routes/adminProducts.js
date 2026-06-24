const express = require("express");
const router = express.Router();

const Product = require("../models/Product");
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");
const { validateAdminProductField } = require("../utils/validation");

router.get("/", verifyToken, isAdmin, async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

router.patch("/:id/name", verifyToken, isAdmin, async (req, res) => {
  const validationError = validateAdminProductField("name", req.body.name);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { name: req.body.name },
    { new: true }
  );

  res.json(product);
});

router.patch("/:id/price", verifyToken, isAdmin, async (req, res) => {
  const validationError = validateAdminProductField("price", req.body.price);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { price: req.body.price },
    { new: true }
  );

  res.json(product);
});

router.patch("/:id/stock", verifyToken, isAdmin, async (req, res) => {
  const validationError = validateAdminProductField("stock", req.body.stock);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { stock: req.body.stock },
    { new: true }
  );

  res.json(product);
});

router.patch("/:id/description", verifyToken, isAdmin, async (req, res) => {
  const validationError = validateAdminProductField("description", req.body.description);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { description: req.body.description },
    { new: true }
  );

  res.json(product);
});

router.patch("/:id/discount", verifyToken, isAdmin, async (req, res) => {
  const validationError = validateAdminProductField("discount", req.body.discount);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { discount: req.body.discount },
    { new: true }
  );

  res.json(product);
});




module.exports = router;