const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");
const ChatRoom = require("../models/ChatRoom");

router.get("/rooms", async (req, res) => {
  try {
    const rooms = await ChatRoom.find().sort({ key: 1 });
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener las salas de chat" });
  }
});

router.get("/rooms/:roomKey/messages", async (req, res) => {
  try {
    const { roomKey } = req.params;
    const limit = Math.min(Number(req.query.limit) || 100, 200);

    const messages = await ChatMessage.find({ roomKey })
      .sort({ createdAt: 1 })
      .limit(limit);

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener los mensajes del chat" });
  }
});

module.exports = router;
