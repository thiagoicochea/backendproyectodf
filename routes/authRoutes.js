const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

router.post("/login", async (req, res) => {

    try {

        const user = await User.findOne({
            email: req.body.email
        });

        if (!user) {

            return res.status(401).json({
                message: "Usuario no encontrado"
            });

        }

        
        const validPassword =
            await bcrypt.compare(
                req.body.password,
                user.password
            );

        if (!validPassword) {

            return res.status(401).json({
                message: "Password incorrecta"
            });

        }

      
        const token = jwt.sign({

            id: user._id,
            role: user.role

        },
        process.env.JWT_SECRET,
        {
            expiresIn: "7d"
        });

       
      res.cookie("token", token, {
  httpOnly: true,
  secure: true,        
  sameSite: "none",    
  maxAge: 7 * 24 * 60 * 60 * 1000
});

        res.json({

            message: "Login correcto",

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