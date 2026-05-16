const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema({

    user: String,
    text: String,
    rating: Number

});

const ProductSchema = new mongoose.Schema({

    name: String,

    price: Number,

    image: String,

    discount: Number,

    stock: Number,

    likes: {
        type: Number,
        default: 0
    },

    dislikes: {
        type: Number,
        default: 0
    },

    description: String,

    specs: {

        marca: String,
        altura: String,
        material: String,
        categoria: String

    },

    comments: [CommentSchema]

}, {
    timestamps: true
});

module.exports = mongoose.model("Product", ProductSchema);