const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/authRoutes");

const PORT = process.env.PORT || 4000;



require("dotenv").config();

const app = express();

app.use(express.json());

app.use(cookieParser());

app.use(cors({
    origin: "http://localhost:3000",
    credentials: true
}));

mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("Mongo conectado");
});

app.use("/api/payments",require("./routes/payments"))
app.use("/api/products", require("./routes/products"));
app.use("/api/configs", require("./routes/configRoutes"));
app.use("/api/users",require("./routes/userRoutes"))
app.use("/api/auth", authRoutes);



app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});