const mongoose = require("mongoose");

const LogSchema = new mongoose.Schema({
    ip: { 
        type: String, 
        required: true 
    },
    usuario: { 
        type: String, 
        default: "Anónimo" 
    },
    descripcion: { 
        type: String, 
        required: true 
    },
    tipo: { 
        type: String, 
        enum: ["TRANSACCION", "ERROR", "SISTEMA", "AUTH"], 
        required: true 
    },
    // ---- Nuevos campos de nivel Auditoría de Seguridad ----
    metodo: {
        type: String,
        required: true
    },
    ruta: {
        type: String,
        required: true
    },
    userAgent: {
        type: String
    }
}, {
    timestamps: true 
});

module.exports = mongoose.model("Log", LogSchema);