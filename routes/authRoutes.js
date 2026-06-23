const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const https = require("https");
const crypto = require("crypto");

const User = require("../models/User");

const OTP_EXPIRE_MS = 5 * 60 * 1000;
const RESEND_WAIT_MS = 30 * 1000;
const BLOCK_DURATION_MS = 2 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 3;

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));
const generateTempToken = () => crypto.randomBytes(24).toString("hex");

const sendTwoFactorCode = (user, method, code) => {
  const sendMethod = method || "email";

  if (sendMethod === "email") {
    console.log(`[2FA] Enviando código por correo a ${user.email}: ${code}`);
    return Promise.resolve({ sentBy: "email" });
  }

  if (!user.phone) {
    console.log(`[2FA] Sin teléfono para ${sendMethod}; enviando por correo: ${code}`);
    return Promise.resolve({ sentBy: "email" });
  }

  const macroMethod =
    sendMethod === "whatsapp"
      ? "wtsp"
      : sendMethod === "call"
      ? "call"
      : sendMethod === "sms"
      ? "sms"
      : "email";

  const nombre = encodeURIComponent(user.name || user.email);
  const numero = encodeURIComponent(String(user.phone));
  const url = `https://trigger.macrodroid.com/543902b9-9627-4797-833f-8ab08ee4a3ec/otp?nombre=${nombre}&numero=${numero}&metodo=${macroMethod}&codigo=${code}`;

  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        console.log(`[2FA] trigger ${macroMethod} status ${res.statusCode}`);
        res.on("data", () => {});
        res.on("end", () => resolve({ sentBy: sendMethod }));
      })
      .on("error", (err) => {
        console.error("[2FA] Error al llamar trigger", err);
        resolve({ sentBy: sendMethod, error: true });
      });
  });
};

const isBlocked = (user) => {
  return user.twoFactorBlockedUntil && user.twoFactorBlockedUntil > new Date();
};

router.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      return res.status(401).json({ message: "Usuario no encontrado" });
    }

    const validPassword = await bcrypt.compare(req.body.password, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: "Password incorrecta" });
    }

    if (isBlocked(user)) {
      return res.status(403).json({
        message: "La cuenta está bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo en unos minutos."
      });
    }

    const code = generateCode();
    const tempToken = generateTempToken();
    const now = new Date();

    await sendTwoFactorCode(user, "email", code);

    user.twoFactorCode = code;
    user.twoFactorMethod = "email";
    user.twoFactorTempToken = tempToken;
    user.twoFactorExpires = new Date(now.getTime() + OTP_EXPIRE_MS);
    user.twoFactorLastSentAt = now;
    user.twoFactorAttempts = 0;
    user.twoFactorBlockedUntil = null;

    await user.save();

    return res.json({
      twoFactorRequired: true,
      tempToken,
      method: "email",
      message: "Se ha enviado el código por correo"
    });
  } catch (error) {
    res.status(500).json(error);
  }
});

router.post("/resend-2fa", async (req, res) => {
  try {
    const { email, tempToken, method } = req.body;

    if (!email || !tempToken) {
      return res.status(400).json({ message: "Email y token temporario son requeridos" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (user.twoFactorTempToken !== tempToken) {
      return res.status(401).json({ message: "Token de verificación inválido" });
    }

    if (isBlocked(user)) {
      return res.status(403).json({
        message: "La cuenta está bloqueada temporalmente por muchos intentos fallidos. Intenta de nuevo en unos minutos."
      });
    }

    const now = new Date();
    if (user.twoFactorLastSentAt && now - user.twoFactorLastSentAt < RESEND_WAIT_MS) {
      const waitSeconds = Math.ceil((RESEND_WAIT_MS - (now - user.twoFactorLastSentAt)) / 1000);
      return res.status(429).json({
        message: `Espera ${waitSeconds} segundos antes de reenviar el código.`
      });
    }

    const newCode = generateCode();
    const sendMethod = method || "email";

    await sendTwoFactorCode(user, sendMethod, newCode);

    user.twoFactorCode = newCode;
    user.twoFactorMethod = sendMethod;
    user.twoFactorExpires = new Date(now.getTime() + OTP_EXPIRE_MS);
    user.twoFactorLastSentAt = now;
    user.twoFactorAttempts = 0;

    await user.save();

    return res.json({
      message: "Código reenviado",
      method: sendMethod,
      waitSeconds: 30
    });
  } catch (error) {
    res.status(500).json(error);
  }
});

router.post("/verify-2fa", async (req, res) => {
  try {
    const { email, tempToken, code } = req.body;

    if (!email || !tempToken || !code) {
      return res.status(400).json({ message: "Email, token y código son requeridos" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (user.twoFactorTempToken !== tempToken) {
      return res.status(401).json({ message: "Token de verificación inválido" });
    }

    if (isBlocked(user)) {
      return res.status(403).json({
        message: "La cuenta está bloqueada temporalmente por demasiados intentos fallidos. Intenta de nuevo en unos minutos."
      });
    }

    const now = new Date();
    if (!user.twoFactorCode || !user.twoFactorExpires || user.twoFactorExpires < now || user.twoFactorCode !== code) {
      user.twoFactorAttempts = (user.twoFactorAttempts || 0) + 1;
      if (user.twoFactorAttempts >= MAX_VERIFY_ATTEMPTS) {
        user.twoFactorBlockedUntil = new Date(now.getTime() + BLOCK_DURATION_MS);
        user.twoFactorAttempts = 0;
        await user.save();
        return res.status(403).json({ message: "Demasiados intentos fallidos. Vuelve a intentar en 2 minutos." });
      }
      await user.save();
      return res.status(401).json({ message: "Código incorrecto o expirado" });
    }

    user.twoFactorCode = null;
    user.twoFactorExpires = null;
    user.twoFactorTempToken = null;
    user.twoFactorAttempts = 0;
    user.twoFactorBlockedUntil = null;
    user.twoFactorLastSentAt = null;
    user.twoFactorMethod = null;

    await user.save();

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      message: "Verificación correcta",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        profileImg: user.profileImg
      }
    });
  } catch (error) {
    res.status(500).json(error);
  }
});

router.post("/register", async (req, res) => {

    try {

        const exists = await User.findOne({
            email: req.body.email
        });

        if (exists) {
            return res.status(400).json({
                message: "El email ya existe"
            });
        }


       const hashedPassword =
            await bcrypt.hash(req.body.password, 10);

        const user = new User({

            ...req.body,

            password: hashedPassword

        });

        await user.save();

        res.json({
            message: "Usuario registrado"
        });

    } catch (error) {

        res.status(500).json(error);

    }

});

module.exports = router;
