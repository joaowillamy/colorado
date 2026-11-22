// RAG: Retrieve no Knowledge Base com S3 Vectors (busca vetorial) + filtro por score (igual ao v7).

import { RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { bedrockKb } from "./clients.mjs";
import { config } from "./config.mjs";

export async function buscar(pergunta) {
  const r = await bedrockKb.send(
    new RetrieveCommand({
      knowledgeBaseId: config.kbId,
      retrievalQuery: { text: pergunta },
      // KB com S3 Vectors usa vectorSearchConfiguration. (managedSearchConfiguration
      // é só para KB gerenciado, que não existe em us-east-2.) Não há reranker aqui.
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: config.topK },
      },
    })
  );

  const todos = (r.retrievalResults ?? []).map((x) => ({
    // Só o caminho dentro do bucket. O nome do bucket tem o ID da conta (12 dígitos),
    // que o guardrail detecta como CREDIT_DEBIT_CARD_NUMBER e bloqueia a mensagem.
    fonte: x.location?.s3Location?.uri?.replace(/^s3:\/\/[^/]+\//, "") ?? "?",
    score: x.score ?? 0,
    texto: x.content?.text ?? "",
  }));

  const trechos = todos.filter((t) => t.score >= config.scoreMinimo);
  return { trechos, total: todos.length };
}

export function montarMensagem(pergunta, trechos) {
  if (trechos.length === 0) {
    return (
      `<contexto>\nNenhum trecho relevante encontrado na base.\n</contexto>\n\n` +
      `Pergunta do cliente: ${pergunta}`
    );
  }

  const contexto = trechos.map((t, i) => `[${i + 1}] fonte: ${t.fonte}\n${t.texto}`).join("\n\n");

  return (
    `<contexto>\n${contexto}\n</contexto>\n\n` +
    `Responda a pergunta do cliente usando SOMENTE o contexto acima. ` +
    `Se a resposta não estiver lá, diga que não encontrou e ofereça o suporte.\n\n` +
    `Pergunta do cliente: ${pergunta}`
  );
}
