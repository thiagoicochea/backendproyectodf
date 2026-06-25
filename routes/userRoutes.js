const express = require("express");

const router = express.Router();

const User = require("../models/User");
const { validateProfilePayload } = require("../utils/validation");
const { recordLog } = require("../utils/logger");

const verifyToken =
    require("../middlewares/verifyToken");



router.get(
    "/profile",
    verifyToken,
    async (req, res) => {

        try {

            const user =
                await User.findById(req.user.id)
                    .select("-password");

            if (!user) {

                return res.status(404).json({
                    message: "Usuario no encontrado"
                });

            }

            await recordLog({
                req,
                usuario: user.email,
                descripcion: "Perfil consultado",
                tipo: "TRANSACCION",
                metodo: req.method,
                ruta: req.originalUrl
            });

            res.json(user);

        } catch (error) {

            res.status(500).json(error);

        }

    }
);

router.put(
    "/profile",
    verifyToken,
    async (req, res) => {

        try {
            await recordLog({
                req,
                usuario: req.user?.email || req.user?.id || "Anónimo",
                descripcion: "Solicitud de actualización de perfil",
                tipo: "TRANSACCION",
                metodo: req.method,
                ruta: req.originalUrl
            });

            const { isValid, errors } = validateProfilePayload(req.body);

            if (!isValid) {
                return res.status(400).json({
                    message: errors.join(". ")
                });
            }

            const user =
                await User.findById(req.user.id);

            if (!user) {

                return res.status(404).json({
                    message: "Usuario no encontrado"
                });

            }

            if (req.body.email && req.body.email !== user.email) {
                const existingUser = await User.findOne({ email: req.body.email.toLowerCase().trim() });
                if (existingUser) {
                    return res.status(409).json({ message: "El correo ya está registrado por otro usuario." });
                }
            }

            if (req.body.email !== undefined) {
                user.email = req.body.email;
            }

            if (req.body.name !== undefined) {
                user.name = req.body.name;
            }

            if (req.body.lastname !== undefined) {
                user.lastname = req.body.lastname;
            }

            if (req.body.phone !== undefined) {
                user.phone = req.body.phone;
            }

            if (req.body.address !== undefined) {
                user.address = req.body.address;
            }

            if (req.body.city !== undefined) {
                user.city = req.body.city;
            }

            if (req.body.birthdate !== undefined) {
                user.birthdate = req.body.birthdate;
            }

            if (req.body.sex !== undefined) {
                user.sex = req.body.sex;
            }

            if (req.body.profileImg !== undefined) {
                user.profileImg = req.body.profileImg;
            }

            if (req.body.paymentmethod !== undefined) {
                user.paymentmethod = {
                    nombretarjeta: req.body.paymentmethod?.nombretarjeta,
                    numerotarjeta: req.body.paymentmethod?.numerotarjeta,
                    cvv: req.body.paymentmethod?.cvv,
                    tipo: req.body.paymentmethod?.tipo
                };
            }

            await user.save();

            await recordLog({
                req,
                usuario: user.email,
                descripcion: "Perfil actualizado correctamente",
                tipo: "TRANSACCION",
                metodo: req.method,
                ruta: req.originalUrl
            });

            res.json({
                message: "Perfil actualizado",
                user
            });

        } catch (error) {

            res.status(500).json(error);

        }

    }
);

module.exports = router;