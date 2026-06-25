const express = require("express");
const router = express.Router();

const Product = require("../models/Product");
const wsBroadcast = require("../utils/wsBroadcast");
const verifyToken = require("../middlewares/verifyToken");
const { recordLog } = require("../utils/logger");
const { getGroqApiKey, callGroq, parseGroqJson } = require("../utils/groqClient");

const commentCooldown = new Map();

const normalizeSearchText = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const scoreProductMatch = (product, query) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const terms = normalizedQuery.split(" ").filter(Boolean);
  const name = normalizeSearchText(product.name || "");
  const description = normalizeSearchText(product.description || "");
  const category = normalizeSearchText(product.specs?.categoria || "");
  const brand = normalizeSearchText(product.specs?.marca || "");
  const priceText = normalizeSearchText(String(product.price || ""));

  let score = 0;

  if (name.includes(normalizedQuery)) {
    score += 80;
  } else if (name.includes(terms[0] || "")) {
    score += 40;
  }

  terms.forEach((term) => {
    if (!term) return;
    if (name.includes(term)) score += 20;
    if (description.includes(term)) score += 10;
    if (category.includes(term)) score += 8;
    if (brand.includes(term)) score += 8;
  });

  if (priceText.includes(normalizedQuery)) score += 15;

  const priceMatch = normalizedQuery.match(/\b(\d{1,3}(?:[.,]\d{1,2})?)\b/g);
  if (priceMatch?.length) {
    const numericQuery = Number(priceMatch[0].replace(",", "."));
    const numericPrice = Number(product.price || 0);
    if (!Number.isNaN(numericQuery) && !Number.isNaN(numericPrice)) {
      if (numericPrice === numericQuery) score += 25;
      else if (Math.abs(numericPrice - numericQuery) <= 10) score += 12;
    }
  }

  return score;
};

const buildProductSearchSummary = (product) => {
  const category = product.specs?.categoria || "";
  const brand = product.specs?.marca || "";
  return `${product.name} | ${product.description || ""} | ${category} | ${brand} | S/. ${product.price || 0}`;
};

const getLocalProductMatches = (products, query) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [...products].sort((a, b) => Number(a.price || 0) - Number(b.price || 0)).slice(0, 20);
  }

  return products
    .map((product) => ({ product, score: scoreProductMatch(product, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.product)
    .slice(0, 20);
};

const SEARCH_PROMPT = (query, productsSummary) => `Eres un asistente de búsqueda para una tienda de figuras coleccionables. Analiza la consulta del usuario y responde ÚNICAMENTE con JSON válido con estas llaves: searchQuery, productNames, reason.
- searchQuery debe ser una versión refinada de la consulta del usuario.
- productNames debe ser un arreglo con los nombres de productos que mejor encajan con la consulta.
- Usa solo los nombres que aparecen en la siguiente lista de productos.
Consulta: "${query}"
Productos:
${productsSummary}`;

const moderateSearchIntentWithGroq = async (query, productsSummary) => {
  const apiKey = await getGroqApiKey();
  if (!apiKey) return null;

  const text = await callGroq({
    apiKey,
    input: SEARCH_PROMPT(query, productsSummary),
    temperature: 0,
    maxOutputTokens: 300,
    onFallback: () => JSON.stringify({ searchQuery: query, productNames: [], reason: "fallback" })
  });

  const parsed = parseGroqJson(text);
  return parsed;
};

const antiSpam = (req, res, next) => {
  const userId = req.user?.id || req.body?.user || req.headers["x-user-id"];

  if (!userId) {
    return next();
  }

  const lastComment = commentCooldown.get(userId);
  if (lastComment && Date.now() - lastComment < 10000) {
    return res.status(429).json({
      success: false,
      message: "Debes esperar 10 segundos antes de comentar nuevamente."
    });
  }

  commentCooldown.set(userId, Date.now());
  next();
};

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

router.get("/search", async (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    const products = await Product.find().lean();
    let matches = getLocalProductMatches(products, query);
    let appliedBy = "local";

    if (query) {
      try {
        const groqKey = await getGroqApiKey();
        if (groqKey) {
          const aiResult = await moderateSearchIntentWithGroq(
            query,
            products.slice(0, 40).map(buildProductSearchSummary).join("\n")
          );

          if (aiResult?.productNames?.length) {
            const preferredNames = aiResult.productNames
              .map((name) => String(name || "").trim())
              .filter(Boolean);

            const aiMatches = products.filter((product) =>
              preferredNames.some((name) =>
                normalizeSearchText(product.name).includes(normalizeSearchText(name)) ||
                normalizeSearchText(name).includes(normalizeSearchText(product.name))
              )
            );

            if (aiMatches.length) {
              matches = aiMatches.slice(0, 20);
              appliedBy = "groq";
            }
          }
        }
      } catch (error) {
        console.error("Search intent error:", error);
      }
    }

    await recordLog({
      req,
      usuario: req.user?.email || req.user?.id || "Anónimo",
      descripcion: `Búsqueda de productos: ${query}`,
      tipo: "TRANSACCION",
      metodo: req.method,
      ruta: req.originalUrl
    });

    res.json({ query, appliedBy, products: matches });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ message: "Error al buscar productos" });
  }
});

