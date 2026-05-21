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
    origin: ["https://nendoshop.onrender.com",   "http://localhost:3000",
        "http://192.168.1.7:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"]
}));
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("Mongo conectado");
});

app.use("/api/admin/payments",require("./routes/payments"))
app.use("/api/admin/clients", require("./routes/adminClients"));
app.use("/api/admin/products", require("./routes/adminProducts"));
app.use("/api/products", require("./routes/products"));
app.use("/api/configs", require("./routes/configRoutes"));
app.use("/api/users",require("./routes/userRoutes"))
app.use("/api/auth", authRoutes);



app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});