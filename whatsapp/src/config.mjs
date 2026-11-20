// Toda configuração vem de variável de ambiente (definida no template.yaml).
// Nada de profile local: na Lambda o SDK usa a role de execução.

const num = (v, padrao) => (v === undefined || v === "" ? padrao : Number(v));

export const config = {
  region: process.env.AWS_REGION ?? "us-east-1",

  // Bedrock
  modelId: process.env.MODEL_ID ?? "us.anthropic.claude-sonnet-4-6",
  maxTokens: num(process.env.MAX_TOKENS, 512),
  temperature: num(process.env.TEMPERATURE, 0.7),
  maxTurnosTool: num(process.env.MAX_TURNOS_TOOL, 5),

  // Guardrail. GUARDRAIL_ID=off desliga (igual ao v9).
  guardrailId: process.env.GUARDRAIL_ID ?? "off",
  guardrailVersion: process.env.GUARDRAIL_VERSION ?? "DRAFT",

  // Knowledge Base (RAG gerenciado)
  kbId: process.env.KB_ID,
  topK: num(process.env.TOP_K, 20),
  reranking: process.env.RERANKING ?? "MANAGED",
  scoreMinimo: num(process.env.SCORE_MINIMO, 0.5),

  // DynamoDB (tabela única: conversas, mensagens processadas, alunos)
  tabela: process.env.TABELA,
  ttlConversaSeg: num(process.env.TTL_CONVERSA_SEG, 24 * 3600), // = janela de 24h do WhatsApp
  ttlMensagemSeg: num(process.env.TTL_MENSAGEM_SEG, 24 * 3600),
  maxMensagensHistorico: num(process.env.MAX_MENSAGENS_HISTORICO, 20),
  lockSeg: num(process.env.LOCK_SEG, 60),

  // WhatsApp (AWS End User Messaging Social)
  // Opcional: se vazio, o id é derivado do ARN que vem no evento.
  originationPhoneNumberId: process.env.ORIGINATION_PHONE_NUMBER_ID,
  metaApiVersion: process.env.META_API_VERSION ?? "v20.0",
};
