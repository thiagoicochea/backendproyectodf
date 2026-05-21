const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const User = require("../models/User");
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");

router.get("/", verifyToken, isAdmin, async (req, res) => {
 const users = await User.find();
  res.json(users);
});

router.patch("/:id/email", verifyToken, isAdmin, async (req, res) => {
  try {
    const email = req.body.email;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Email inválido" });
    }

    const exists = await User.findOne({
      email,
      _id: { $ne: req.params.id }
    });

    if (exists) {
      return res.status(409).json({ message: "Email ya registrado" });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { email },
      { new: true }
    );

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error servidor" });
  }
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

router.patch("/:id/password", verifyToken, isAdmin, async (req, res) => {

  const hashed = await bcrypt.hash(req.body.password, 10);

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { password: hashed },
    { new: true }
  );

  res.json({ message: "Password updated" });
});

module.exports = router;