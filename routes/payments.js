const express = require("express");
const router = express.Router();

const Payment = require("../models/Payment");
const verifyToken = require("../middlewares/verifyToken");
const isAdmin =
    require("../middlewares/isAdmin");



router.post("/",verifyToken, async (req, res) => {

    try {

        const payment = new Payment(req.body);

        await payment.save();

        res.json({
            message: "Pago registrado"
        });

    } catch (error) {

        res.status(500).json(error);

    }

});

router.get("/", verifyToken, isAdmin, async (req, res) => {

    const payments = await Payment.find();

    res.json(payments);

});

module.exports = router;