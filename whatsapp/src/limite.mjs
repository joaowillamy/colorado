// Limite de perguntas por usuário.
//
// Conta, no histórico salvo no DynamoDB, quantas mensagens o PRÓPRIO usuário
// escreveu. Passou do limite: o handler responde com MSG_DEFAULT_MAX_MSGS e
// não chama o Bedrock (nenhum token gasto).
//
// Quando passa do limite, o handler grava BLOQUEADO#<telefone> (sem TTL, em
// conversa.mjs). Dali em diante o usuário recebe a mensagem fixa só com um
// GetItem por chave, sem ler o histórico.
//
// Observações sobre o que o histórico guarda:
//   - só as últimas config.maxMensagensHistorico mensagens (conversa.mjs, aparar);
//   - o TTL da conversa é 24h, mas o bloqueio é permanente e não depende dele;
//   - pergunta bloqueada pelo guardrail não entra no histórico, então não conta;
//   - mensagens "user" que carregam toolResult não são perguntas do usuário.

import { config } from "./config.mjs";
import { detectarIdioma } from "./idioma.mjs";

export const MSG_DEFAULT_MAX_MSGS =
  "Já dá para você ir ao post: {LINK_POST}\n\n" +
  "Lá tem bem mais informação: um diagrama animado do fluxo e exemplos didáticos " +
  "de cada parte, para você entender tudo de ponta a ponta.\n\n" +
  "Curte, comenta e compartilha. Combinado?";

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

export const MSG_DEFAULT_MAX_MSGS_EN =
  "You can head over to the post now: {LINK_POST}\n\n" +
  "There's a lot more there: an animated diagram of the flow and easy-to-follow examples " +
  "of each part, so you can understand everything end to end.\n\n" +
  "Like, comment and share. Deal?";

/**
 * Texto fixo com o link do post no lugar de {LINK_POST}.
 * `textoUsuario` (a mensagem que chegou) escolhe o idioma; sem texto, português.
 */
export function mensagemLimite(textoUsuario, link = config.linkPost) {
  const base = detectarIdioma(textoUsuario) === "en" ? MSG_DEFAULT_MAX_MSGS_EN : MSG_DEFAULT_MAX_MSGS;
  return base.replaceAll("{LINK_POST}", link);
}
