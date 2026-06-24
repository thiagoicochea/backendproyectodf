const nameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]{2,40}$/;
const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const phoneRegex = /^(?:\+51\s?)?9\d{8}$/;
const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const addressRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ0-9#°.,\s-]{5,80}$/;
const cityRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]{2,40}$/;
const productNameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ0-9#°.,\s-]{2,80}$/;
const productDescriptionRegex = /^.{10,300}$/;
const priceRegex = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const stockRegex = /^\d+$/;
const discountRegex = /^(?:0|[1-9]\d{0,1}|100)$/;

const validateRegistrationPayload = (payload) => {
  const errors = [];

  if (!payload?.name || !nameRegex.test(String(payload.name).trim())) {
    errors.push("Nombre inválido. Usa 2 a 40 letras y espacios.");
  }

  if (!payload?.lastname || !nameRegex.test(String(payload.lastname).trim())) {
    errors.push("Apellido inválido. Usa 2 a 40 letras y espacios.");
  }

  if (!payload?.email || !emailRegex.test(String(payload.email).trim())) {
    errors.push("Email inválido. Usa el formato nombre@dominio.com.");
  }

  if (!payload?.password || !passwordRegex.test(String(payload.password))) {
    errors.push("Contraseña inválida. Debe tener al menos 8 caracteres, una letra, un número y un símbolo.");
  }

  if (!payload?.phone || !phoneRegex.test(String(payload.phone).trim())) {
    errors.push("Teléfono inválido. Ejemplo: 987654321 o +51 987654321.");
  }

  if (!payload?.address || !addressRegex.test(String(payload.address).trim())) {
    errors.push("Dirección inválida. Usa entre 5 y 80 caracteres con letras, números y signos básicos.");
  }

  if (!payload?.city || !cityRegex.test(String(payload.city).trim())) {
    errors.push("Ciudad inválida. Usa solo letras y espacios.");
  }

  if (!payload?.birthdate) {
    errors.push("Fecha de nacimiento requerida.");
  }

  if (!payload?.sex) {
    errors.push("Género requerido.");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const validateProfilePayload = (payload) => {
  const errors = [];

  if (payload?.name !== undefined && !nameRegex.test(String(payload.name).trim())) {
    errors.push("Nombre inválido. Usa 2 a 40 letras y espacios.");
  }

  if (payload?.lastname !== undefined && !nameRegex.test(String(payload.lastname).trim())) {
    errors.push("Apellido inválido. Usa 2 a 40 letras y espacios.");
  }

  if (payload?.email !== undefined && !emailRegex.test(String(payload.email).trim())) {
    errors.push("Email inválido. Usa el formato nombre@dominio.com.");
  }

  if (payload?.phone !== undefined && !phoneRegex.test(String(payload.phone).trim())) {
    errors.push("Teléfono inválido. Ejemplo: 987654321 o +51 987654321.");
  }

  if (payload?.address !== undefined && !addressRegex.test(String(payload.address).trim())) {
    errors.push("Dirección inválida. Usa entre 5 y 80 caracteres con letras, números y signos básicos.");
  }

  if (payload?.city !== undefined && !cityRegex.test(String(payload.city).trim())) {
    errors.push("Ciudad inválida. Usa solo letras y espacios.");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const validateAdminClientField = (field, value) => {
  if (field === "email") {
    return emailRegex.test(String(value).trim()) ? null : "Email inválido. Usa el formato nombre@dominio.com.";
  }

  if (field === "phone") {
    return phoneRegex.test(String(value).trim()) ? null : "Teléfono inválido. Ejemplo: 987654321 o +51 987654321.";
  }

  if (field === "name") {
    return nameRegex.test(String(value).trim()) ? null : "Nombre inválido. Usa 2 a 40 letras y espacios.";
  }

  if (field === "city") {
    return cityRegex.test(String(value).trim()) ? null : "Ciudad inválida. Usa solo letras y espacios.";
  }

  if (field === "password") {
    return passwordRegex.test(String(value)) ? null : "Contraseña inválida. Debe tener al menos 8 caracteres, una letra, un número y un símbolo.";
  }

  return null;
};

const validateAdminProductField = (field, value) => {
  if (field === "name") {
    return productNameRegex.test(String(value).trim()) ? null : "Nombre inválido. Usa entre 2 y 80 caracteres con letras, números y signos básicos.";
  }

  if (field === "price") {
    return priceRegex.test(String(value)) ? null : "Precio inválido. Ejemplo: 129.90";
  }

  if (field === "stock") {
    return stockRegex.test(String(value)) ? null : "Stock inválido. Usa solo números enteros positivos.";
  }

  if (field === "discount") {
    return discountRegex.test(String(value)) ? null : "Descuento inválido. Usa un valor entre 0 y 100.";
  }

  if (field === "description") {
    return productDescriptionRegex.test(String(value).trim()) ? null : "Descripción inválida. Usa entre 10 y 300 caracteres.";
  }

  return null;
};

module.exports = {
  validateRegistrationPayload,
  validateProfilePayload,
  validateAdminClientField,
  validateAdminProductField
};
