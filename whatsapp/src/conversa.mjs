// Estado no DynamoDB (tabela única, chave "pk").
//
//   pk = CONVERSA#<telefone>   { messages, lockUntil, ttl }
//   pk = MSG#<wamid>           { ttl }            -> idempotência
//   pk = ALUNO#<email>         { nome, ingresso, status, pedido, ... }
//   pk = BLOQUEADO#<telefone>  { motivo, bloqueadoEm, ultimoAvisoEm } -> SEM ttl (permanente)
//                              motivo "limite": passou do limite de perguntas (aviso 1x/dia)
//                              motivo "abuso":  estourou o rate limit várias vezes (silêncio)
//   pk = RATE#<telefone>#<min> { n, ttl }         -> mensagens naquele minuto
//   pk = ABUSO#<telefone>      { n, ttl }         -> minutos em que estourou o rate limit
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

// ── bloqueio permanente ───────────────────────────────────────────────────
// Item próprio e sem ttl: sobrevive à expiração do histórico (24h). Como é um
// GetItem por chave, quem já foi bloqueado não precisa de lock nem de histórico.
export async function buscarBloqueio(telefone) {
  const r = await dynamo.send(
    new GetCommand({
      TableName: config.tabela,
      Key: { pk: `BLOQUEADO#${telefone}` },
      ConsistentRead: true,
    })
  );
  return r.Item ?? null;
}

// motivo: "limite" ou "abuso". "abuso" sobrescreve "limite"; o contrário não.
export async function bloquear(telefone, motivo) {
  await dynamo
    .send(
      new PutCommand({
        TableName: config.tabela,
        Item: { pk: `BLOQUEADO#${telefone}`, motivo, bloqueadoEm: new Date().toISOString() },
        ...(motivo === "abuso"
          ? {}
          : {
              ConditionExpression: "attribute_not_exists(pk) OR attribute_not_exists(motivo) OR motivo <> :abuso",
              ExpressionAttributeValues: { ":abuso": "abuso" },
            }),
      })
    )
    .catch((e) => {
      if (e.name !== "ConditionalCheckFailedException") throw e;
    });
}

// Reserva o aviso do dia: true só se o último aviso foi há mais de
// config.avisoBloqueioSeg (ou nunca). Escrita condicional, então duas Lambdas
// em paralelo não mandam o aviso duas vezes. Bloqueio por abuso nunca recebe aviso.
export async function reservarAvisoDiario(telefone) {
  const t = agora();
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: config.tabela,
        Key: { pk: `BLOQUEADO#${telefone}` },
        UpdateExpression: "SET ultimoAvisoEm = :agora",
        ConditionExpression:
          // Item sem motivo (bloqueio antigo) conta como "limite".
          "attribute_exists(pk) AND (attribute_not_exists(motivo) OR motivo <> :abuso) AND " +
          "(attribute_not_exists(ultimoAvisoEm) OR ultimoAvisoEm < :limite)",
        ExpressionAttributeValues: { ":agora": t, ":limite": t - config.avisoBloqueioSeg, ":abuso": "abuso" },
      })
    );
    return true;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
}

// Desfaz a reserva quando o envio falhou, para o retry poder avisar.
export async function cancelarAviso(telefone) {
  await dynamo
    .send(
      new UpdateCommand({
        TableName: config.tabela,
        Key: { pk: `BLOQUEADO#${telefone}` },
        UpdateExpression: "REMOVE ultimoAvisoEm",
      })
    )
    .catch(() => {});
}

// ── rate limit por telefone ───────────────────────────────────────────────
// Contador atômico por minuto. Devolve quantas mensagens o telefone mandou no
// minuto atual, contando esta.
export async function contarMensagemNoMinuto(telefone) {
  const t = agora();
  const minuto = Math.floor(t / 60);
  const r = await dynamo.send(
    new UpdateCommand({
      TableName: config.tabela,
      Key: { pk: `RATE#${telefone}#${minuto}` },
      UpdateExpression: "ADD n :um SET #ttl = :ttl",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: { ":um": 1, ":ttl": (minuto + 2) * 60 },
      ReturnValues: "UPDATED_NEW",
    })
  );
  return r.Attributes.n;
}

// Conta um minuto em que o telefone estourou o rate limit. A janela começa no
// primeiro estouro e dura config.abusoJanelaSeg. Devolve o total na janela.
export async function registrarEstouro(telefone) {
  const r = await dynamo.send(
    new UpdateCommand({
      TableName: config.tabela,
      Key: { pk: `ABUSO#${telefone}` },
      UpdateExpression: "ADD n :um SET #ttl = if_not_exists(#ttl, :ttl)",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: { ":um": 1, ":ttl": agora() + config.abusoJanelaSeg },
      ReturnValues: "UPDATED_NEW",
    })
  );
  return r.Attributes.n;
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
