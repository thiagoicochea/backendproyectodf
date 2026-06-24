const express = require("express");
const router = express.Router();

const Product = require("../models/Product");
const wsBroadcast = require("../utils/wsBroadcast");
const { getGroqApiKey, callGroq, parseGroqJson } = require("../utils/groqClient");

const MODERATION_PROMPT = (comment) => `Eres un clasificador de comentarios en español para una tienda de figuras coleccionables. Responde ÚNICAMENTE con un JSON válido con las llaves: allowed, block, category, reason.
- Si el comentario es una opinión, califícalo como "apropiado" siempre que no contenga insultos directos, amenazas, agresividad explícita o contenido sexual/pornográfico explícito.
- Si el comentario incluye insultos, lenguaje sexual explícito, pornografía, agresividad o amenazas, califícalo como "inapropiado".
- Usa únicamente las categorías "apropiado" o "inapropiado".
- El campo reason debe ser una explicación corta y directa.
Comentario: "${comment}"`;

const moderateCommentWithGroq = async (apiKey, comment) => {
  const text = await callGroq({
    apiKey,
    input: MODERATION_PROMPT(comment),
    temperature: 0,
    maxOutputTokens: 300,
    onFallback: () =>
      JSON.stringify({
        allowed: true,
        block: false,
        category: "apropiado",
        reason: "Moderación fallida; tratado como apropiado"
      })
  });

  const parsed = parseGroqJson(text);
  if (!parsed) {
    throw new Error("Respuesta de moderación inválida");
  }
  return parsed;
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

    console.log("[COMMENTS] incoming comment", {
      productId: req.params.id,
      user,
      text: text?.slice(0, 100)
    });

    if (!text || !text.trim()) {
      return res.status(400).json({ message: "El comentario no puede estar vacío" });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const localSafety = String(text || "").trim().toLowerCase();
    const blockedPatterns = [
      /\b(sex|sexual|porno|pornografia|nudez|desnudo|masturb|orgias?)\b/i,
      /\b(violencia|matar|asesinar|golpear|agredir|arma|explosivo|suicida|suicidio)\b/i,
      /\b(puta|puto|mierda|idiota|estúpido|maldito)\b/i,
      /\b(terror|bomb|matarte|hacerte daño)\b/i
    ];
    const localBlocked = blockedPatterns.some((pattern) => pattern.test(localSafety));

    let moderation = {
      allowed: !localBlocked,
      block: localBlocked,
      category: localBlocked ? "inapropiado" : "apropiado",
      reason: localBlocked ? "Contenido inapropiado" : "Aprobado por filtro local"
    };

    try {
      const groqKey = await getGroqApiKey();
      if (groqKey) {
        console.log("[COMMENTS] calling Groq moderation");
        moderation = await moderateCommentWithGroq(groqKey, text);
        console.log("[COMMENTS] groq result", moderation);
      } else {
        console.warn("[COMMENTS] no hay clave de Groq, usando filtro local");
      }
    } catch (error) {
      console.error("Moderation error:", error);
      moderation = {
        allowed: !localBlocked,
        block: localBlocked,
        category: localBlocked ? "inapropiado" : "apropiado",
        reason: localBlocked ? "Contenido inapropiado" : "Aprobado por filtro local"
      };
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
