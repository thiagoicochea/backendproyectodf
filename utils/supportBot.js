// services/supportBot.js
//
// NendoBot: asesor de atención al cliente con Groq.
//
// Flujo por turno:
//   1. Filtro rápido local (regex) -> corta de inmediato lo obviamente
//      violento/sexual sin gastar una llamada a Groq.
//   2. Clasificación con Groq -> moderación fina + intención + datos
//      (qué producto pide, qué número de pedido, etc.).
//   3. Si la intención requiere datos reales (producto / pedido), se
//      consulta la base de datos. El bot NUNCA inventa precio, stock,
//      estado de pedido, etc. — solo usa lo que viene de Mongo.
//   4. Una segunda llamada a Groq redacta la respuesta final en lenguaje
//      natural, usando solo esos hechos y el historial reciente (para no
//      repetirse), y con instrucciones estrictas de tono/seguridad.
//   5. Filtro de seguridad también sobre la SALIDA del modelo (defensa en
//      profundidad), antes de mandarla al usuario.
//
// Etapas de la conversación (session.step):
//   welcome -> active -> (survey al despedirse) -> closed
//
// IMPORTANTE — ajusta esto a tu proyecto:
//   PRODUCT_DETAIL_PATH asume que el detalle de un producto vive en
//   "/product/:id" en tu frontend (a juzgar por ProductDetail.jsx, que usa
//   useParams().{_id}). Si tu ruta real es "/products/:id" o "/producto/:id",
//   cámbiala abajo. Define también la variable de entorno FRONTEND_URL.

const Payment = require("../models/Payment");
const Product = require("../models/Product");
const { getGroqApiKey, callGroq, parseGroqJson } = require("../utils/groqClient");

const FRONTEND_BASE_URL = process.env.FRONTEND_URL || process.env.REACT_APP_FRONTEND_URL || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://nendoshop.onrender.com");
const PRODUCT_DETAIL_PATH = "/product";
const buildProductLink = (id) => {
  const base = String(FRONTEND_BASE_URL || "https://nendoshop.onrender.com").replace(/\/$/, "");
  return `${base}/#/product/${id}`;
};

const SUPPORT_INTRO =
  "Hola, soy NendoBot, tu asesor de atención al cliente de NendoShop. Te puedo ayudar con pedidos, productos, devoluciones y cuentas. También puedo orientarte sobre un producto específico o ayudarte a encontrar el más económico.";

// ---------------------------------------------------------------------------
// Filtro rápido local (defensa en profundidad, no sustituye a Groq)
// ---------------------------------------------------------------------------

const checkTextSafety = (text) => {
  const value = String(text || "").trim().toLowerCase();
  if (!value) {
    return { allowed: false, block: true, reason: "El mensaje está vacío." };
  }

  const normalized = value.replace(/[^a-z0-9]/g, "");
  const blockedPatterns = [
    /\b(sex|sexual|porno|pornografia|nudez|desnudo|masturb|orgias?)\b/i,
    /\b(violencia|matar|asesinar|golpear|agredir|arma|explosivo|suicida|suicidio)\b/i,
    /\b(puta|puto|mierda|idiota|estúpido|maldito)\b/i,
    /\b(terror|bomb|matarte|hacerte daño)\b/i,
    /\b(pu?ta)\b/i,
    /\b(p\s*u\s*t\s*a)\b/i,
    /\b(p\s*u\s*t\s*o)\b/i
  ];

  const blocked = blockedPatterns.some((pattern) => pattern.test(value)) || /(puta|puto|mierda|idiota|estupido|maldito)/i.test(normalized);
  return {
    allowed: !blocked,
    block: blocked,
    reason: blocked ? "El mensaje contiene contenido no permitido." : "Mensaje aceptado."
  };
};

// ---------------------------------------------------------------------------
// Utilidades de sesión
// ---------------------------------------------------------------------------

const normalizeCustomerName = (value) => {
  const name = String(value || "cliente").trim();
  return name || "cliente";
};

const createSupportSession = (customerName = "cliente") => ({
  step: "welcome", // welcome | active | survey | closed
  topic: null,
  lastTopic: null,
  customerName: normalizeCustomerName(customerName),
  surveyAsked: false,
  history: [] // [{ role: "user"|"bot", text }]
});

