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

  const extractText = (value) => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map(extractText).filter(Boolean).join(" ");
    }
    if (typeof value === "object") {
      if (typeof value.output_text === "string") return value.output_text;
      if (typeof value.text === "string") return value.text;
      if (value.content) return extractText(value.content);
      if (value.output) return extractText(value.output);
      return Object.values(value).map(extractText).filter(Boolean).join(" ");
    }
    return "";
  };

  const text = extractText(responseJson).trim();
  if (!text) return null;

  const extractJsonText = (candidate) => {
    const fullJsonMatch = candidate.match(/\{[\s\S]*\}/);
    if (fullJsonMatch) return fullJsonMatch[0];
    return candidate;
  };

  const jsonText = extractJsonText(text);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("Groq moderation JSON parse failed", { text, jsonText, error: error.message });
    return null;
  }
};

const moderateCommentWithGroq = (apiKey, comment) => {
  return new Promise((resolve, reject) => {
    // Try up to 3 attempts to get a parsable moderation response. Set temperature=0 for deterministic output.
    const makeRequest = (attempt) => {
      return new Promise((resolveReq, rejectReq) => {
        const payload = JSON.stringify({
          model: "openai/gpt-oss-20b",
          input: `Eres un clasificador de comentarios en español. Responde únicamente con un JSON válido con las llaves: allowed, block, category, reason.\n- Si el comentario es una opinión, márcalo como "apropiado" siempre que no contenga insultos directos, amenazas, agresividad explícita o contenido sexual/pornográfico explícito.\n- Si el comentario incluye insultos, lenguaje sexual explícito, pornografía, agresividad o amenazas, márcalo como "inapropiado".\n- Usa únicamente las categorías "apropiado" o "inapropiado".\n- El campo reason debe ser una explicación corta y directa.\nAquí está el comentario: "${comment}"`,
          temperature: 0,
          max_output_tokens: 500
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
                return rejectReq(new Error(`Groq API error ${res.statusCode}`));
              }

              let responseJson;
              try {
                responseJson = JSON.parse(data);
              } catch (err) {
                console.error("Groq response not JSON", err.message, { attempt });
                return rejectReq(new Error("Respuesta de moderación inválida"));
              }

              const parsed = parseGroqModerationOutput(responseJson);
              if (!parsed) {
                console.warn("Groq parse returned null", { attempt });
                return rejectReq(new Error("Respuesta de moderación inválida"));
              }

              resolveReq(parsed);
            });
          }
        );

        request.on("error", (err) => rejectReq(err));
        request.write(payload);
        request.end();
      });
    };

    (async () => {
      const maxAttempts = 3;
      for (let i = 1; i <= maxAttempts; i++) {
        try {
          const result = await makeRequest(i);
          return resolve(result);
        } catch (err) {
          console.warn(`Moderation attempt ${i} failed:`, err.message);
          if (i < maxAttempts) {
            // small backoff
            await new Promise((r) => setTimeout(r, 300 * i));
            continue;
          }
          // after retries, fallback: treat as allowed but log clearly
          console.error("Moderation failed after retries; falling back to allow", { error: err.message });
          return resolve({ allowed: true, block: false, category: "apropiado", reason: "Moderación fallida; tratado como apropiado" });
        }
      }
    })();
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

    const config = await Config.findOne();
    const apiConfig = config?.apiComentarios?.find(
      (item) => item.key === "apiComentarios"
    );
    const groqKey = extractGroqKey(apiConfig?.value);

    console.log("[COMMENTS] groq config", {
      value: apiConfig?.value,
      extractedKey: groqKey ? `${groqKey.slice(0, 10)}...` : null
    });

    if (!groqKey) {
      return res.status(500).json({ message: "No hay clave de Groq configurada" });
    }

    let moderation;

    try {
      console.log("[COMMENTS] calling Groq moderation");
      moderation = await moderateCommentWithGroq(groqKey, text);
      console.log("[COMMENTS] groq result", moderation);
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