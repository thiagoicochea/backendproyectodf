const mongoose = require("mongoose");
const Product = require("../models/Product");
const products = require("./data");

require("dotenv").config();

mongoose.connect(process.env.MONGO_URI)
.then(async () => {

    await Product.deleteMany();

    await Product.insertMany(products);

    console.log("Productos insertados");

    process.exit();

});