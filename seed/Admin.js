const mongoose = require("mongoose");

const User = require("../models/User");

require("dotenv").config();

mongoose.connect(process.env.MONGO_URI)
.then(async () => {

    await User.deleteMany({
        role: "admin"
    });

    await User.create({

        name: "Thiago",
        lastname: "Admin",

        email: "admin@test.com",

        password: "123456",

        phone: "999999999",

        address: "Lima",

        city: "Lima",

        birthdate: "2000-01-01",

        sex: "masculino",

        role: "admin"

    });

    console.log("Admin creado");

    process.exit();

})
.catch((error) => {

    console.log(error);

});