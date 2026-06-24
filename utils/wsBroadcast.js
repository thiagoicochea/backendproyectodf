const ChatMessage = require("../models/ChatMessage");
const { buildSupportBotReply, createSupportSession, checkTextSafety } = require("./supportBot");

let wss = null;
const roomUsers = new Map();

const setWss = (instance) => {
  wss = instance;
};

const getRoomMembers = (roomKey) => {
  if (!roomKey) return [];
  const existing = roomUsers.get(roomKey) || [];
  return existing.filter(Boolean);
};

const broadcastToRoom = (roomKey, payload, excludeSocket = null) => {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.roomKey === roomKey && client !== excludeSocket) {
      client.send(JSON.stringify(payload));
    }
  });
};

const broadcastRoomUsers = (roomKey) => {
  const users = getRoomMembers(roomKey).map((user) => ({
    id: user.id,
    username: user.username,
    profileImg: user.profileImg || ""
  }));
  broadcastToRoom(roomKey, { type: "room-users", users });
};

const addUserToRoom = (socket, roomKey) => {
  if (!roomKey) return;
  const current = getRoomMembers(roomKey);
  const next = current.filter((user) => user.id !== socket.userId);
  next.push({
    id: socket.userId || socket.id,
    username: socket.username || "Usuario",
    profileImg: socket.profileImg || ""
  });
  roomUsers.set(roomKey, next);
  broadcastRoomUsers(roomKey);
};

const removeUserFromRoom = (socket) => {
  if (!socket?.roomKey) return;
  const current = getRoomMembers(socket.roomKey);
  const next = current.filter((user) => user.id !== (socket.userId || socket.id));
  if (next.length) {
    roomUsers.set(socket.roomKey, next);
  } else {
    roomUsers.delete(socket.roomKey);
  }
  broadcastRoomUsers(socket.roomKey);
};

const persistMessage = async ({ roomKey, userId, username, text, profileImg, role = "user", meta = {} }) => {
  const message = await ChatMessage.create({
    roomKey,
    userId,
    username,
    text,
    profileImg,
    role,
    meta
  });
  return message.toObject();
};

const handleClientMessage = async (socket, message) => {
  if (!message || typeof message !== "object") return;

  const { type, roomKey, text, username, userId, profileImg } = message;

  if (type === "join") {
    socket.roomKey = roomKey || socket.roomKey;
    socket.username = username || socket.username || "Usuario";
    socket.userId = userId || socket.userId || socket.id;
    socket.profileImg = profileImg || socket.profileImg || "";

    if (socket.roomKey) {
      addUserToRoom(socket, socket.roomKey);
      socket.send(JSON.stringify({ type: "joined", roomKey: socket.roomKey }));
    }
    return;
  }

  if (type === "typing" && socket.roomKey) {
    broadcastToRoom(socket.roomKey, { type: "typing", username: socket.username || "Usuario" }, socket);
    return;
  }

  if (type === "message" && roomKey) {
    const normalizedText = String(text || "").trim();
    if (!normalizedText) return;

    if (roomKey === "community") {
      const safety = await checkTextSafety(normalizedText);
      if (!safety.allowed) {
        socket.send(JSON.stringify({ type: "error", message: safety.reason || "Mensaje no permitido." }));
        return;
      }
    }

    const savedMessage = await persistMessage({
      roomKey,
      userId: userId || socket.userId || null,
      username: username || socket.username || "Usuario",
      text: normalizedText,
      profileImg: profileImg || socket.profileImg || "",
      role: "user"
    });

    broadcastToRoom(roomKey, { type: "room-message", message: savedMessage });

    if (roomKey === "support") {
      const session = socket.supportSession || createSupportSession(socket.username || "cliente");
      socket.supportSession = session;
      const replyText = await buildSupportBotReply(normalizedText, session);
      const assistantMessage = await persistMessage({
        roomKey,
        username: "NendoBot",
        text: replyText,
        profileImg: "",
        role: "assistant"
      });
      broadcastToRoom(roomKey, { type: "room-message", message: assistantMessage });
    }
  }
};

const handleClientDisconnect = (socket) => {
  removeUserFromRoom(socket);
};

const broadcastPurchaseAlert = (payload) => {
  if (!wss) return;
  wss.clients.forEach((client) => {
    client.send(JSON.stringify({ type: "purchase-alert", payload }));
  });
};

const broadcastCommentUpdate = (productId, comments) => {
  if (!wss) return;
  wss.clients.forEach((client) => {
    client.send(JSON.stringify({ type: "comment-update", productId, comments }));
  });
};

module.exports = {
  setWss,
  handleClientMessage,
  handleClientDisconnect,
  broadcastPurchaseAlert,
  broadcastCommentUpdate,
  checkTextSafety
};
