const express = require("express");
const router = express.Router();

const Product = require("../models/Product");
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");

router.get("/", verifyToken, isAdmin, async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

router.patch("/:id/name", verifyToken, isAdmin, async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { name: req.body.name },
    { new: true }
  );

  res.json(product);
});

router.patch("/:id/price", verifyToken, isAdmin, async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { price: req.body.price },
    { new: true }
  );

  res.json(product);
});

router.patch("/:id/stock", verifyToken, isAdmin, async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { stock: req.body.stock },
    { new: true }
  );

  res.json(product);
});

router.patch("/:id/description", verifyToken, isAdmin, async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { description: req.body.description },
    { new: true }
  );

  res.json(product);
});

router.patch("/:id/discount", verifyToken, isAdmin, async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { discount: req.body.discount },
    { new: true }
  );

  res.json(product);
});

module.exports = router;