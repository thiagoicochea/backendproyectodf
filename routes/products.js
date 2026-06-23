const express = require("express");
const https = require("https");
const router = express.Router();

const Product = require("../models/Product");
const Config = require("../models/Config");
const wsBroadcast = require("../utils/wsBroadcast");

const extractGroqKey = (value) => {
  if (!value) return null;
  let candidate = value.trim();
  if (candidate.startsWith("http")) {
    try {
      candidate = new URL(candidate).pathname;
    } catch (err) {
      candidate = value;
    }
  }
  const match = candidate.match(/(gsk_[A-Za-z0-9_-]+)/);
  return match ? match[1] : candidate;
};

const parseGroqModerationOutput = (responseJson) => {
  if (!responseJson) return null;

  let text = responseJson.output_text;

  if (!text && Array.isArray(responseJson.output)) {
    text = responseJson.output
      .map((item) => {
        if (!item?.content) return "";
        return item.content
          .map((contentItem) => contentItem.text || "")
          .join("");
      })
      .join("");
  }

  if (!text && responseJson.output?.[0]?.content) {
    text = responseJson.output[0].content
      .map((contentItem) => contentItem.text || "")
      .join("");
  }

  if (!text) return null;

  try {
    return JSON.parse(text.trim());
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (err) {
        return null;
      }
    }
    return null;
  }
};

const moderateCommentWithGroq = (apiKey, comment) => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "llama",
      input: [
        {
          role: "system",
          content: "Eres un asistente de moderación de comentarios. Responde solo con JSON válido y no agregues texto extra. Usa las llaves allowed, block, category y reason."
        },
        {
          role: "user",
          content: `Analiza este comentario y devuelve JSON. Si el comentario es impropio, block debe ser true y allowed debe ser false. Comenta: ${comment}`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "moderation",
          schema: {
            type: "object",
            properties: {
              allowed: { type: "boolean" },
              block: { type: "boolean" },
              category: { type: "string" },
              reason: { type: "string" }
            },
            required: ["allowed", "block", "category", "reason"]
          }
        }
      }
    });

    const request = https.request(
      "https://api.groq.com/openai/v1/responses",
      {
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
            return reject(new Error(`Groq API error ${res.statusCode}: ${data}`));
          }

          try {
            const responseJson = JSON.parse(data);
            const parsed = parseGroqModerationOutput(responseJson);
            if (!parsed) {
              return reject(new Error("Respuesta de moderación inválida"));
            }
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    request.on("error", (err) => reject(err));
    request.write(payload);
    request.end();
  });
};

router.get("/", async (req, res) => {

    const products = await Product.find();

    res.json(products);

});

router.get("/:id", async (req, res) => {

    const product = await Product.findById(req.params.id);

    res.json(product);

});

router.post("/:id/comments", async (req, res) => {
  try {
    const { text, rating, user } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ message: "El comentario no puede estar vacío" });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const config = await Config.findOne();
    const apiConfig = config?.apiComentarios?.find(
      (item) => item.key === "apiComentarios"
    );
    const groqKey = extractGroqKey(apiConfig?.value);

    if (!groqKey) {
      return res.status(500).json({ message: "No hay clave de Groq configurada" });
    }

    let moderation;

    try {
      moderation = await moderateCommentWithGroq(groqKey, text);
    } catch (error) {
      console.error("Moderation error:", error);
      return res.status(500).json({ message: "Error al verificar el comentario" });
    }

    if (!moderation.allowed || moderation.block) {
      return res.status(403).json({
        message: "Comentario inapropiado",
        blocked: true,
        reason: moderation.reason || "Contenido inapropiado",
        category: moderation.category || "moderation"
      });
    }

    const newComment = {
      user,
      text,
      rating,
      createdAt: new Date()
    };

    product.comments.unshift(newComment);

    await product.save();

    wsBroadcast.broadcastCommentUpdate(req.params.id, product.comments);

    res.json({
      message: "Comentario agregado",
      comments: product.comments
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error interno" });
  }
});

module.exports = router;