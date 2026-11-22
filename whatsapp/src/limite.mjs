// Limite de perguntas por usuário.
//
// Conta, no histórico salvo no DynamoDB, quantas mensagens o PRÓPRIO usuário
// escreveu. Passou do limite: o handler responde com MSG_DEFAULT_MAX_MSGS e
// não chama o Bedrock (nenhum token gasto).
//
// Observações sobre o que o histórico guarda:
//   - só as últimas config.maxMensagensHistorico mensagens (conversa.mjs, aparar);
//   - o TTL da conversa é 24h: depois disso o histórico some e o contador zera;
//   - pergunta bloqueada pelo guardrail não entra no histórico, então não conta;
//   - mensagens "user" que carregam toolResult não são perguntas do usuário.

import { config } from "./config.mjs";

export const MSG_DEFAULT_MAX_MSGS =
  "Já dá para você ir ao post: {LINK_POST} Curte, comenta e compartilha. Combinado?";

/** Quantas mensagens de texto o usuário já fez, segundo o histórico (formato Converse). */
export function contarPerguntas(messages) {
  return messages.filter(
    (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => typeof b.text === "string")
  ).length;
}

/** true quando a pergunta que acabou de chegar passa do limite. */
export function passouDoLimite(messages, max = config.maxPerguntas) {
  return contarPerguntas(messages) >= max;
}

/** Texto fixo com o link do post no lugar de {LINK_POST}. */
export function mensagemLimite(link = config.linkPost) {
  return MSG_DEFAULT_MAX_MSGS.replaceAll("{LINK_POST}", link);
}
