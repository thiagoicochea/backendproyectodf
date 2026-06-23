const express = require("express");
const router = express.Router();

const Payment = require("../models/Payment");
const Log = require("../models/Log"); 
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");

router.post("/", verifyToken, async (req, res) => {
    try {
        
        const payment = new Payment(req.body);
        await payment.save();

        // Capturar datos de seguridad para el Log
        // Si están en producción (Render), req.headers['x-forwarded-for'] trae la IP real
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "IP Desconocida";
        const userAgent = req.headers['user-agent'] || "Dispositivo Desconocido";

        // 4. Crear el registro de Auditoría
        const nuevoLog = new Log({
            ip: clientIp,
            usuario: payment.cliente || "Anónimo", // Toma el nombre del JSON que envía tu Wizard
            descripcion: `Compra registrada - Doc: ${payment.documento || 'N/A'} | Total: S/. ${payment.total}`,
            tipo: "TRANSACCION",
            metodo: req.method,         // Guardará "POST"
            ruta: req.originalUrl,      // Guardará "/api/admin/payments"
            userAgent: userAgent
        });
        
        await nuevoLog.save();

        // 5. Responder al frontend
        res.json({
            message: "Pago registrado y auditoría guardada exitosamente"
        });

    } catch (error) {
        console.error("Error en el pago:", error);
        
        // Registrar también si ocurre un error
        try {
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "IP Desconocida";
            await new Log({
                ip: clientIp,
                usuario: "Sistema",
                descripcion: `Fallo al procesar pago: ${error.message}`,
                tipo: "ERROR",
                metodo: req.method,
                ruta: req.originalUrl,
                userAgent: req.headers['user-agent']
            }).save();
        } catch (logError) {
            console.error("Error crítico: No se pudo guardar el log de error", logError);
        }

        res.status(500).json(error);
    }
});

router.get("/", verifyToken, isAdmin, async (req, res) => {
    const payments = await Payment.find();
    res.json(payments);
});

module.exports = router;