// utils/groqClient.js
//
// Helper compartido para hablar con el endpoint "responses" de Groq.
// Centraliza: extracción de la API key desde Config, la llamada HTTPS con
// reintentos, y el parseo de JSON — así el bot de soporte y la moderación
// de comentarios usan exactamente el mismo código probado.

const https = require("https");
const Config = require("../models/Config");

const GROQ_HOST = "api.groq.com";
const GROQ_PATH = "/openai/v1/responses";
const DEFAULT_MODEL = "openai/gpt-oss-20b";

const extractGroqKey = (value) => {
  if (!value) return null;

  let candidate = String(value).trim();

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

// La API key se guarda en un documento Config con un array `apiComentarios`
// que contiene { key: "apiComentarios", value: "<key o url con la key>" }.
// Tanto la moderación de comentarios como el bot reutilizan esa misma key.
const getGroqApiKey = async () => {
  const config = await Config.findOne();
  const apiConfig = config?.apiComentarios?.find(
    (item) => item.key === "apiComentarios"
  );
  return extractGroqKey(apiConfig?.value);
};

const extractOutputText = (value) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractOutputText).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.text === "string") return value.text;
    if (value.content) return extractOutputText(value.content);
    if (value.output) return extractOutputText(value.output);
    return Object.values(value).map(extractOutputText).filter(Boolean).join(" ");
  }
  return "";
};

// Una sola llamada cruda a Groq. Resuelve con el TEXTO que devolvió el modelo.
const requestGroqOnce = (apiKey, payload) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);

    const request = https.request(
      {
        hostname: GROQ_HOST,
        path: GROQ_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${apiKey}`
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Groq API error ${res.statusCode}: ${data.slice(0, 300)}`));
          }

          let responseJson;
          try {
            responseJson = JSON.parse(data);
          } catch (err) {
            return reject(new Error("Respuesta de Groq no es JSON válido"));
          }

          const text = extractOutputText(responseJson).trim();
          if (!text) {
            return reject(new Error("Groq devolvió una respuesta vacía"));
          }

          resolve(text);
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
};

// Llama a Groq con reintentos + backoff simple. `onFallback` deja que el
// llamador decida qué devolver si todos los intentos fallan, en vez de
// romper el flujo de cara al usuario.
const callGroq = async ({
  apiKey,
  input,
  temperature = 0,
  maxOutputTokens = 500,
  model = DEFAULT_MODEL,
  maxAttempts = 3,
  onFallback = null
}) => {
  if (!apiKey) {
    throw new Error("No se encontró la API Key de Groq");
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestGroqOnce(apiKey, {
        model,
        input,
        temperature,
        max_output_tokens: maxOutputTokens
      });
    } catch (err) {
      lastError = err;
      console.warn(`Groq attempt ${attempt} failed:`, err.message);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }

  if (onFallback) {
    console.error("Groq falló tras los reintentos; usando fallback", { error: lastError?.message });
    return onFallback();
  }

  throw lastError;
};

// Quita fences ```json, etc. y parsea el primer bloque {...} en el texto
// de respuesta del modelo. Nunca lanza error: devuelve null si no puede
// parsear, para que el llamador decida cómo fallar de forma segura.
const parseGroqJson = (text) => {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : text;
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    console.error("No se pudo parsear JSON de Groq", { text, error: err.message });
    return null;
  }
};

module.exports = {
  extractGroqKey,
  getGroqApiKey,
  callGroq,
  parseGroqJson
};
