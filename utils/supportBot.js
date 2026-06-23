const SUPPORT_INTRO = `Hola, soy NendoBot, tu asistente de soporte de NendoShop. Te puedo ayudar con pedidos, pagos, envíos, devoluciones y cuentas.`;

const createSupportSession = () => ({
  step: 'welcome',
  topic: null,
  customerName: 'cliente'
});

const buildSupportBotReply = (input, session) => {
  const text = String(input || '').trim().toLowerCase();
  if (!session) {
    return `${SUPPORT_INTRO}\n\n1) Pedidos y envíos\n2) Pagos y promociones\n3) Devoluciones y cambios\n4) Cuenta y acceso`;
  }

  if (session.step === 'welcome') {
    session.step = 'menu';
    return `${SUPPORT_INTRO}\n\n¿En qué te puedo ayudar hoy?\n\n1) Pedidos y envíos\n2) Pagos y promociones\n3) Devoluciones y cambios\n4) Cuenta y acceso`;
  }

  if (text === '1' || text.includes('pedido') || text.includes('envio') || text.includes('envío')) {
    session.step = 'order';
    session.topic = 'pedidos';
    return 'Perfecto. Te ayudo con tu pedido. Envíame tu número de pedido y te digo el estado y el siguiente paso.';
  }

  if (text === '2' || text.includes('pago') || text.includes('promoc') || text.includes('oferta')) {
    session.step = 'payment';
    session.topic = 'pagos';
    return 'Claro. Puedo revisar pagos, promociones y descuentos. Si quieres, te puedo mostrar la oferta más atractiva del momento.';
  }

  if (text === '3' || text.includes('devol') || text.includes('cambio')) {
    session.step = 'returns';
    session.topic = 'devoluciones';
    return 'Entendido. Para devoluciones o cambios, te pediré tus datos de compra y el motivo para abrir el proceso.';
  }

  if (text === '4' || text.includes('cuenta') || text.includes('acceso')) {
    session.step = 'account';
    session.topic = 'cuenta';
    return 'Voy a ayudarte con tu cuenta. Si tienes problemas con el acceso, dime si olvidaste tu contraseña o si tu sesión no abre.';
  }

  if (session.step === 'order' && (text.includes('pedido') || text.includes('estado') || text.includes('seguimiento'))) {
    return 'Gracias. Revisaré el estado del pedido y te indicaré si ya fue procesado, enviado o entregado.';
  }

  if (session.step === 'payment' && (text.includes('oferta') || text.includes('descuento'))) {
    return 'Tenemos promociones activas en productos seleccionados. Te recomiendo revisar el catálogo y aprovechar los descuentos destacados.';
  }

  if (session.step === 'account') {
    return 'Puedo ayudarte con recuperación de cuenta, cambios de email o acceso a tu perfil. Dime cuál es el problema.';
  }

  return 'Puedo ayudarte con pedidos, pagos, envíos, devoluciones y cuentas. Responde con una opción: 1, 2, 3 o 4.';
};

module.exports = {
  SUPPORT_INTRO,
  createSupportSession,
  buildSupportBotReply
};
