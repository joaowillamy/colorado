// Estado no DynamoDB (tabela única, chave "pk").
//
//   pk = CONVERSA#<telefone>   { messages, lockUntil, ttl }
//   pk = MSG#<wamid>           { ttl }            -> idempotência
//   pk = ALUNO#<email>         { nome, ingresso, status, pedido, ... }
//   pk = BLOQUEADO#<telefone>  { bloqueadoEm }    -> passou do limite, SEM ttl (permanente)
//
// O `ttl` é o atributo de Time To Live da tabela: o DynamoDB apaga sozinho.

import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo } from "./clients.mjs";
import { config } from "./config.mjs";

const agora = () => Math.floor(Date.now() / 1000);

export class ConversaOcupadaError extends Error {
  constructor(telefone) {
    super(`conversa ${telefone} em processamento por outra invocação`);
    this.name = "ConversaOcupadaError";
  }
}

// ── idempotência ──────────────────────────────────────────────────────────
export async function jaProcessada(messageId) {
  const r = await dynamo.send(
    new GetCommand({ TableName: config.tabela, Key: { pk: `MSG#${messageId}` } })
  );
  return Boolean(r.Item);
}

export async function marcarProcessada(messageId) {
  await dynamo.send(
    new PutCommand({
      TableName: config.tabela,
      Item: { pk: `MSG#${messageId}`, ttl: agora() + config.ttlMensagemSeg },
    })
  );
}

// ── bloqueio permanente (limite de perguntas) ─────────────────────────────
// Item próprio e sem ttl: sobrevive à expiração do histórico (24h). Como é um
// GetItem por chave, quem já foi bloqueado não precisa de lock nem de histórico.
export async function jaFoiBloqueado(telefone) {
  const r = await dynamo.send(
    new GetCommand({
      TableName: config.tabela,
      Key: { pk: `BLOQUEADO#${telefone}` },
      ConsistentRead: true,
    })
  );
  return Boolean(r.Item);
}

export async function bloquear(telefone) {
  await dynamo.send(
    new PutCommand({
      TableName: config.tabela,
      Item: { pk: `BLOQUEADO#${telefone}`, bloqueadoEm: new Date().toISOString() },
    })
  );
}

// ── lock por telefone ─────────────────────────────────────────────────────
// O SNS padrão não garante ordem e o SQS padrão pode entregar mensagens do
// mesmo cliente em paralelo. O lock evita duas Lambdas lendo e gravando o
// histórico do mesmo telefone ao mesmo tempo. Se falhar, o erro faz a mensagem
// voltar à fila (batchItemFailures) e ser tentada de novo.
export async function carregarComLock(telefone) {
  const t = agora();
  try {
    const r = await dynamo.send(
      new UpdateCommand({
        TableName: config.tabela,
        Key: { pk: `CONVERSA#${telefone}` },
        UpdateExpression: "SET lockUntil = :ate",
        ConditionExpression: "attribute_not_exists(lockUntil) OR lockUntil < :agora",
        ExpressionAttributeValues: { ":ate": t + config.lockSeg, ":agora": t },
        ReturnValues: "ALL_NEW",
      })
    );
    return JSON.parse(r.Attributes.messages ?? "[]");
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") throw new ConversaOcupadaError(telefone);
    throw e;
  }
}

// Grava o histórico novo e solta o lock numa operação só.
export async function salvarEliberar(telefone, messages) {
  await dynamo.send(
    new UpdateCommand({
      TableName: config.tabela,
      Key: { pk: `CONVERSA#${telefone}` },
      UpdateExpression: "SET messages = :m, lockUntil = :zero, #ttl = :ttl",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: {
        ":m": JSON.stringify(aparar(messages)),
        ":zero": 0,
        ":ttl": agora() + config.ttlConversaSeg,
      },
    })
  );
}

// Solta o lock sem alterar o histórico (usado quando algo deu errado).
export async function liberar(telefone) {
  await dynamo.send(
    new UpdateCommand({
      TableName: config.tabela,
      Key: { pk: `CONVERSA#${telefone}` },
      UpdateExpression: "SET lockUntil = :zero",
      ExpressionAttributeValues: { ":zero": 0 },
    })
  ).catch(() => {});
}

// Mantém só as últimas N mensagens (limita tokens e o limite de 400 KB do item).
// O histórico do Converse tem que começar numa mensagem "user" com texto:
// começar num toolResult sem o toolUse correspondente dá ValidationException.
function aparar(messages) {
  let corte = messages.slice(-config.maxMensagensHistorico);
  while (corte.length && !(corte[0].role === "user" && corte[0].content?.some((b) => b.text))) {
    corte = corte.slice(1);
  }
  return corte;
}

// ── alunos (era o objeto ALUNOS do v9) ────────────────────────────────────
export async function buscarAluno(email) {
  const r = await dynamo.send(
    new GetCommand({
      TableName: config.tabela,
      Key: { pk: `ALUNO#${email.trim().toLowerCase()}` },
    })
  );
  if (!r.Item) return null;
  const { pk, ttl, ...dados } = r.Item;
  return dados;
}
