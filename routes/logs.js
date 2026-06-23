const express = require("express");
const router = express.Router();
const Log = require("../models/Log");
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");

router.get("/", verifyToken, isAdmin, async (req, res) => {
    try {
        //  .sort({ createdAt: -1 }) trae los más recientes primero
        const logs = await Log.find().sort({ createdAt: -1 });
        res.json(logs);
    } catch (error) {
        console.error("Error al obtener logs:", error);
        res.status(500).json(error);
    }
});

module.exports = router;