router.post("/search-intent", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();
    const products = await Product.find().lean();
    const matches = getLocalProductMatches(products, query);
    res.json({ query, appliedBy: "local", products: matches });
  } catch (error) {
    console.error("Search intent error:", error);
    res.status(500).json({ message: "Error al interpretar la búsqueda" });
  }
});

router.get("/", async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

router.post("/:id/like", verifyToken, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const userId = req.user?.id;
    const liked = (product.likedBy || []).some((id) => String(id) === String(userId));
    const disliked = (product.dislikedBy || []).some((id) => String(id) === String(userId));

    if (liked) {
      return res.status(409).json({ message: "Ya registraste este like." });
    }

    if (disliked) {
      product.dislikedBy = (product.dislikedBy || []).filter((id) => String(id) !== String(userId));
      product.dislikes = Math.max(0, (product.dislikes || 0) - 1);
    }

    product.likedBy = [...(product.likedBy || []), userId];
    product.likes = (product.likes || 0) + 1;
    await product.save();

    await recordLog({
      req,
      usuario: req.user?.email || req.user?.id || "Anónimo",
      descripcion: `Like agregado al producto ${product._id}`,
      tipo: "TRANSACCION",
      metodo: req.method,
      ruta: req.originalUrl
    });

    res.json({ message: "Like agregado", product });
  } catch (error) {
    console.error("Like error:", error);
    res.status(500).json({ message: "Error al registrar like" });
  }
});

router.post("/:id/dislike", verifyToken, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const userId = req.user?.id;
    const disliked = (product.dislikedBy || []).some((id) => String(id) === String(userId));
    const liked = (product.likedBy || []).some((id) => String(id) === String(userId));

    if (disliked) {
      return res.status(409).json({ message: "Ya registraste este dislike." });
    }

    if (liked) {
      product.likedBy = (product.likedBy || []).filter((id) => String(id) !== String(userId));
      product.likes = Math.max(0, (product.likes || 0) - 1);
    }

    product.dislikedBy = [...(product.dislikedBy || []), userId];
    product.dislikes = (product.dislikes || 0) + 1;
    await product.save();

    await recordLog({
      req,
      usuario: req.user?.email || req.user?.id || "Anónimo",
      descripcion: `Dislike agregado al producto ${product._id}`,
      tipo: "TRANSACCION",
      metodo: req.method,
      ruta: req.originalUrl
    });

    res.json({ message: "Dislike agregado", product });
  } catch (error) {
    console.error("Dislike error:", error);
    res.status(500).json({ message: "Error al registrar dislike" });
  }
});

router.get("/:id", async (req, res) => {
  const product = await Product.findById(req.params.id);
  res.json(product);
});

router.post("/:id/comments", antiSpam, async (req, res) => {
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

    await recordLog({
      req,
      usuario: user || "Anónimo",
      descripcion: `Comentario agregado al producto ${product._id}`,
      tipo: "TRANSACCION",
      metodo: req.method,
      ruta: req.originalUrl
    });

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
