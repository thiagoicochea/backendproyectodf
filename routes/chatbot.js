// routes/chatbot.js
//
// Endpoint mínimo para conectar el frontend con NendoBot.
// Las sesiones viven en memoria por sessionId mientras corre el proceso.
// Si despliegas con varias instancias/réplicas, cambia este Map por Redis
// (u otro store compartido) para que la conversación no se "reinicie" si
// el balanceador te manda a otra instancia.

const express = require("express");
const router = express.Router();

const { createSupportSession, getSupportBotReply, normalizeCustomerName } = require("../utils/supportBot");

const sessions = new Map();

router.post("/message", async (req, res) => {
  try {
    const { sessionId, message, customerName } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "Falta sessionId" });
    }

    let session = sessions.get(sessionId);
    if (!session) {
      session = createSupportSession(normalizeCustomerName(customerName));
      sessions.set(sessionId, session);
    }

    const reply = await getSupportBotReply(message, session);

    res.json({ reply, step: session.step });
  } catch (error) {
    console.error("Error en chatbot:", error);
    res.status(500).json({ message: "Error interno del asistente" });
  }
});

// Útil para que el frontend pueda "reiniciar" la conversación manualmente
// (por ejemplo con un botón "nueva conversación").
router.post("/reset", (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) sessions.delete(sessionId);
  res.json({ ok: true });
});

module.exports = router;
