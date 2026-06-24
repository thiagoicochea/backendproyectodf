const nameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]{2,40}$/;
const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const phoneRegex = /^(?:\+51\s?)?9\d{8}$/;
const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const addressRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ0-9#°.,\s-]{5,80}$/;
const cityRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]{2,40}$/;

const validateRegistrationPayload = (payload) => {
  const errors = [];

  if (!payload?.name || !nameRegex.test(String(payload.name).trim())) {
    errors.push("Nombre inválido");
  }

  if (!payload?.lastname || !nameRegex.test(String(payload.lastname).trim())) {
    errors.push("Apellido inválido");
  }

  if (!payload?.email || !emailRegex.test(String(payload.email).trim())) {
    errors.push("Email inválido");
  }

  if (!payload?.password || !passwordRegex.test(String(payload.password))) {
    errors.push("Contraseña inválida");
  }

  if (!payload?.phone || !phoneRegex.test(String(payload.phone).trim())) {
    errors.push("Teléfono inválido");
  }

  if (!payload?.address || !addressRegex.test(String(payload.address).trim())) {
    errors.push("Dirección inválida");
  }

  if (!payload?.city || !cityRegex.test(String(payload.city).trim())) {
    errors.push("Ciudad inválida");
  }

  if (!payload?.birthdate) {
    errors.push("Fecha de nacimiento requerida");
  }

  if (!payload?.sex) {
    errors.push("Género requerido");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const validateProfilePayload = (payload) => {
  const errors = [];

  if (payload?.name !== undefined && !nameRegex.test(String(payload.name).trim())) {
    errors.push("Nombre inválido");
  }

  if (payload?.lastname !== undefined && !nameRegex.test(String(payload.lastname).trim())) {
    errors.push("Apellido inválido");
  }

  if (payload?.phone !== undefined && !phoneRegex.test(String(payload.phone).trim())) {
    errors.push("Teléfono inválido");
  }

  if (payload?.address !== undefined && !addressRegex.test(String(payload.address).trim())) {
    errors.push("Dirección inválida");
  }

  if (payload?.city !== undefined && !cityRegex.test(String(payload.city).trim())) {
    errors.push("Ciudad inválida");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  validateRegistrationPayload,
  validateProfilePayload
};
