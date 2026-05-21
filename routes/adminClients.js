const express = require("express");
const router = express.Router();

const User = require("../models/User");
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");

router.get("/", verifyToken, isAdmin, async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

router.patch("/:id/email", verifyToken, isAdmin, async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { email: req.body.email },
    { new: true }
  );

  res.json(user);
});

router.patch("/:id/phone", verifyToken, isAdmin, async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { phone: req.body.phone },
    { new: true }
  );

  res.json(user);
});

router.patch("/:id/name", verifyToken, isAdmin, async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { name: req.body.name },
    { new: true }
  );

  res.json(user);
});

router.patch("/:id/city", verifyToken, isAdmin, async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { city: req.body.city },
    { new: true }
  );

  res.json(user);
});

module.exports = router;