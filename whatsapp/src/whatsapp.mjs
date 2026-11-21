// Envio de mensagens pelo AWS End User Messaging Social.
// O campo `message` é o JSON da Cloud API da Meta, em bytes.

import { SendWhatsAppMessageCommand } from "@aws-sdk/client-socialmessaging";
import { social } from "./clients.mjs";
import { config } from "./config.mjs";
import { normalizarTelefone } from "./telefone.mjs";

const enviar = (phoneNumberId, payload) =>
  social.send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: config.originationPhoneNumberId ?? phoneNumberId,
      metaApiVersion: config.metaApiVersion,
      message: new TextEncoder().encode(JSON.stringify({ messaging_product: "whatsapp", ...payload })),
    })
  );

export const enviarTexto = (phoneNumberId, telefone, texto) =>
  enviar(phoneNumberId, {
    recipient_type: "individual",
    to: normalizarTelefone(telefone),
    type: "text",
    text: { body: texto },
  });

// Dois tracinhos azuis. Não é essencial, então erro aqui não derruba o fluxo.
export const marcarComoLida = (phoneNumberId, messageId) =>
  enviar(phoneNumberId, { status: "read", message_id: messageId }).catch(() => {});
