let wss;

const setWss = (server) => {
  wss = server;
};

const broadcastCommentUpdate = (productId, comments) => {
  if (!wss) return;

  const message = JSON.stringify({
    type: "comment-update",
    productId,
    comments,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.productId === productId) {
      client.send(message);
    }
  });
};

module.exports = {
  setWss,
  broadcastCommentUpdate,
};
