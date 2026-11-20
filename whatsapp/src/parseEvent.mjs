// Desembrulha: SQS record -> envelope SNS -> evento do End User Messaging Social
// -> whatsAppWebhookEntry (string JSON) -> mensagens de texto do cliente.
//
// Um mesmo tópico SNS recebe mensagens do cliente E eventos de status
// (sent, delivered, read). Só as mensagens interessam aqui.

export function extrairMensagens(sqsRecord) {
  const envelope = JSON.parse(sqsRecord.body);
  // Com RawMessageDelivery=false o corpo é o envelope do SNS (campo Message).
  // Com RawMessageDelivery=true o corpo já é o evento.
  const evento = typeof envelope.Message === "string" ? JSON.parse(envelope.Message) : envelope;

  const entry =
    typeof evento.whatsAppWebhookEntry === "string"
      ? JSON.parse(evento.whatsAppWebhookEntry)
      : evento.whatsAppWebhookEntry;
  if (!entry) return [];

  const phoneArn = evento.context?.MetaPhoneNumberIds?.[0]?.arn;
  // arn:aws:social-messaging:REGION:ACCOUNT:phone-number-id/ABC -> phone-number-id-ABC
  const phoneNumberId = phoneArn ? phoneArn.split(":").pop().replace("/", "-") : undefined;

  const saida = [];
  for (const change of entry.changes ?? []) {
    const value = change.value ?? {};
    const nomes = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));

    for (const m of value.messages ?? []) {
      saida.push({
        sqsMessageId: sqsRecord.messageId, // usado no batchItemFailures
        messageId: m.id, // wamid..., chave de idempotência
        telefone: m.from,
        nome: nomes.get(m.from),
        tipo: m.type,
        texto: m.type === "text" ? m.text?.body : undefined,
        timestamp: Number(m.timestamp), // segundos; o SNS não garante ordem
        phoneNumberId,
      });
    }
  }
  return saida;
}
