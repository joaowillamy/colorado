// Ponto de entrada da Lambda.
//
//   WhatsApp ─► End User Messaging Social ─► SNS ─► SQS ─► ESTA LAMBDA
//
// Para cada mensagem do cliente:
//   1. ignora se já processou (idempotência)
//   1b. rate limit por telefone e bloqueio permanente (sem lock, sem Bedrock)
//   2. pega o lock da conversa e carrega o histórico (DynamoDB)
//   3. chama o atendente (RAG + Bedrock + tools + guardrail)
//   4. responde no WhatsApp
//   5. grava o histórico e solta o lock
//
// Retorna batchItemFailures: só as mensagens que falharam voltam para a fila
// (e depois de maxReceiveCount vão para a DLQ). Requer
// FunctionResponseTypes: [ReportBatchItemFailures] no event source mapping.

import { extrairMensagens } from "./parseEvent.mjs";
import {
  bloquear,
  buscarBloqueio,
  cancelarAviso,
  carregarComLock,
  contarMensagemNoMinuto,
  jaProcessada,
  liberar,
  marcarProcessada,
  registrarEstouro,
  reservarAvisoDiario,
  salvarEliberar,
  ConversaOcupadaError,
} from "./conversa.mjs";
import { atender } from "./atendente.mjs";
import { contarPerguntas, mensagemLimite, passouDoLimite } from "./limite.mjs";
import { enviarTexto, marcarComoLida } from "./whatsapp.mjs";
import { config } from "./config.mjs";
import { log } from "./log.mjs";

const RESPOSTA_NAO_TEXTO = "Por enquanto eu só entendo mensagens de texto. Pode escrever sua dúvida?";

// Mensagem fixa do limite, no máximo 1x por dia por telefone (reservarAvisoDiario).
// Sem RAG, sem Bedrock, sem histórico. Se o envio falhar, desfaz a reserva para
// o retry conseguir avisar.
async function avisarBloqueado(msg) {
  if (await reservarAvisoDiario(msg.telefone)) {
    try {
      await enviarTexto(msg.phoneNumberId, msg.telefone, mensagemLimite(msg.texto));
    } catch (e) {
      await cancelarAviso(msg.telefone);
      throw e;
    }
    log("bloqueado_avisado");
  } else {
    log("bloqueado_silencio");
  }
  await marcarProcessada(msg.messageId);
}

// true = descartar a mensagem. Acima de config.rateMaxPorMinuto no minuto,
// descarta sem responder. No primeiro estouro de cada minuto conta um "estouro";
// config.abusoMaxEstouros estouros na janela viram bloqueio permanente por abuso.
async function estourouRate(telefone) {
  const n = await contarMensagemNoMinuto(telefone);
  if (n <= config.rateMaxPorMinuto) return false;

  if (n === config.rateMaxPorMinuto + 1) {
    const estouros = await registrarEstouro(telefone);
    log("rate_limit", { estouros });
    if (estouros >= config.abusoMaxEstouros) {
      await bloquear(telefone, "abuso");
      log("bloqueado_abuso");
    }
  }
  return true;
}

async function processar(msg) {
  if (await jaProcessada(msg.messageId)) {
    log("duplicada_ignorada");
    return;
  }

  // Rate limit antes de tudo: rajada de um mesmo número custa só 1 UpdateItem
  // por mensagem. Nada é enviado (nem o "lida"), então não gera mensagem paga.
  if (await estourouRate(msg.telefone)) return;

  // Já bloqueado: um GetItem por chave resolve, sem lock e sem ler o histórico.
  const bloqueio = await buscarBloqueio(msg.telefone);
  if (bloqueio) {
    if (bloqueio.motivo === "abuso") {
      log("bloqueado_abuso_ignorado");
      return;
    }
    await avisarBloqueado(msg);
    return;
  }

  await marcarComoLida(msg.phoneNumberId, msg.messageId);

  // Áudio, imagem etc.: resposta fixa, sem chamar o modelo (não gasta token).
  if (msg.tipo !== "text" || !msg.texto?.trim()) {
    await enviarTexto(msg.phoneNumberId, msg.telefone, RESPOSTA_NAO_TEXTO);
    await marcarProcessada(msg.messageId);
    return;
  }

  const historico = await carregarComLock(msg.telefone);
  try {
    // Passou do limite agora: bloqueia para sempre e manda o aviso do dia.
    if (passouDoLimite(historico)) {
      log("limite_perguntas", { perguntas: contarPerguntas(historico) });
      await bloquear(msg.telefone, "limite");
      await liberar(msg.telefone);
      await avisarBloqueado(msg);
      return;
    }

    const { resposta, messages } = await atender({
      texto: msg.texto,
      nome: msg.nome,
      messages: historico,
    });

    await enviarTexto(msg.phoneNumberId, msg.telefone, resposta);
    await salvarEliberar(msg.telefone, messages);
    await marcarProcessada(msg.messageId);
  } catch (e) {
    await liberar(msg.telefone);
    throw e;
  }
}

export const handler = async (event) => {
  const falhas = new Set();

  // Achata todos os records e ordena por timestamp: o SNS padrão não garante
  // ordem. Mensagens do mesmo cliente no mesmo lote saem na ordem certa.
  const mensagens = [];
  for (const record of event.Records) {
    try {
      mensagens.push(...extrairMensagens(record));
    } catch (e) {
      log("evento_invalido", { erro: e.message });
      // Payload ilegível não melhora com retry: descarta (não entra em falhas).
    }
  }
  mensagens.sort((a, b) => a.timestamp - b.timestamp);

  const telefonesComFalha = new Set();

  for (const msg of mensagens) {
    // Se uma mensagem do cliente falhou, as seguintes dele ficam para o retry,
    // para não responder fora de ordem.
    if (telefonesComFalha.has(msg.telefone)) {
      falhas.add(msg.sqsMessageId);
      continue;
    }

    try {
      await processar(msg);
    } catch (e) {
      log(e instanceof ConversaOcupadaError ? "conversa_ocupada" : "erro", {
        erro: e.name,
        mensagem: e.message,
      });
      falhas.add(msg.sqsMessageId);
      telefonesComFalha.add(msg.telefone);
    }
  }

  return { batchItemFailures: [...falhas].map((itemIdentifier) => ({ itemIdentifier })) };
};
