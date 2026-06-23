const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { WebSocketServer } = require("ws");
const wsBroadcast = require("./utils/wsBroadcast");
const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");
const ChatRoom = require("./models/ChatRoom");

const PORT = process.env.PORT || 4000;

require("dotenv").config();

const app = express();

app.use(express.json());

app.use(cookieParser());

app.use(cors({
    origin: ["https://nendoshop.onrender.com",   "http://localhost:3000",
        "http://192.168.1.7:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE","PATCH", "OPTIONS"]
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

app.use("/api/admin/logs", require("./routes/logs"));

app.use("/api/payments", require("./routes/payments"));
app.use("/api/chat", require("./routes/chatRoutes"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.roomKey = null;
  socket.username = null;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      await wsBroadcast.handleClientMessage(socket, message);
    } catch (error) {
      console.error("WS message parse error:", error.message || error);
      socket.send(JSON.stringify({ type: "error", message: "Formato de mensaje inválido" }));
    }
  });

  socket.on("close", () => {
    if (socket.roomKey && socket.username) {
      wsBroadcast.broadcastToRoom(socket.roomKey, {
        type: "user-left",
        username: socket.username
      });
    }
  });
});

setInterval(() => {
  wss.clients.forEach((socket) => {
    if (!socket.isAlive) {
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

wsBroadcast.setWss(wss);

server.listen(PORT, async () => {
  console.log("Servidor corriendo en puerto " + PORT);

  const existingRooms = await ChatRoom.find();
  if (!existingRooms.length) {
    await ChatRoom.create([
      { key: "community", name: "Chat de Comunidad", description: "Conecta con otros usuarios" },
      { key: "support", name: "Chat de Soporte", description: "Soporte técnico con IA" }
    ]);
    console.log("Salas de chat creadas");
  }
});