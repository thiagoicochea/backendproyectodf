const https = require("https");
const ChatMessage = require("../models/ChatMessage");
const ChatRoom = require("../models/ChatRoom");
const User = require("../models/User");
const { createSupportSession, buildSupportBotReply } = require("./supportBot");

let wss;
const roomUsers = {};
const activeConnections = new Map();
const supportSessions = new Map();

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

const moderateChatText = async (text) => {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    return { allowed: true, block: false, category: "apropiado", reason: "Mensaje vacío" };
  }

  const lower = cleanText.toLowerCase();
  const suspiciousWords = ["insulto", "idiota", "tonto", "puta", "puta", "mierda", "sexo", "porn", "amenaza", "matar", "mata", "kill", "fuck", "shit", "bitch"];
  const shouldBlock = suspiciousWords.some((word) => lower.includes(word));
  if (shouldBlock) {
    return { allowed: false, block: true, category: "inapropiado", reason: "Contenido inapropiado detectado" };
  }

  const apiKey = getGroqKey();
  if (!apiKey) {
    return { allowed: true, block: false, category: "apropiado", reason: "Sin indicios de abuso" };
  }

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: "llama",
      input: `Eres un moderador de chat. Responde únicamente con un JSON válido con las llaves: allowed, block, category, reason. Si el mensaje contiene insultos, amenazas, contenido sexual explícito, spam o agresión, marca block true y allowed false. Si es una conversación normal, marca allowed true y block false. Mensaje: "${cleanText}"`,
      temperature: 0,
      max_output_tokens: 180
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
          try {
            const parsed = JSON.parse(data);
            const outputText = parsed.output_text || "";
            const result = outputText ? JSON.parse(outputText) : null;
            if (result && typeof result === "object") {
              resolve({
                allowed: result.allowed !== false,
                block: Boolean(result.block),
                category: result.category || "apropiado",
                reason: result.reason || ""
              });
              return;
            }
          } catch (error) {
            console.warn("Moderación de chat fallida", error.message);
          }
          resolve({ allowed: true, block: false, category: "apropiado", reason: "Fallback" });
        });
      }
    );

    request.on("error", () => {
      resolve({ allowed: true, block: false, category: "apropiado", reason: "Fallback" });
    });

    request.write(payload);
    request.end();
  });
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
  online: true,
  status: socket.chatBlocked ? "Bloqueado" : "Activo"
});

const broadcastPurchaseAlert = (payload) => {
  if (!wss) return;
  const message = JSON.stringify({ type: "purchase-alert", payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
};

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
  const { type, roomKey, text, username, userId } = message;

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
        previousSocket.send(JSON.stringify({ type: "presence-update", message: "Se reactivó tu sesión del chat" }));
      } catch (error) {
        console.warn("No se pudo notificar la sesión previa", error.message);
      }
    }

    socket.userId = userId || socket.userId || null;
    if (socket.roomKey && socket.roomKey !== roomKey) {
      removeRoomUser(socket.roomKey, socket);
      broadcastToRoom(socket.roomKey, { type: "user-left", userId: socket.id, username: socket.username });
      broadcastToRoom(socket.roomKey, { type: "room-users", users: getRoomUsers(socket.roomKey) });
    }

    socket.roomKey = roomKey;
    socket.username = normalizedUsername;
    activeConnections.set(normalizedUsername, socket);
    addRoomUser(roomKey, socket);

    if (roomKey === "support") {
      const existingSession = supportSessions.get(socket.userId || normalizedUsername) || createSupportSession();
      supportSessions.set(socket.userId || normalizedUsername, existingSession);
      socket.send(JSON.stringify({ type: "support-session", session: existingSession }));
    }

    if (socket.userId) {
      const userRecord = await User.findById(socket.userId).catch(() => null);
      socket.chatBlocked = Boolean(userRecord?.chatBlockedUntil && new Date(userRecord.chatBlockedUntil) > new Date());
      socket.chatBlockedUntil = userRecord?.chatBlockedUntil || null;
      if (socket.chatBlocked) {
        return socket.send(JSON.stringify({ type: "error", message: "Tu cuenta está temporalmente bloqueada para chatear" }));
      }
    }

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

    if (socket.chatBlocked) {
      return socket.send(JSON.stringify({ type: "error", message: "Tu cuenta está bloqueada para chatear" }));
    }

    const room = await ChatRoom.findOne({ key: roomKey });
    if (!room) {
      return socket.send(JSON.stringify({ type: "error", message: "Sala de chat inválida" }));
    }

    const moderation = await moderateChatText(text);
    if (!moderation.allowed || moderation.block) {
      return socket.send(JSON.stringify({ type: "error", message: moderation.reason || "Tu mensaje fue bloqueado por moderación" }));
    }

    const userMessage = await ChatMessage.create({
      roomKey,
      userId: socket.userId || undefined,
      username: socket.username,
      text,
      role: "user"
    });

    broadcastToRoom(roomKey, { type: "room-message", message: userMessage });

    if (roomKey === "support") {
      const sessionKey = socket.userId || socket.username;
      const session = supportSessions.get(sessionKey) || createSupportSession();
      supportSessions.set(sessionKey, session);
      const supportResponseText = buildSupportBotReply(text, session);
      const assistantMessage = await ChatMessage.create({
        roomKey,
        userId: null,
        username: "NendoBot",
        text: supportResponseText,
        role: "assistant"
      });
      broadcastToRoom(roomKey, { type: "room-message", message: assistantMessage });
      socket.send(JSON.stringify({ type: "support-session", session }));
    }

    return;
  }

  if (type === "report-user") {
    const targetUserId = message.targetUserId || message.userId || null;
    const targetUsername = message.targetUsername || null;
    const reason = message.reason || "Sin motivo especificado";
    if (!targetUserId && !targetUsername) {
      return socket.send(JSON.stringify({ type: "error", message: "No hay usuario para reportar" }));
    }

    const targetUser = targetUserId
      ? await User.findById(targetUserId).catch(() => null)
      : await User.findOne({ $or: [{ name: targetUsername }, { email: targetUsername }] }).catch(() => null);

    if (!targetUser) {
      return socket.send(JSON.stringify({ type: "error", message: "No se encontró al usuario" }));
    }

    const nextCount = (targetUser.chatReportCount || 0) + 1;
    targetUser.chatReportCount = nextCount;
    if (nextCount >= 10) {
      targetUser.chatBlockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      targetUser.chatBlockReason = reason;
    }
    await targetUser.save();

    socket.send(JSON.stringify({
      type: "report-result",
      success: true,
      count: nextCount,
      blocked: Boolean(targetUser.chatBlockedUntil && new Date(targetUser.chatBlockedUntil) > new Date())
    }));

    broadcastToRoom(socket.roomKey, {
      type: "user-report",
      username: targetUser.name || targetUser.email || targetUsername,
      count: nextCount,
      blocked: Boolean(targetUser.chatBlockedUntil && new Date(targetUser.chatBlockedUntil) > new Date())
    });
    return;
  }

  socket.send(JSON.stringify({ type: "error", message: "Tipo de mensaje desconocido" }));
};

module.exports = {
  setWss,
  handleClientMessage,
  handleClientDisconnect,
  broadcastToRoom,
  broadcastPurchaseAlert
};
