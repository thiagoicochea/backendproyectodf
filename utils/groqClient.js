const https = require("https");
const Config = require("../models/Config");
const GROQ_HOST = "api.groq.com";
const GROQ_PATH = "/openai/v1/responses";
const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

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

const getGroqApiKey = async () => {
  if (process.env.GROQ_API_KEY) {
    return extractGroqKey(process.env.GROQ_API_KEY);
  }

  try {
    const config = await Promise.race([
      Config.findOne().lean(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout de configuración")), 1500))
    ]);
    const apiConfig = config?.apiComentarios?.find(
      (item) => item.key === "apiComentarios"
    );
    return extractGroqKey(apiConfig?.value);
  } catch (err) {
    console.warn("No se pudo leer la configuración de Groq desde Mongo:", err.message);
    return null;
  }
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
