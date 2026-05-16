const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema({

    cliente: String,
    direccion: String,
    envio: Number,

    productos: [

        {
            name: String,
            quantity: Number,
            price: Number
        }

    ],

    total: Number,

    estado: {
        type: String,
        default: "Pagado"
    },

    fecha: {
        type: Date,
        default: Date.now
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("Payment", PaymentSchema);