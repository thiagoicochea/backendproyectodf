const https = require("https");
const ChatMessage = require("../models/ChatMessage");
const ChatRoom = require("../models/ChatRoom");

let wss;

const setWss = (server) => {
  wss = server;
};

const extractGroqKey = (value) => {
  if (!value) return null;
  let candidate = value.trim();
  const match = candidate.match(/(gsk_[A-Za-z0-9_-]+)/);
  return match ? match[1] : candidate;
};

const getGroqKey = () => {
  return process.env.GROQ_API_KEY || null;
};

const sendGroqSupportAnswer = (comment) => {
  return new Promise((resolve, reject) => {
    const apiKey = getGroqKey();
    if (!apiKey) {
      return resolve({ text: "Lo siento, el servicio de soporte no está disponible en este momento." });
    }

    const payload = JSON.stringify({
      model: "llama",
      input: `Eres un asistente de soporte. Responde de forma clara y breve a la siguiente consulta de un usuario:\n\n${comment}\n\nResponde en español.`,
      temperature: 0,
      max_output_tokens: 300
    });

    const request = https.request(
      {
        hostname: "api.groq.com",
        path: "/openai/v1/responses",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error("Groq support error", res.statusCode, data);
            return resolve({ text: "Lo siento, no puedo responder en este momento." });
          }
          try {
            const parsed = JSON.parse(data);
            let text = "";
            if (parsed.output_text) text = parsed.output_text;
            if (!text && Array.isArray(parsed.output)) {
              text = parsed.output.map((item) => {
                if (item?.content) return item.content.map((c) => c.text || "").join("");
                if (item?.text) return item.text;
                return "";
              }).join(" ");
            }
            resolve({ text: text.trim() || "Lo siento, no tengo una respuesta en este momento." });
          } catch (err) {
            console.error("Groq support parse error", err.message, data);
            resolve({ text: "Lo siento, no puedo responder en este momento." });
          }
        });
      }
    );

    request.on("error", (err) => {
      console.error("Groq support request error", err.message);
      resolve({ text: "Lo siento, no puedo responder en este momento." });
    });

    request.write(payload);
    request.end();
  });
};

const broadcastToRoom = (roomKey, payload) => {
  if (!wss) return;
  const message = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.roomKey === roomKey) {
      client.send(message);
    }
  });
};

const handleClientMessage = async (socket, message) => {
  const { type, roomKey, text, username } = message;
  if (type === "join") {
    socket.roomKey = roomKey;
    socket.username = username || "Invitado";
    socket.send(JSON.stringify({ type: "joined", roomKey }));
    broadcastToRoom(roomKey, { type: "user-joined", roomKey, username: socket.username });
    return;
  }

  if (type === "typing") {
    broadcastToRoom(roomKey, { type: "typing", roomKey, username: socket.username });
    return;
  }

  if (type === "message") {
    if (!roomKey || !text || !socket.username) {
      return socket.send(JSON.stringify({ type: "error", message: "Datos de mensaje incompletos" }));
    }

    const room = await ChatRoom.findOne({ key: roomKey });
    if (!room) {
      return socket.send(JSON.stringify({ type: "error", message: "Sala de chat inválida" }));
    }

    const userMessage = await ChatMessage.create({
      roomKey,
      username: socket.username,
      text,
      role: "user"
    });

    broadcastToRoom(roomKey, { type: "room-message", message: userMessage });

    if (roomKey === "support") {
      const supportResponse = await sendGroqSupportAnswer(text);
      const assistantMessage = await ChatMessage.create({
        roomKey,
        username: "Groq Assistant",
        text: supportResponse.text,
        role: "assistant"
      });
      broadcastToRoom(roomKey, { type: "room-message", message: assistantMessage });
    }

    return;
  }

  socket.send(JSON.stringify({ type: "error", message: "Tipo de mensaje desconocido" }));
};

module.exports = {
  setWss,
  handleClientMessage,
  broadcastToRoom
};
