// Disjuntor: para o consumo da fila quando o alarme de ataque dispara.
//
//   Alarme (mensagens/minuto na fila) ─► SNS TopicoDisjuntor ─► ESTA LAMBDA
//
// Desliga o event source mapping SQS -> Lambda do atendente. As mensagens
// ficam paradas na fila (sem custo de Bedrock) até alguém religar com
// infra/religar-consumo.sh, que também pode descartar o que acumulou.
// Não religa sozinho: a decisão de voltar é humana.

import { LambdaClient, ListEventSourceMappingsCommand, UpdateEventSourceMappingCommand } from "@aws-sdk/client-lambda";
import { log } from "./log.mjs";

const lambda = new LambdaClient({ region: process.env.AWS_REGION });

/** true se algum record do SNS é o alarme entrando em ALARM. */
export function alarmeDisparou(event) {
  return (event.Records ?? []).some((r) => {
    try {
      return JSON.parse(r.Sns?.Message ?? "{}").NewStateValue === "ALARM";
    } catch {
      return false;
    }
  });
}

export const handler = async (event) => {
  if (!alarmeDisparou(event)) {
    log("disjuntor_ignorado");
    return;
  }

  const { EventSourceMappings = [] } = await lambda.send(
    new ListEventSourceMappingsCommand({ FunctionName: process.env.FUNCAO_ALVO })
  );

  for (const m of EventSourceMappings) {
    if (m.State === "Disabled" || m.State === "Disabling") continue;
    await lambda.send(new UpdateEventSourceMappingCommand({ UUID: m.UUID, Enabled: false }));
    log("disjuntor_desligou", { uuid: m.UUID, fila: m.EventSourceArn });
  }
};
