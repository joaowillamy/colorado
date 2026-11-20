// O miolo do v9, sem terminal: recebe a pergunta e o histórico, devolve a resposta.
//
//   pergunta ─► RAG ─► Converse (+ tools em loop) ─► resposta
//                         │
//                         └─ guardrail pode interromper (stopReason guardrail_intervened)

import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bedrock } from "./clients.mjs";
import { config } from "./config.mjs";
import { buscar, montarMensagem } from "./rag.mjs";
import { EXECUTORES, toolConfig } from "./tools.mjs";
import { guardrailConfig, achadosDoGuardrail } from "./guardrail.mjs";
import { log } from "./log.mjs";

// Lido uma vez por cold start (fica no escopo do módulo).
const dir = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(dir, "..", "prompt.txt"), "utf-8");

const textoDe = (message) =>
  (message?.content ?? [])
    .filter((b) => b.text)
    .map((b) => b.text)
    .join("");

/**
 * @param {{ texto: string, nome?: string, messages: object[] }} entrada
 * @returns {Promise<{ resposta: string, messages: object[], bloqueado: boolean, usage: object }>}
 *   `messages` é o histórico novo. Se o guardrail bloquear, volta o histórico
 *   SEM a pergunta (senão ela seria reenviada e rebloqueada a cada turno).
 */
export async function atender({ texto, nome, messages }) {
  const { trechos, total } = await buscar(texto);
  log("rag", { encontrados: total, usados: trechos.length });

  const historico = [...messages];
  const idxPergunta = historico.length;
  historico.push({ role: "user", content: [{ text: texto }] });

  // O histórico guarda só a pergunta crua; o contexto do RAG entra apenas
  // na requisição (igual ao v9), para não inflar os turnos seguintes.
  const mensagemAumentada = montarMensagem(texto, trechos);
  const comContexto = (h) =>
    h.map((m, i) => (i === idxPergunta ? { role: "user", content: [{ text: mensagemAumentada }] } : m));

  // O bloco depois do cachePoint não entra no cache: o prompt grande é
  // compartilhado entre TODOS os clientes, e o nome muda por cliente.
  const system = [
    { text: systemPrompt },
    { cachePoint: { type: "default", ttl: "1h" } },
    ...(nome ? [{ text: `Nome do cliente no WhatsApp: ${nome}` }] : []),
  ];

  for (let turno = 0; turno < config.maxTurnosTool; turno++) {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: config.modelId,
        system,
        messages: comContexto(historico),
        toolConfig,
        inferenceConfig: { maxTokens: config.maxTokens, temperature: config.temperature },
        guardrailConfig,
      })
    );

    const usage = response.usage ?? {};
    const achados = achadosDoGuardrail(response.trace);
    if (achados.length) log("guardrail", { achados });

    if (response.stopReason === "guardrail_intervened") {
      const naEntrada = (usage.inputTokens ?? 0) === 0;
      log("guardrail_bloqueou", { lado: naEntrada ? "entrada" : "saida", usage });
      return {
        resposta: textoDe(response.output?.message),
        messages, // sem a pergunta bloqueada
        bloqueado: true,
        usage,
      };
    }

    const assistantMessage = response.output.message;
    historico.push(assistantMessage);

    if (response.stopReason !== "tool_use") {
      log("uso_tokens", {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadInputTokens,
        cacheWrite: usage.cacheWriteInputTokens,
      });
      return { resposta: textoDe(assistantMessage), messages: historico, bloqueado: false, usage };
    }

    const toolResults = [];
    for (const bloco of assistantMessage.content) {
      if (!bloco.toolUse) continue;
      const { toolUseId, name, input } = bloco.toolUse;

      const executor = EXECUTORES[name];
      const resultado = executor ? await executor(input) : { erro: `tool desconhecida: ${name}` };
      // Não logamos o input: contém e-mail do cliente.
      log("tool", { name, ok: Boolean(executor) });

      toolResults.push({
        toolResult: {
          toolUseId,
          content: [{ json: resultado }],
          status: executor ? "success" : "error",
        },
      });
    }
    historico.push({ role: "user", content: toolResults });
  }

  // Estourou o limite de chamadas de tool. Não grava este turno quebrado.
  log("limite_tools", { max: config.maxTurnosTool });
  return {
    resposta: "Tive um problema para concluir isso agora. Vou pedir para alguém do time falar com você.",
    messages,
    bloqueado: false,
    usage: {},
  };
}