const pushHistory = (session, role, text) => {
  if (!session.history) session.history = [];
  session.history.push({ role, text });
  if (session.history.length > 12) {
    session.history = session.history.slice(-12);
  }
};

// ---------------------------------------------------------------------------
// Extracción local (fallback cuando Groq no está disponible o no extrajo nada)
// ---------------------------------------------------------------------------

const extractOrderNumber = (text) => {
  const match = text.match(/(?:pedido|orden|n(?:ú|u)mero de pedido|seguimiento)[^0-9]*(\d{2,})/i);
  if (match) return match[1];
  const fallback = text.match(/\b(\d{2,})\b/);
  return fallback ? fallback[1] : null;
};

const extractProductHint = (text) => {
  const hints = text.match(/(?:producto|figura|art(?:í|i)culo|modelo|articulo)[^a-záéíóúñü0-9]*([a-záéíóúñü0-9 .,'-]+)/i);
  if (hints && hints[1]) return hints[1].trim();
  const fallback = text.match(/(?:quiero|busco|necesito|interesa|recomienda|ver)[^a-záéíóúñü0-9]*([a-záéíóúñü0-9 .,'-]+)/i);
  return fallback ? fallback[1].trim() : null;
};

const extractSurveyRating = (text) => {
  const numMatch = text.match(/\b([1-5])\b/);
  if (numMatch) return Number(numMatch[1]);
  if (/\b(si|sí|excelente|genial|perfecto|bien|ok|okay)\b/i.test(text)) return 5;
  if (/\b(no|mal|p[eé]simo|regular|mejorar)\b/i.test(text)) return 2;
  return null;
};

const explainRolePattern = /\b(qué haces|que haces|por qué haces|por que haces|para qué sirves|cuál es tu función|cual es tu funcion|tus funciones|funciones)\b/i;
const offTopicPattern = /\b(politica|política|deporte|futbol|película|pelicula|serie|noticia|clima|juego|música|musica|viaje|cocina|comida|humor|chiste)\b/i;
const scopeIntentPattern = /\b(pedido|orden|envío|envio|producto|precio|stock|devolucion|devolución|cambio|cuenta|acceso|contraseña|contrase|credencial|ayuda)\b/i;

const getImmediateSupportReply = ({ text, customerName, intent }) => {
  const normalized = String(text || "").trim();
  if (!normalized) return null;

  if (explainRolePattern.test(normalized)) {
    return `Soy NendoBot, tu asesor de atención al cliente de NendoShop. Puedo ayudarte con pedidos, productos, devoluciones y soporte de cuenta. Si tienes una consulta sobre alguno de esos temas, te ayudo enseguida.`;
  }

  if (intent === "devolucion") {
    return /pedido|producto/i.test(normalized)
      ? `Puedo orientarte sobre devoluciones y cambios. Si me compartes el número de pedido o el producto, te digo qué pasos seguir y si aplica.`
      : `Puedo orientarte sobre devoluciones y cambios. Si me dices el pedido o el producto, te ayudo a ver si aplica y qué hacer.`;
  }

  if (intent === "cuenta") {
    return `Puedo ayudarte con acceso a tu cuenta, recuperación de datos o cambios básicos. No pediré tu contraseña; si me explicas el problema, te guío paso a paso.`;
  }

  if (offTopicPattern.test(normalized) || (!scopeIntentPattern.test(normalized) && /\b(quiero|necesito|puedes|ayuda|dime|habl|como)\b/i.test(normalized))) {
    return `Mi función es ayudarte con pedidos, productos, devoluciones y cuenta en NendoShop. Si tu consulta es de otro tema, esa no es mi finalidad.`;
  }

  return null;
};

// ---------------------------------------------------------------------------
// Consultas a base de datos
// ---------------------------------------------------------------------------

const isCheapestRequest = (text) => /(?:producto|art[ií]culo|figura).{0,20}(m[áa]s\s+barato|barato|m[áa]s\s+econ[oó]mico|econ[oó]mico|menor\s+precio|precio\s+menor)/i.test(text) || /(?:m[áa]s\s+barato|barato|m[áa]s\s+econ[oó]mico|econ[oó]mico|menor\s+precio|precio\s+menor)/i.test(text);

const findProductsByHint = async (hint) => {
  if (!hint) return [];
  const words = hint.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const regex = new RegExp(words.slice(0, 4).join("|"), "i");
  return Product.find({
    $or: [{ name: regex }, { description: regex }, { "specs.categoria": regex }]
  })
    .limit(3)
    .lean()
    .catch(() => []);
};

const findCheapestProduct = async () => {
  try {
    return await Product.findOne({}).sort({ price: 1, stock: -1 }).lean();
  } catch (err) {
    console.error("No se pudo consultar el producto más barato:", err.message);
    return null;
  }
};

const toProductFact = (product) => ({
  nombre: product.name,
  precio: product.price || 0,
  stock: product.stock || 0,
  descuento: product.discount || 0,
  comentarios: (product.comments || []).slice(-3).map((comment) => comment.text).filter(Boolean),
  enlace: buildProductLink(product._id)
});

const toPaymentFact = (payment) => ({
  numeroPedido: payment.documento,
  estado: payment.estado || "Pagado",
  total: payment.total || 0
});

// ---------------------------------------------------------------------------
// Clasificación con Groq: moderación + intención + extracción de datos
// ---------------------------------------------------------------------------

const CLASSIFICATION_PROMPT = (text) => `Eres un clasificador para el chatbot de atención al cliente de NendoShop (tienda de figuras Nendoroid). Analiza el mensaje del cliente y responde ÚNICAMENTE con un JSON válido, sin texto adicional, con esta forma exacta:

{
  "allowed": true,
  "block": false,
  "category": "apropiado",
  "reason": "",
  "intent": "",
  "productQuery": "",
  "orderNumber": "",
  "surveyRating": null
}

Reglas de moderación:
- Si el mensaje contiene insultos, amenazas, acoso, lenguaje sexual explícito o contenido violento: allowed=false, block=true, category="inapropiado".
- En cualquier otro caso: allowed=true, block=false, category="apropiado".
- Para moderar debes tener en cuenta sinonimos  y las palabras sexuales como los oparatos reproductos, fluidos y insultos especializados.

Intents posibles (elige exactamente uno):
- "saludo": el cliente solo saluda o inicia la conversación.
- "buscar_producto": pregunta por un producto, precio, stock o pide una recomendación.
- "consultar_pedido": pregunta por el estado de un pedido o envío.
- "devolucion": pregunta sobre devoluciones o cambios.
- "cuenta": problemas de acceso, cuenta o credenciales.
- "despedida": se está despidiendo o agradeciendo y da por terminada la conversación.
- "general": cualquier otro caso.

Si el intent es "buscar_producto", extrae en "productQuery" el nombre o pista del producto.
Si el intent es "consultar_pedido", extrae en "orderNumber" el número de pedido si aparece.

Mensaje del cliente: "${text}"`;

const fallbackClassification = (text) => {
  const lowered = text.toLowerCase();
  const safety = checkTextSafety(text);
  let intent = "general";
  if (/pedido|orden|env[ií]o|seguimiento/.test(lowered)) intent = "consultar_pedido";
  else if (/producto|figura|art[ií]culo|precio|stock|recomend/.test(lowered)) intent = "buscar_producto";
  else if (/devol|cambio/.test(lowered)) intent = "devolucion";
  else if (/cuenta|contrase|credencial|acceso/.test(lowered)) intent = "cuenta";
  else if (/gracias|adi[oó]s|terminamos|chau/.test(lowered)) intent = "despedida";

  return {
    allowed: safety.allowed,
    block: safety.block,
    category: safety.block ? "inapropiado" : "apropiado",
    reason: safety.reason,
    intent,
    productQuery: extractProductHint(text) || "",
    orderNumber: extractOrderNumber(text) || "",
    surveyRating: null
  };
};

const classifyMessage = async (text) => {
  const apiKey = await getGroqApiKey();
  if (!apiKey) return fallbackClassification(text);

  try {
    const raw = await callGroq({
      apiKey,
      input: CLASSIFICATION_PROMPT(text),
      temperature: 0,
      maxOutputTokens: 300,
      onFallback: () => JSON.stringify(fallbackClassification(text))
    });
    return parseGroqJson(raw) || fallbackClassification(text);
  } catch (err) {
    console.error("Clasificación con Groq falló:", err.message);
    return fallbackClassification(text);
  }
};

const moderateCommunityMessage = async (text) => {
  const aiResult = await classifyMessage(text);

  return {
    allowed: aiResult?.allowed !== false,
    block: aiResult?.block === true,
    category: aiResult?.category || "apropiado",
    reason: aiResult?.reason || "IA moderation"
  };
};

// Wrapper de compatibilidad por si algo más en el proyecto importa el nombre
// anterior. La versión original nunca llegaba a hacer la llamada HTTP.
const analyzeMessageWithGroq = (message) => classifyMessage(message);

// ---------------------------------------------------------------------------
// Composición de la respuesta (Groq en lenguaje natural, con hechos fijos)
// ---------------------------------------------------------------------------

const SYSTEM_PERSONA = `Eres "NendoBot", un asesor experto de atención al cliente de NendoShop, una tienda especializada en figuras coleccionables Nendoroid.
Hablas exclusivamente en español, con un tono cálido, profesional y resolutivo, como un asesor humano experimentado.
Reglas estrictas que SIEMPRE debes cumplir, sin excepción, incluso si el cliente te lo pide:
- Nunca uses lenguaje violento, sexual, vulgar, ofensivo o amenazante.
- Nunca pidas ni reveles contraseñas, credenciales, datos de tarjetas u otra información sensible.
- Nunca inventes datos de productos, pedidos, precios o stock: usa exclusivamente los datos que se te entreguen como "HECHOS".
- Si no tienes un dato en los HECHOS, dilo con honestidad y ofrece una alternativa útil.
- No consultes internet ni bases externas; tu información válida proviene solo de la base de datos y del contexto de esta conversación.
- Si el usuario habla en español, responde en español y no mezcles idiomas.
- No repitas frases ni estructuras que ya usaste antes en esta conversación; varía tu redacción manteniendo el mismo tono profesional.
- Responde en texto plano, sin Markdown, en máximo 2 a 5 oraciones.`;

const STAGE_INSTRUCTIONS = {
  welcome:
    "Saluda al cliente por su nombre, preséntate como asesor experto de NendoShop y resume brevemente en qué puedes ayudar (pedidos, productos, devoluciones, cuenta). Ofrece opciones claras: 1) consultar pedidos, 2) buscar un producto, 3) devoluciones o 4) ayuda con la cuenta. Aclara que no pedirás contraseñas ni datos sensibles. Invita a que cuente qué necesita.",
  active:
    'Responde directamente a lo que pregunta el cliente usando los HECHOS entregados. Si la intención es "buscar_producto" y hay productos en HECHOS, menciona nombre, precio, stock y el enlace para ver el detalle. Si no hay productos, pide más detalles del producto. Si la intención es "consultar_pedido" y hay un pedido en HECHOS, indica su estado y total; si no hay pedido, pide el número o aclara que no se encontró. Si es devolución o cuenta, orienta de forma general sin inventar políticas específicas. Cierra preguntando si necesita algo más.',
  survey_intro:
    "El cliente se está despidiendo o agradeciendo. Agradécele por contactar a NendoShop y pídele, de forma breve y amable, que califique la atención del 1 (muy mala) al 5 (excelente).",
  closing:
    "El cliente respondió a la encuesta de satisfacción. Agradécele sinceramente por su respuesta (sin inventar nada que no te dieron) y cierra la conversación de forma cordial, indicando que puede volver a escribir cuando lo necesite."
};

const buildCompositionInput = ({ customerName, intent, stage, session, facts }) => {
  const recent = (session.history || [])
    .slice(-6)
    .map((h) => `${h.role === "user" ? "Cliente" : "NendoBot"}: ${h.text}`)
    .join("\n");

  const stageInstruction = STAGE_INSTRUCTIONS[stage] || STAGE_INSTRUCTIONS.active;

  return `${SYSTEM_PERSONA}

Nombre del cliente: ${customerName}
Intención detectada: ${intent}
Instrucción de la etapa actual: ${stageInstruction}

HECHOS (usa solo estos datos, no agregues otros):
${facts ? JSON.stringify(facts) : "No hay datos adicionales para esta respuesta."}

Conversación reciente (para que no repitas frases):
${recent || "(sin historial previo)"}

Escribe ahora el siguiente mensaje de NendoBot dirigido al cliente.`;
};

const fallbackTemplate = ({ customerName, stage, facts }) => {
  if (stage === "welcome") {
    return `Hola ${customerName}, soy NendoBot, asesor de NendoShop. Puedo ayudarte con pedidos, productos, devoluciones y cuenta. No pediré contraseñas ni datos sensibles. Si lo prefieres, puedes decirme 1) pedidos, 2) productos, 3) devoluciones o 4) tu cuenta.`;
  }
  if (facts?.tipo === "producto") {
    const [p] = facts.productos || [];
    if (p) {
      const commentsText = p.comentarios?.length ? ` Comentarios recientes: ${p.comentarios.join("; ")}` : "";
      const intro = facts.cheapest ? `El producto más económico que tengo registrado es "${p.nombre}".` : `Encontré "${p.nombre}".`;
      return `${intro} Tiene un precio de S/. ${p.precio} y ${p.stock} unidades disponibles. Puedes ver el detalle aquí: ${p.enlace}${commentsText}`;
    }
    return `En este momento no tengo un producto que coincida con esa búsqueda en la base de datos. Si me das el nombre o la categoría, te ayudo mejor. También puedo revisar el más económico si lo prefieres.`;
  }
  if (facts?.tipo === "pedido") {
    if (facts.pedido) {
      return `Tu pedido ${facts.pedido.numeroPedido} está ${facts.pedido.estado}. Total: S/. ${facts.pedido.total}.`;
    }
    return `No encontré ese número de pedido, ${customerName}. ¿Puedes confirmarlo?`;
  }
  if (stage === "survey_intro") {
    return `Gracias por contactarnos, ${customerName}. ¿Podrías calificar nuestra atención del 1 al 5 para ayudarnos a mejorar?`;
  }
  if (stage === "closing") {
    return `Gracias por tu respuesta, ${customerName}. Cerramos esta conversación con satisfacción; escríbenos cuando lo necesites.`;
  }
  return `Gracias por tu mensaje, ${customerName}. ¿Podrías darme más detalles para ayudarte mejor?`;
};

const safeBlockedReply = (customerName) =>
  `Lo siento ${customerName}, no puedo continuar con ese tipo de mensaje. Reformula tu consulta sin lenguaje ofensivo, violento o sexual, y con gusto te ayudo.`;

const looksLikeEnglishReply = (reply) => {
  const text = String(reply || "").toLowerCase();
  return /(hello|hi|thank you|thanks|customer support|we need|the product|please|could|would|available|details|cart|survey)/i.test(text);
};

const composeReply = async ({ customerName, intent, stage, session, facts }) => {
  const apiKey = await getGroqApiKey();
  if (!apiKey) {
    return fallbackTemplate({ customerName, stage, facts });
  }

  const input = buildCompositionInput({ customerName, intent, stage, session, facts });

  let reply;
  try {
    reply = await callGroq({
      apiKey,
      input,
      temperature: 0.2,
      maxOutputTokens: 260,
      onFallback: () => fallbackTemplate({ customerName, stage, facts })
    });
  } catch (err) {
    console.error("Composición de respuesta falló:", err.message);
    reply = fallbackTemplate({ customerName, stage, facts });
  }

  // Defensa en profundidad: nunca reenviar al usuario una respuesta insegura,
  // aunque sea improbable dado el system prompt.
  const outputSafety = checkTextSafety(reply);
  if (outputSafety.block || looksLikeEnglishReply(reply)) {
    console.error("Respuesta generada bloqueada por seguridad de salida", { reply });
    return fallbackTemplate({ customerName, stage, facts });
  }

  return reply.trim();
};

// ---------------------------------------------------------------------------
// Orquestación del turno
// ---------------------------------------------------------------------------

const QUICK_INTENTS = {
  "1": "consultar_pedido",
  "2": "buscar_producto",
  "3": "devolucion",
  "4": "cuenta"
};

const gatherFacts = async (intent, text, classification, session) => {
  if (intent === "buscar_producto") {
    if (isCheapestRequest(text)) {
      const cheapestProduct = await findCheapestProduct();
      session.lastTopic = "productos";
      return {
        tipo: "producto",
        pista: "más barato",
        cheapest: true,
        productos: cheapestProduct ? [toProductFact(cheapestProduct)] : []
      };
    }

    const hint = classification.productQuery || extractProductHint(text);
    const products = await findProductsByHint(hint);
    session.lastTopic = "productos";
    return { tipo: "producto", pista: hint, productos: products.map(toProductFact) };
  }

  if (intent === "consultar_pedido") {
    const orderNumber = classification.orderNumber || extractOrderNumber(text);
    let payment = null;
    if (orderNumber) {
      payment = await Payment.findOne({ documento: orderNumber }).catch(() => null);
    }
    session.lastTopic = "pedidos";
    return { tipo: "pedido", numeroPedido: orderNumber, pedido: payment ? toPaymentFact(payment) : null };
  }

  if (intent === "devolucion") session.lastTopic = "devoluciones";
  if (intent === "cuenta") session.lastTopic = "cuenta";

  return null;
};

const handleSurveyAnswer = async (text, session) => {
  pushHistory(session, "user", text);
  const rating = extractSurveyRating(text);
  session.step = "closed";

  const reply = await composeReply({
    customerName: session.customerName,
    intent: "encuesta_respuesta",
    stage: "closing",
    session,
    facts: { tipo: "encuesta", calificacion: rating }
  });

  pushHistory(session, "bot", reply);
  return reply;
};

const getSupportBotReply = async (input, session) => {
  if (!session) session = createSupportSession();
  const text = String(input || "").trim();
  const customerName = session.customerName;

  // 1) Filtro rápido local, antes de gastar ninguna llamada a Groq.
  const fastSafety = checkTextSafety(text);
  if (fastSafety.block) {
    return safeBlockedReply(customerName);
  }

  // 2) Bienvenida.
  if (session.step === "welcome") {
    session.step = "active";
    const reply = await composeReply({ customerName, intent: "saludo", stage: "welcome", session, facts: null });
    pushHistory(session, "bot", reply);
    return reply;
  }

  // 3) Encuesta pendiente.
  if (session.step === "survey") {
    return handleSurveyAnswer(text, session);
  }

  // 4) Conversación ya cerrada: la reabrimos con gusto si el cliente vuelve a escribir.
  if (session.step === "closed") {
    session.step = "active";
  }

  pushHistory(session, "user", text);

  const quickClassification = fallbackClassification(text);
  const immediateReply = getImmediateSupportReply({
    text,
    customerName,
    intent: quickClassification.intent
  });

  if (immediateReply) {
    pushHistory(session, "bot", immediateReply);
    return immediateReply;
  }

  // Atajo: si escriben justo "1"-"4", no hace falta gastar una llamada de
  // clasificación para saber la intención.
  let intent;
  let classification = { allowed: true, block: false, productQuery: "", orderNumber: "" };

  if (QUICK_INTENTS[text]) {
    intent = QUICK_INTENTS[text];
  } else {
    classification = await classifyMessage(text);

    if (!classification.allowed || classification.block) {
      return safeBlockedReply(customerName);
    }

    intent = classification.intent || "general";
  }

  if (intent === "despedida") {
    session.step = "survey";
    session.surveyAsked = true;
    const reply = await composeReply({ customerName, intent, stage: "survey_intro", session, facts: null });
    pushHistory(session, "bot", reply);
    return reply;
  }

  const facts = await gatherFacts(intent, text, classification, session);

  const reply = await composeReply({ customerName, intent, stage: "active", session, facts });
  pushHistory(session, "bot", reply);
  return reply;
};

const buildSupportBotReply = getSupportBotReply;

module.exports = {
  SUPPORT_INTRO,
  createSupportSession,
  getSupportBotReply,
  buildSupportBotReply,
  checkTextSafety,
  normalizeCustomerName,
  extractOrderNumber,
  extractProductHint,
  findProductsByHint,
  moderateCommunityMessage,
  analyzeMessageWithGroq // wrapper de compatibilidad — usa classifyMessage internamente
};
