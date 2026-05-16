const express = require("express");
const router = express.Router();

const Product = require("../models/Product");
const verifyToken = require("../middlewares/verifyToken");

router.get("/",verifyToken, async (req, res) => {

    const products = await Product.find();

    res.json(products);

});

router.get("/:id",verifyToken, async (req, res) => {

    const product = await Product.findById(req.params.id);

    res.json(product);

});

router.post("/:id/comments", verifyToken, async (req, res) => {
  try {
    const { text, rating, user } = req.body;

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const newComment = {
      user,
      text,
      rating
    };

    product.comments.unshift(newComment);

    await product.save();

    res.json({
      message: "Comentario agregado",
      comments: product.comments
    });

  } catch (error) {
    res.status(500).json(error);
  }
});

module.exports = router;