const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const User = require("../models/User");
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");
const { recordLog } = require("../utils/logger");

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

    await recordLog({ req, usuario: req.user?.email || "admin", descripcion: `Administrador actualizó el email de ${user?.email || req.params.id}`, tipo: "SISTEMA", metodo: req.method, ruta: req.originalUrl });

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

  await recordLog({ req, usuario: req.user?.email || "admin", descripcion: `Administrador restableció la contraseña de ${user?.email || req.params.id}`, tipo: "SISTEMA", metodo: req.method, ruta: req.originalUrl });

  res.json({ message: "Password updated" });
});

router.patch("/:id/block", verifyToken, isAdmin, async (req, res) => {
  try {
    const { blocked, reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    user.chatBlockedUntil = blocked ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) : null;
    user.chatBlockReason = blocked ? reason || "Reporte acumulado" : "";
    user.chatReportCount = blocked ? Math.max(user.chatReportCount || 0, 10) : Math.max(0, (user.chatReportCount || 0) - 1);
    await user.save();

    await recordLog({ req, usuario: req.user?.email || "admin", descripcion: blocked ? `Bloqueó al usuario ${user.email}` : `Desbloqueó al usuario ${user.email}`, tipo: "SISTEMA", metodo: req.method, ruta: req.originalUrl });

    res.json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al actualizar el estado del usuario" });
  }
});

module.exports = router;