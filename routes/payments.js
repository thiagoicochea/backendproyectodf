const express = require("express");
const router = express.Router();

const Payment = require("../models/Payment");
const Log = require("../models/Log"); 
const verifyToken = require("../middlewares/verifyToken");
const isAdmin = require("../middlewares/isAdmin");
const Product = require("../models/Product");
const User = require("../models/User");
const wsBroadcast = require("../utils/wsBroadcast");

router.post("/", verifyToken, async (req, res) => {
    try {
        const { saveCard, paymentmethod, ...paymentBody } = req.body;
        const payment = new Payment(paymentBody);
        await payment.save();

        if (saveCard && paymentmethod && req.user?.id) {
            const user = await User.findById(req.user.id);
            if (user) {
                user.paymentmethod = {
                    nombretarjeta: paymentmethod.nombretarjeta || user.paymentmethod?.nombretarjeta || "",
                    numerotarjeta: paymentmethod.numerotarjeta || user.paymentmethod?.numerotarjeta || "",
                    cvv: paymentmethod.cvv || user.paymentmethod?.cvv || "",
                    tipo: paymentmethod.tipo || user.paymentmethod?.tipo || "visa"
                };
                await user.save();
            }
        }

        const discountProducts = (payment.productos || []).filter((item) => {
            const quantity = Number(item.quantity || 0);
            return quantity > 0;
        });

        if (discountProducts.length) {
            const discountedCandidates = [];
            for (const item of discountProducts) {
                const itemName = String(item?.name || "").trim();
                let productDoc = null;

                if (itemName) {
                    const escapedName = itemName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    productDoc = await Product.findOne({
                        $or: [
                            { name: itemName },
                            { name: { $regex: new RegExp(`^${escapedName}$`, "i") } },
                            { name: { $regex: new RegExp(escapedName, "i") } }
                        ]
                    }).catch(() => null);
                }

                const discountValue = Number(productDoc?.discount ?? item?.discount ?? 0);
                if (!discountValue || discountValue <= 0) continue;

                const basePrice = Number(productDoc?.price ?? item?.price ?? 0);
                const discountPrice = discountValue > 1
                    ? Math.max(0, basePrice - discountValue)
                    : Math.max(0, basePrice * (1 - discountValue));

                discountedCandidates.push({
                    name: itemName || productDoc?.name || "Producto con descuento",
                    price: discountPrice,
                    originalPrice: basePrice,
                    discountPercent: discountValue > 1 ? null : discountValue * 100,
                    discountAmount: discountValue > 1 ? discountValue : null,
                    productId: productDoc?._id?.toString?.() || item?.productId || null,
                    productDoc
                });
            }

            if (discountedCandidates.length) {
                discountedCandidates.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
                const selected = discountedCandidates[0];
                wsBroadcast.broadcastPurchaseAlert({
                    id: `${payment._id || Date.now()}-${selected.name}`,
                    customer: payment.cliente || "Un cliente",
                    product: selected.name,
                    productId: selected.productId,
                    price: selected.price,
                    originalPrice: selected.originalPrice,
                    discountPercent: selected.discountPercent,
                    discountAmount: selected.discountAmount,
                    priceLabel: `S/. ${selected.price}`,
                    message: `Aprovecha esta oferta y lleva ${selected.name} con descuento.`
                });
            }
        }
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "IP Desconocida";
        const userAgent = req.headers['user-agent'] || "Dispositivo Desconocido";
        const nuevoLog = new Log({
            ip: clientIp,
            usuario: payment.cliente || "Anónimo", 
            descripcion: `Compra registrada - Doc: ${payment.documento || 'N/A'} | Total: S/. ${payment.total}`,
            tipo: "TRANSACCION",
            metodo: req.method,        
            ruta: req.originalUrl,      
            userAgent: userAgent
        });
        
        await nuevoLog.save();
        res.json({
            message: "Pago registrado y auditoría guardada exitosamente"
        });

    } catch (error) {
        console.error("Error en el pago:", error);
        
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