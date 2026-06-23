const Payment = require("../models/Payment");
const Product = require("../models/Product");

const SUPPORT_INTRO = `Hola, soy NendoBot, tu asistente de soporte de NendoShop. Te puedo ayudar con pedidos, pagos, envíos, devoluciones y cuentas.`;

const checkTextSafety = async (text) => {
  const value = String(text || "").trim().toLowerCase();
  if (!value) {
    return { allowed: false, block: true, reason: "El mensaje está vacío." };
  }

  const blockedPatterns = [
    /\b(sex|sexual|porno|pornografia|nudez|desnudo|masturb|orgias?)\b/i,
    /\b(violencia|matar|asesinar|golpear|agredir|arma|explosivo|suicida|suicidio)\b/i,
    /\b(puta|puto|mierda|idiota|estúpido|maldito|puta)\b/i,
    /\b(terror|bomb|matarte|hacerte daño)\b/i
  ];

  const blocked = blockedPatterns.some((pattern) => pattern.test(value));
  return {
    allowed: !blocked,
    block: blocked,
    reason: blocked ? "El mensaje contiene contenido no permitido." : "Mensaje aceptado."
  };
};

const normalizeCustomerName = (value) => {
  const name = String(value || "cliente").trim();
  return name || "cliente";
};

const createSupportSession = (customerName = "cliente") => ({
  step: "welcome",
  topic: null,
  customerName: normalizeCustomerName(customerName),
  lastTopic: null,
  surveyAsked: false
});

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

const findProductsByHint = async (hint) => {
  if (!hint) return [];
  const words = hint.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const regex = new RegExp(words.slice(0, 4).join("|"), "i");
  return Product.find({
    $or: [
      { name: regex },
      { description: regex },
      { "specs.categoria": regex }
    ]
  }).limit(3).lean().catch(() => []);
};

