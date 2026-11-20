// Log estruturado em JSON: o CloudWatch Logs Insights consegue filtrar por campo.
// Nunca passe telefone, e-mail ou texto do cliente aqui.
export const log = (evento, dados = {}) =>
  console.log(JSON.stringify({ evento, ...dados }));
