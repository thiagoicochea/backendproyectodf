const mongoose = require("mongoose");

const ConfigItemSchema = new mongoose.Schema({

    key: String,

    value: String,

    tipo: String

}, {
    _id: false
});

const ConfigSchema = new mongoose.Schema({

    apiComentarios: [ConfigItemSchema]

}, {
    timestamps: true
});

module.exports = mongoose.model(
    "Config",
    ConfigSchema
);