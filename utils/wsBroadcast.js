const https = require("https");
const ChatMessage = require("../models/ChatMessage");
const ChatRoom = require("../models/ChatRoom");

let wss;
const roomUsers = {};
const activeConnections = new Map();

const setWss = (server) => {
  wss = server;
};

const getGroqKey = () => process.env.GROQ_API_KEY || null;

const supportBusinessContext = `NendoShop es una tienda especializada en figuras coleccionables, artículos anime y accesorios de cultura pop. El proceso de compra incluye: seleccionar productos en el catálogo, agregar al carrito, pagar con tarjeta o PayPal, recibir un correo con confirmación y un número de seguimiento. Los pedidos se procesan en el almacén, se empaquetan con cuidado y se envían dentro de 24-48 horas. Las devoluciones se gestionan en un plazo de 7 días si el producto llega en buen estado, y el soporte puede ayudar sobre disponibilidad, envíos, pagos, cambios y seguimiento.`;

const localSupportFallback = (comment) => {
  const lower = comment.toLowerCase();
  if (lower.includes("envío") || lower.includes("entrega") || lower.includes("tracking") || lower.includes("seguimiento")) {
    return "En NendoShop, los pedidos se procesan en 24-48 horas y después recibes un número de seguimiento. Si quieres saber el estado de un envío, dame tu número de pedido y te explico el proceso paso a paso.";
  }
  if (lower.includes("pago") || lower.includes("tarjeta") || lower.includes("paypal") || lower.includes("comprar")) {
    return "Aceptamos tarjetas y PayPal en NendoShop. El pago se procesa de forma segura y recibes una confirmación por correo. Si tienes problemas con el pago, revisa que los datos de tu tarjeta sean correctos o prueba con otro método.";
  }
  if (lower.includes("devolución") || lower.includes("cambio") || lower.includes("reembolso")) {
    return "Puedes solicitar una devolución o cambio dentro de 7 días después de recibir tu pedido. Conserva el empaque original y comunícate con soporte para que te orienten en el proceso.";
  }
  return "NendoShop ofrece ayuda sobre productos, envíos, pagos y seguimiento de pedidos. Cuéntame tu duda y te respondo con detalles sobre cómo funciona nuestro servicio.";
};

const sendGroqSupportAnswer = (comment) => {
  return new Promise((resolve) => {
    const apiKey = getGroqKey();
    const prompt = `Eres un asistente de soporte para una tienda llamada NendoShop. ${supportBusinessContext} Responde en español y con claridad a esta consulta del usuario:\n\n${comment}`;

    if (!apiKey) {
      return resolve({ text: localSupportFallback(comment) });
    }

    const payload = JSON.stringify({
      model: "llama",
      input: prompt,
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
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error("Groq support error", res.statusCode, data);
            return resolve({ text: localSupportFallback(comment) });
          }
          try {
            const parsed = JSON.parse(data);
            let text = "";
            if (parsed.output_text) text = parsed.output_text;
            if (!text && Array.isArray(parsed.output)) {
              text = parsed.output
                .map((item) => {
                  if (item?.content) return item.content.map((c) => c.text || "").join("");
                  if (item?.text) return item.text;
                  return "";
                })
                .join(" ");
            }
            resolve({ text: text.trim() || localSupportFallback(comment) });
          } catch (err) {
            console.error("Groq support parse error", err.message, data);
            resolve({ text: localSupportFallback(comment) });
          }
        });
      }
    );

    request.on("error", (err) => {
      console.error("Groq support request error", err.message);
      resolve({ text: localSupportFallback(comment) });
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

const getRoomUsers = (roomKey) => roomUsers[roomKey] || [];
const createUserPayload = (socket) => ({
  id: socket.id,
  username: socket.username,
  avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(socket.username)}&background=7c3aed&color=ffffff`,
  online: true
});

const addRoomUser = (roomKey, socket) => {
  if (!roomUsers[roomKey]) roomUsers[roomKey] = [];
  if (!roomUsers[roomKey].some((user) => user.id === socket.id)) {
    roomUsers[roomKey].push(createUserPayload(socket));
  }
};

const removeRoomUser = (roomKey, socket) => {
  if (!roomUsers[roomKey]) return;
  roomUsers[roomKey] = roomUsers[roomKey].filter((user) => user.id !== socket.id);
  if (!roomUsers[roomKey].length) delete roomUsers[roomKey];
};

const handleClientDisconnect = (socket) => {
  if (socket.username) {
    const currentSocket = activeConnections.get(socket.username);
    if (currentSocket === socket) {
      activeConnections.delete(socket.username);
    }
  }

  if (!socket.roomKey || !socket.id) return;
  removeRoomUser(socket.roomKey, socket);
  broadcastToRoom(socket.roomKey, {
    type: "user-left",
    userId: socket.id,
    username: socket.username
  });
  broadcastToRoom(socket.roomKey, {
    type: "room-users",
    users: getRoomUsers(socket.roomKey)
  });
};

const handleClientMessage = async (socket, message) => {
  const { type, roomKey, text, username } = message;

  if (type === "join") {
    if (!roomKey || !username) {
      return socket.send(JSON.stringify({ type: "error", message: "Falta sala o nombre de usuario" }));
    }

    if (!socket.id) {
      socket.id = Math.random().toString(36).slice(2);
    }

    const normalizedUsername = String(username).trim() || "Invitado";
    const previousSocket = activeConnections.get(normalizedUsername);
    if (previousSocket && previousSocket !== socket) {
      try {
        previousSocket.send(JSON.stringify({ type: "force-disconnect", message: "Se abrió otra sesión del chat" }));
        previousSocket.close(4000, "duplicate connection");
      } catch (error) {
        console.warn("No se pudo cerrar la conexión previa", error.message);
      }
    }

    if (socket.roomKey && socket.roomKey !== roomKey) {
      removeRoomUser(socket.roomKey, socket);
      broadcastToRoom(socket.roomKey, { type: "user-left", userId: socket.id, username: socket.username });
      broadcastToRoom(socket.roomKey, { type: "room-users", users: getRoomUsers(socket.roomKey) });
    }

    socket.roomKey = roomKey;
    socket.username = normalizedUsername;
    activeConnections.set(normalizedUsername, socket);
    addRoomUser(roomKey, socket);

    socket.send(JSON.stringify({ type: "joined", roomKey }));
    socket.send(JSON.stringify({ type: "room-users", users: getRoomUsers(roomKey) }));
    broadcastToRoom(roomKey, { type: "user-joined", user: createUserPayload(socket) });
    broadcastToRoom(roomKey, { type: "room-users", users: getRoomUsers(roomKey) });
    return;
  }

  if (type === "typing") {
    if (!roomKey || !socket.username) return;
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
        username: "NendoShop Support",
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
  handleClientDisconnect,
  broadcastToRoom
};
