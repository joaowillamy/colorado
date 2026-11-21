// O webhook entrega o número do cliente sem "+" (ex.: 5588...), mas o
// SendWhatsAppMessage do End User Messaging Social só aceita o destino com "+".
// Sem ele a API devolve "Invalid destination phone number or message Id".
export function normalizarTelefone(telefone) {
  if (!telefone) return telefone;
  return telefone.startsWith("+") ? telefone : `+${telefone}`;
}