const buildSupportBotReply = async (input, session) => {
  const text = String(input || "").trim();
  const lowered = text.toLowerCase();
  const customerName = normalizeCustomerName(session?.customerName);

  if (!session) {
    return `${SUPPORT_INTRO}\n\nHola ${customerName}, puedo ayudarte a revisar pedidos y hablar de productos. No pediré ni compartiré credenciales, contraseñas o datos sensibles.\n\n1) Pedidos y envíos\n2) Productos y recomendaciones\n3) Devoluciones y cambios\n4) Cuenta y acceso`;
  }

  if (session.step === "welcome") {
    session.step = "menu";
    return `${SUPPORT_INTRO}\n\nHola ${customerName}, ¿en qué te puedo ayudar hoy?\n\nPuedo ayudarte a:\n- Ver el estado de tus pedidos\n- Hablar sobre productos y recomendaciones\n- Orientarte sobre devoluciones y pagos\n\nNo pediré ni compartiré credenciales, contraseñas ni datos sensibles.\n\n1) Pedidos y envíos\n2) Productos y recomendaciones\n3) Devoluciones y cambios\n4) Cuenta y acceso`;
  }

  if (lowered === "1" || lowered.includes("pedido") || lowered.includes("envio") || lowered.includes("envío") || lowered.includes("seguimiento")) {
    session.step = "order";
    session.topic = "pedidos";
    session.lastTopic = "pedidos";
    return `Claro, ${customerName}. Te ayudo con tus pedidos. Envíame tu número de pedido y te digo el estado y el siguiente paso.`;
  }

  if (session.step === "survey") {
    const positiveAnswer = /\b(si|sí|s[ií]|1|ok|okay|bien|excelente|genial|perfecto)\b/i.test(lowered);
    const negativeAnswer = /\b(no|2|mal|mejorar|meh|regular)\b/i.test(lowered);
    if (positiveAnswer || negativeAnswer) {
      session.step = "closed";
      return positiveAnswer
        ? `Gracias por tu feedback, ${customerName}. Tu opinión ayuda a mejorar NendoShop y ya podemos cerrar esta conversación. Gracias por responder la encuesta de satisfacción.`
        : `Gracias por tu comentario, ${customerName}. Lo tendremos en cuenta y cerramos esta conversación. Gracias por responder la encuesta de satisfacción.`;
    }
    return `Gracias por tu ayuda, ${customerName}. ¿Te gustaría responder una breve encuesta de satisfacción? Responde 1 para sí o 2 para no.`;
  }

  if (lowered === "2" || lowered.includes("producto") || lowered.includes("figura") || lowered.includes("artículo") || lowered.includes("articulo") || lowered.includes("recomend") || lowered.includes("precio") || lowered.includes("stock")) {
    session.step = "product";
    session.topic = "productos";
    session.lastTopic = "productos";
    return `Claro, ${customerName}. Puedo hablarte sobre productos, disponibilidad y recomendaciones. Cuéntame qué figura o artículo te interesa y te digo qué tenemos disponible.`;
  }

  if (lowered === "3" || lowered.includes("devol") || lowered.includes("cambio")) {
    session.step = "returns";
    session.topic = "devoluciones";
    session.lastTopic = "devoluciones";
    return `Entendido, ${customerName}. Para devoluciones o cambios, puedo orientarte sobre el proceso. Cuéntame qué pasó con el producto y te digo el siguiente paso.`;
  }

  if (lowered === "4" || lowered.includes("cuenta") || lowered.includes("acceso") || lowered.includes("contrase") || lowered.includes("credencial")) {
    session.step = "account";
    session.topic = "cuenta";
    session.lastTopic = "cuenta";
    return `Voy a ayudarte con tu cuenta, ${customerName}. Por seguridad, no puedo pedir ni compartir contraseñas, credenciales o datos sensibles. Si tienes problema con el acceso, dime qué pasó y te orientaré sin esos datos.`;
  }

  if (session.step === "order") {
    const orderNumber = extractOrderNumber(text);
    if (orderNumber) {
      const payment = await Payment.findOne({ documento: orderNumber }).catch(() => null);
      if (payment) {
        session.step = "order-confirmed";
        return `Gracias, ${customerName}. He revisado el pedido ${orderNumber}: está ${payment.estado || "Pagado"} y el total es S/. ${payment.total || 0}. Si quieres, también puedo explicarte el seguimiento o ayudarte con cambios y devoluciones.`;
      }
      session.step = "order-confirmed";
      return `Gracias, ${customerName}. No encontré ese pedido en la base de datos, pero puedo ayudarte a revisar el proceso de envío o a verificar el número que me compartiste.`;
    }
    return `Perfecto, ${customerName}. Envíame el número de pedido para revisar su estado o escríbeme “seguimiento” si quieres un resumen del proceso.`;
  }

  if (session.step === "product") {
    const productHint = extractProductHint(text);
    if (productHint) {
      const products = await findProductsByHint(productHint);
      if (products.length) {
        const [product] = products;
        session.step = "product-confirmed";
        return `Claro, ${customerName}. Encontré ${product.name} por un precio de S/. ${product.price || 0}. Actualmente hay ${product.stock || 0} unidades disponibles. Puedo comentarte más sobre el producto o ayudarte a elegir una alternativa.`;
      }
      return `No encontré un producto con ese nombre, ${customerName}. Compárteme el nombre exacto o una pista y te ayudo a revisar nuestras opciones.`;
    }
    return `Puedo ayudarte a revisar productos, ${customerName}. Dime el nombre o una referencia del artículo que te interesa.`;
  }

  if (session.step === "account") {
    return `Puedo ayudarte con recuperación de cuenta, cambios de email o acceso a tu perfil, ${customerName}. No pediré ni compartiré credenciales ni contraseñas.`;
  }

  if (session.lastTopic === "pedidos" && (lowered.includes("seguimiento") || lowered.includes("estado"))) {
    return `Claro, ${customerName}. El seguimiento suele indicar si el pedido está en preparación, enviado o listo para entrega. Si me compartes el número, te digo más.`;
  }

  if (session.lastTopic === "productos" && (lowered.includes("producto") || lowered.includes("figura") || lowered.includes("recom") || lowered.includes("precio"))) {
    return `Puedo revisarlo contigo, ${customerName}. Dime el nombre del producto o una palabra clave y te digo si está disponible y cuál es su precio aproximado.`;
  }

  if (lowered.includes("gracias") || lowered.includes("adios") || lowered.includes("adiós") || lowered.includes("terminamos")) {
    session.step = "survey";
    session.topic = null;
    session.surveyAsked = true;
    return `Gracias por contactarnos, ${customerName}. Ha sido un gusto ayudarte. Antes de cerrar, ¿te gustaría responder una breve encuesta de satisfacción? Responde 1 para sí o 2 para no. Si prefieres, también puedes decir adiós.`;
  }

  return `Puedo ayudarte con pedidos, pagos, envíos, devoluciones y cuentas, ${customerName}. Si quieres, responde con una opción: 1, 2, 3 o 4.`;
};

module.exports = {
  SUPPORT_INTRO,
  createSupportSession,
  buildSupportBotReply,
  checkTextSafety
};
