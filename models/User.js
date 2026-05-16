const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({


    name: String,

    lastname: String,

    email: {
        type: String,
        unique: true
    },

    password: String,

    phone: String,

    address: String,

    city: String,

    birthdate: Date,

    sex: String,

    profileImg: String,

    role: {
        type: String,
        default: "user"
    },

    paymentmethod:{
        nombretarjeta: String,
        numerotarjeta: Number,
        cvv: Number,
        tipo: String
    }

}, {
    timestamps: true
});



module.exports = mongoose.model("User", UserSchema);