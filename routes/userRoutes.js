const express = require("express");

const router = express.Router();

const User = require("../models/User");
const { validateProfilePayload } = require("../utils/validation");

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

            user.email =
                req.body.email || user.email;

            user.name =
                req.body.name || user.name;

            user.lastname =
                req.body.lastname || user.lastname;

            user.phone =
                req.body.phone || user.phone;

            user.address =
                req.body.address || user.address;

            user.city =
                req.body.city || user.city;

            user.birthdate =
                req.body.birthdate || user.birthdate;

            user.sex =
                req.body.sex || user.sex;

            user.profileImg =
                req.body.profileImg || user.profileImg;

            if (req.body.paymentmethod) {

                user.paymentmethod = {
                
                    nombretarjeta:
                         req.body.paymentmethod.nombretarjeta,
                    numerotarjeta:
                        req.body.paymentmethod.numerotarjeta,

                    cvv:
                        req.body.paymentmethod.cvv,

                    tipo:
                        req.body.paymentmethod.tipo

                };

            }

            await user.save();

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