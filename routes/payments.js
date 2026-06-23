const express = require("express");
const router = express.Router();

const Payment = require("../models/Payment");
const Log = require("../models/Log"); 
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");
const Product = require("../models/Product");
const wsBroadcast = require("../utils/wsBroadcast");

router.post("/", verifyToken, async (req, res) => {
    try {
        
        const payment = new Payment(req.body);
        await payment.save();

        const discountProducts = (payment.productos || []).filter((item) => {
            const quantity = Number(item.quantity || 0);
            return quantity > 0;
        });

        if (discountProducts.length) {
            const selected = discountProducts.sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
            const productDoc = await Product.findOne({ name: selected.name }).catch(() => null);
            const hasDiscount = Boolean(productDoc?.discount && Number(productDoc.discount) > 0);
            if (hasDiscount) {
                const lowestPrice = Number(productDoc?.price || selected.price || 0);
                const discountPrice = Math.max(0, lowestPrice - Number(productDoc.discount));
                wsBroadcast.broadcastPurchaseAlert({
                    id: `${payment._id || Date.now()}-${selected.name}`,
                    customer: payment.cliente || "Un cliente",
                    product: selected.name,
                    productId: productDoc?._id?.toString?.() || null,
                    price: discountPrice,
                    priceLabel: `S/. ${discountPrice}`,
                    message: `Aprovecha esta oferta y lleva ${selected.name} con descuento.`
                });
            }
        }

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