const SRC = {"atendente.mjs": "// O miolo do v9, sem terminal: recebe a pergunta e o hist\u00f3rico, devolve a resposta.\n//\n//   pergunta \u2500\u25ba RAG \u2500\u25ba Converse (+ tools em loop) \u2500\u25ba resposta\n//                         \u2502\n//                         \u2514\u2500 guardrail pode interromper (stopReason guardrail_intervened)\n\nimport { ConverseCommand } from \"@aws-sdk/client-bedrock-runtime\";\nimport { readFileSync } from \"node:fs\";\nimport { dirname, join } from \"node:path\";\nimport { fileURLToPath } from \"node:url\";\nimport { bedrock } from \"./clients.mjs\";\nimport { config } from \"./config.mjs\";\nimport { buscar, montarMensagem } from \"./rag.mjs\";\nimport { EXECUTORES, toolConfig } from \"./tools.mjs\";\nimport { guardrailConfig, achadosDoGuardrail } from \"./guardrail.mjs\";\nimport { log } from \"./log.mjs\";\n\n// Lido uma vez por cold start (fica no escopo do m\u00f3dulo).\nconst dir = dirname(fileURLToPath(import.meta.url));\nconst systemPrompt = readFileSync(join(dir, \"..\", \"prompt.txt\"), \"utf-8\");\n\nconst textoDe = (message) =>\n  (message?.content ?? [])\n    .filter((b) => b.text)\n    .map((b) => b.text)\n    .join(\"\");\n\n/**\n * @param {{ texto: string, nome?: string, messages: object[] }} entrada\n * @returns {Promise<{ resposta: string, messages: object[], bloqueado: boolean, usage: object }>}\n *   `messages` \u00e9 o hist\u00f3rico novo. Se o guardrail bloquear, volta o hist\u00f3rico\n *   SEM a pergunta (sen\u00e3o ela seria reenviada e rebloqueada a cada turno).\n */\nexport async function atender({ texto, nome, messages }) {\n  const { trechos, total } = await buscar(texto);\n  log(\"rag\", { encontrados: total, usados: trechos.length });\n\n  const historico = [...messages];\n  const idxPergunta = historico.length;\n  historico.push({ role: \"user\", content: [{ text: texto }] });\n\n  // O hist\u00f3rico guarda s\u00f3 a pergunta crua; o contexto do RAG entra apenas\n  // na requisi\u00e7\u00e3o (igual ao v9), para n\u00e3o inflar os turnos seguintes.\n  const mensagemAumentada = montarMensagem(texto, trechos);\n  const comContexto = (h) =>\n    h.map((m, i) => (i === idxPergunta ? { role: \"user\", content: [{ text: mensagemAumentada }] } : m));\n\n  // O bloco depois do cachePoint n\u00e3o entra no cache: o prompt grande \u00e9\n  // compartilhado entre TODOS os clientes, e o nome muda por cliente.\n  const system = [\n    { text: systemPrompt },\n    { cachePoint: { type: \"default\", ttl: \"1h\" } },\n    ...(nome ? [{ text: `Nome do cliente no WhatsApp: ${nome}` }] : []),\n  ];\n\n  for (let turno = 0; turno < config.maxTurnosTool; turno++) {\n    const response = await bedrock.send(\n      new ConverseCommand({\n        modelId: config.modelId,\n        system,\n        messages: comContexto(historico),\n        toolConfig,\n        inferenceConfig: { maxTokens: config.maxTokens, temperature: config.temperature },\n        guardrailConfig,\n      })\n    );\n\n    const usage = response.usage ?? {};\n    const achados = achadosDoGuardrail(response.trace);\n    if (achados.length) log(\"guardrail\", { achados });\n\n    if (response.stopReason === \"guardrail_intervened\") {\n      const naEntrada = (usage.inputTokens ?? 0) === 0;\n      log(\"guardrail_bloqueou\", { lado: naEntrada ? \"entrada\" : \"saida\", usage });\n      return {\n        resposta: textoDe(response.output?.message),\n        messages, // sem a pergunta bloqueada\n        bloqueado: true,\n        usage,\n      };\n    }\n\n    const assistantMessage = response.output.message;\n    historico.push(assistantMessage);\n\n    if (response.stopReason !== \"tool_use\") {\n      log(\"uso_tokens\", {\n        input: usage.inputTokens,\n        output: usage.outputTokens,\n        cacheRead: usage.cacheReadInputTokens,\n        cacheWrite: usage.cacheWriteInputTokens,\n      });\n      return { resposta: textoDe(assistantMessage), messages: historico, bloqueado: false, usage };\n    }\n\n    const toolResults = [];\n    for (const bloco of assistantMessage.content) {\n      if (!bloco.toolUse) continue;\n      const { toolUseId, name, input } = bloco.toolUse;\n\n      const executor = EXECUTORES[name];\n      const resultado = executor ? await executor(input) : { erro: `tool desconhecida: ${name}` };\n      // N\u00e3o logamos o input: cont\u00e9m e-mail do cliente.\n      log(\"tool\", { name, ok: Boolean(executor) });\n\n      toolResults.push({\n        toolResult: {\n          toolUseId,\n          content: [{ json: resultado }],\n          status: executor ? \"success\" : \"error\",\n        },\n      });\n    }\n    historico.push({ role: \"user\", content: toolResults });\n  }\n\n  // Estourou o limite de chamadas de tool. N\u00e3o grava este turno quebrado.\n  log(\"limite_tools\", { max: config.maxTurnosTool });\n  return {\n    resposta: \"Tive um problema para concluir isso agora. Vou pedir para algu\u00e9m do time falar com voc\u00ea.\",\n    messages,\n    bloqueado: false,\n    usage: {},\n  };\n}\n", "clients.mjs": "// Clients criados FORA do handler: a Lambda reaproveita entre invoca\u00e7\u00f5es\n// (conex\u00f5es HTTP abertas, menos cold start).\n\nimport { BedrockRuntimeClient } from \"@aws-sdk/client-bedrock-runtime\";\nimport { BedrockAgentRuntimeClient } from \"@aws-sdk/client-bedrock-agent-runtime\";\nimport { DynamoDBClient } from \"@aws-sdk/client-dynamodb\";\nimport { DynamoDBDocumentClient } from \"@aws-sdk/lib-dynamodb\";\nimport { SocialMessagingClient } from \"@aws-sdk/client-socialmessaging\";\nimport { config } from \"./config.mjs\";\n\nconst { region } = config;\n\nexport const bedrock = new BedrockRuntimeClient({ region });\nexport const bedrockKb = new BedrockAgentRuntimeClient({ region });\nexport const social = new SocialMessagingClient({ region });\nexport const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {\n  marshallOptions: { removeUndefinedValues: true },\n});\n", "config.mjs": "// Toda configura\u00e7\u00e3o vem de vari\u00e1vel de ambiente (definida no template.yaml).\n// Nada de profile local: na Lambda o SDK usa a role de execu\u00e7\u00e3o.\n\nconst num = (v, padrao) => (v === undefined || v === \"\" ? padrao : Number(v));\n\nexport const config = {\n  region: process.env.AWS_REGION ?? \"us-east-2\",\n\n  // Bedrock\n  modelId: process.env.MODEL_ID ?? \"us.anthropic.claude-sonnet-4-6\",\n  maxTokens: num(process.env.MAX_TOKENS, 512),\n  temperature: num(process.env.TEMPERATURE, 0.7),\n  maxTurnosTool: num(process.env.MAX_TURNOS_TOOL, 5),\n\n  // Guardrail. GUARDRAIL_ID=off desliga (igual ao v9).\n  guardrailId: process.env.GUARDRAIL_ID ?? \"off\",\n  guardrailVersion: process.env.GUARDRAIL_VERSION ?? \"DRAFT\",\n\n  // Knowledge Base (RAG com S3 Vectors)\n  kbId: process.env.KB_ID,\n  topK: num(process.env.TOP_K, 20),\n  // Escala do S3 Vectors: o melhor trecho fica perto de 0.44 e \"bom dia\" perto de 0.36 (v7).\n  scoreMinimo: num(process.env.SCORE_MINIMO, 0.4),\n\n  // DynamoDB (tabela \u00fanica: conversas, mensagens processadas, alunos)\n  tabela: process.env.TABELA,\n  ttlConversaSeg: num(process.env.TTL_CONVERSA_SEG, 24 * 3600), // = janela de 24h do WhatsApp\n  ttlMensagemSeg: num(process.env.TTL_MENSAGEM_SEG, 24 * 3600),\n  maxMensagensHistorico: num(process.env.MAX_MENSAGENS_HISTORICO, 20),\n  lockSeg: num(process.env.LOCK_SEG, 60),\n\n  // WhatsApp (AWS End User Messaging Social)\n  // Opcional: se vazio, o id \u00e9 derivado do ARN que vem no evento.\n  originationPhoneNumberId: process.env.ORIGINATION_PHONE_NUMBER_ID,\n  metaApiVersion: process.env.META_API_VERSION ?? \"v20.0\",\n};\n", "conversa.mjs": "// Estado no DynamoDB (tabela \u00fanica, chave \"pk\").\n//\n//   pk = CONVERSA#<telefone>   { messages, lockUntil, ttl }\n//   pk = MSG#<wamid>           { ttl }            -> idempot\u00eancia\n//   pk = ALUNO#<email>         { nome, ingresso, status, pedido, ... }\n//\n// O `ttl` \u00e9 o atributo de Time To Live da tabela: o DynamoDB apaga sozinho.\n\nimport { GetCommand, PutCommand, UpdateCommand } from \"@aws-sdk/lib-dynamodb\";\nimport { dynamo } from \"./clients.mjs\";\nimport { config } from \"./config.mjs\";\n\nconst agora = () => Math.floor(Date.now() / 1000);\n\nexport class ConversaOcupadaError extends Error {\n  constructor(telefone) {\n    super(`conversa ${telefone} em processamento por outra invoca\u00e7\u00e3o`);\n    this.name = \"ConversaOcupadaError\";\n  }\n}\n\n// \u2500\u2500 idempot\u00eancia \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nexport async function jaProcessada(messageId) {\n  const r = await dynamo.send(\n    new GetCommand({ TableName: config.tabela, Key: { pk: `MSG#${messageId}` } })\n  );\n  return Boolean(r.Item);\n}\n\nexport async function marcarProcessada(messageId) {\n  await dynamo.send(\n    new PutCommand({\n      TableName: config.tabela,\n      Item: { pk: `MSG#${messageId}`, ttl: agora() + config.ttlMensagemSeg },\n    })\n  );\n}\n\n// \u2500\u2500 lock por telefone \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// O SNS padr\u00e3o n\u00e3o garante ordem e o SQS padr\u00e3o pode entregar mensagens do\n// mesmo cliente em paralelo. O lock evita duas Lambdas lendo e gravando o\n// hist\u00f3rico do mesmo telefone ao mesmo tempo. Se falhar, o erro faz a mensagem\n// voltar \u00e0 fila (batchItemFailures) e ser tentada de novo.\nexport async function carregarComLock(telefone) {\n  const t = agora();\n  try {\n    const r = await dynamo.send(\n      new UpdateCommand({\n        TableName: config.tabela,\n        Key: { pk: `CONVERSA#${telefone}` },\n        UpdateExpression: \"SET lockUntil = :ate\",\n        ConditionExpression: \"attribute_not_exists(lockUntil) OR lockUntil < :agora\",\n        ExpressionAttributeValues: { \":ate\": t + config.lockSeg, \":agora\": t },\n        ReturnValues: \"ALL_NEW\",\n      })\n    );\n    return JSON.parse(r.Attributes.messages ?? \"[]\");\n  } catch (e) {\n    if (e.name === \"ConditionalCheckFailedException\") throw new ConversaOcupadaError(telefone);\n    throw e;\n  }\n}\n\n// Grava o hist\u00f3rico novo e solta o lock numa opera\u00e7\u00e3o s\u00f3.\nexport async function salvarEliberar(telefone, messages) {\n  await dynamo.send(\n    new UpdateCommand({\n      TableName: config.tabela,\n      Key: { pk: `CONVERSA#${telefone}` },\n      UpdateExpression: \"SET messages = :m, lockUntil = :zero, #ttl = :ttl\",\n      ExpressionAttributeNames: { \"#ttl\": \"ttl\" },\n      ExpressionAttributeValues: {\n        \":m\": JSON.stringify(aparar(messages)),\n        \":zero\": 0,\n        \":ttl\": agora() + config.ttlConversaSeg,\n      },\n    })\n  );\n}\n\n// Solta o lock sem alterar o hist\u00f3rico (usado quando algo deu errado).\nexport async function liberar(telefone) {\n  await dynamo.send(\n    new UpdateCommand({\n      TableName: config.tabela,\n      Key: { pk: `CONVERSA#${telefone}` },\n      UpdateExpression: \"SET lockUntil = :zero\",\n      ExpressionAttributeValues: { \":zero\": 0 },\n    })\n  ).catch(() => {});\n}\n\n// Mant\u00e9m s\u00f3 as \u00faltimas N mensagens (limita tokens e o limite de 400 KB do item).\n// O hist\u00f3rico do Converse tem que come\u00e7ar numa mensagem \"user\" com texto:\n// come\u00e7ar num toolResult sem o toolUse correspondente d\u00e1 ValidationException.\nfunction aparar(messages) {\n  let corte = messages.slice(-config.maxMensagensHistorico);\n  while (corte.length && !(corte[0].role === \"user\" && corte[0].content?.some((b) => b.text))) {\n    corte = corte.slice(1);\n  }\n  return corte;\n}\n\n// \u2500\u2500 alunos (era o objeto ALUNOS do v9) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nexport async function buscarAluno(email) {\n  const r = await dynamo.send(\n    new GetCommand({\n      TableName: config.tabela,\n      Key: { pk: `ALUNO#${email.trim().toLowerCase()}` },\n    })\n  );\n  if (!r.Item) return null;\n  const { pk, ttl, ...dados } = r.Item;\n  return dados;\n}\n", "guardrail.mjs": "// Guardrail: mesma ideia do v9, s\u00f3 que o log vai para o CloudWatch (JSON).\n\nimport { config } from \"./config.mjs\";\n\nexport const guardrailConfig =\n  config.guardrailId === \"off\"\n    ? undefined\n    : {\n        guardrailIdentifier: config.guardrailId,\n        guardrailVersion: config.guardrailVersion,\n        trace: \"enabled\", // sem isso voc\u00ea sabe QUE bloqueou, mas n\u00e3o POR QUE\n      };\n\n// Devolve uma lista de achados (\"entrada: EMAIL \u00b7 ANONYMIZED\") para logar.\nexport function achadosDoGuardrail(trace) {\n  const g = trace?.guardrail;\n  if (!g) return [];\n\n  const achados = [];\n  for (const [lado, mapa] of [\n    [\"entrada\", g.inputAssessment],\n    [\"saida\", g.outputAssessments],\n  ]) {\n    for (const a of Object.values(mapa ?? {}).flat()) {\n      const s = a.sensitiveInformationPolicy;\n      for (const f of a.contentPolicy?.filters ?? []) achados.push(`${lado}: ${f.type} \u00b7 ${f.action}`);\n      for (const p of s?.piiEntities ?? []) achados.push(`${lado}: ${p.type} \u00b7 ${p.action}`);\n      for (const r of s?.regexes ?? []) achados.push(`${lado}: ${r.name} \u00b7 ${r.action}`);\n    }\n  }\n  return achados;\n}\n", "handler.mjs": "// Ponto de entrada da Lambda.\n//\n//   WhatsApp \u2500\u25ba End User Messaging Social \u2500\u25ba SNS \u2500\u25ba SQS \u2500\u25ba ESTA LAMBDA\n//\n// Para cada mensagem do cliente:\n//   1. ignora se j\u00e1 processou (idempot\u00eancia)\n//   2. pega o lock da conversa e carrega o hist\u00f3rico (DynamoDB)\n//   3. chama o atendente (RAG + Bedrock + tools + guardrail)\n//   4. responde no WhatsApp\n//   5. grava o hist\u00f3rico e solta o lock\n//\n// Retorna batchItemFailures: s\u00f3 as mensagens que falharam voltam para a fila\n// (e depois de maxReceiveCount v\u00e3o para a DLQ). Requer\n// FunctionResponseTypes: [ReportBatchItemFailures] no event source mapping.\n\nimport { extrairMensagens } from \"./parseEvent.mjs\";\nimport {\n  carregarComLock,\n  jaProcessada,\n  liberar,\n  marcarProcessada,\n  salvarEliberar,\n  ConversaOcupadaError,\n} from \"./conversa.mjs\";\nimport { atender } from \"./atendente.mjs\";\nimport { enviarTexto, marcarComoLida } from \"./whatsapp.mjs\";\nimport { log } from \"./log.mjs\";\n\nconst RESPOSTA_NAO_TEXTO = \"Por enquanto eu s\u00f3 entendo mensagens de texto. Pode escrever sua d\u00favida?\";\n\nasync function processar(msg) {\n  if (await jaProcessada(msg.messageId)) {\n    log(\"duplicada_ignorada\");\n    return;\n  }\n\n  await marcarComoLida(msg.phoneNumberId, msg.messageId);\n\n  // \u00c1udio, imagem etc.: resposta fixa, sem chamar o modelo (n\u00e3o gasta token).\n  if (msg.tipo !== \"text\" || !msg.texto?.trim()) {\n    await enviarTexto(msg.phoneNumberId, msg.telefone, RESPOSTA_NAO_TEXTO);\n    await marcarProcessada(msg.messageId);\n    return;\n  }\n\n  const historico = await carregarComLock(msg.telefone);\n  try {\n    const { resposta, messages } = await atender({\n      texto: msg.texto,\n      nome: msg.nome,\n      messages: historico,\n    });\n\n    await enviarTexto(msg.phoneNumberId, msg.telefone, resposta);\n    await salvarEliberar(msg.telefone, messages);\n    await marcarProcessada(msg.messageId);\n  } catch (e) {\n    await liberar(msg.telefone);\n    throw e;\n  }\n}\n\nexport const handler = async (event) => {\n  const falhas = new Set();\n\n  // Achata todos os records e ordena por timestamp: o SNS padr\u00e3o n\u00e3o garante\n  // ordem. Mensagens do mesmo cliente no mesmo lote saem na ordem certa.\n  const mensagens = [];\n  for (const record of event.Records) {\n    try {\n      mensagens.push(...extrairMensagens(record));\n    } catch (e) {\n      log(\"evento_invalido\", { erro: e.message });\n      // Payload ileg\u00edvel n\u00e3o melhora com retry: descarta (n\u00e3o entra em falhas).\n    }\n  }\n  mensagens.sort((a, b) => a.timestamp - b.timestamp);\n\n  const telefonesComFalha = new Set();\n\n  for (const msg of mensagens) {\n    // Se uma mensagem do cliente falhou, as seguintes dele ficam para o retry,\n    // para n\u00e3o responder fora de ordem.\n    if (telefonesComFalha.has(msg.telefone)) {\n      falhas.add(msg.sqsMessageId);\n      continue;\n    }\n\n    try {\n      await processar(msg);\n    } catch (e) {\n      log(e instanceof ConversaOcupadaError ? \"conversa_ocupada\" : \"erro\", {\n        erro: e.name,\n        mensagem: e.message,\n      });\n      falhas.add(msg.sqsMessageId);\n      telefonesComFalha.add(msg.telefone);\n    }\n  }\n\n  return { batchItemFailures: [...falhas].map((itemIdentifier) => ({ itemIdentifier })) };\n};\n", "log.mjs": "// Log estruturado em JSON: o CloudWatch Logs Insights consegue filtrar por campo.\n// Nunca passe telefone, e-mail ou texto do cliente aqui.\nexport const log = (evento, dados = {}) =>\n  console.log(JSON.stringify({ evento, ...dados }));\n", "parseEvent.mjs": "// Desembrulha: SQS record -> envelope SNS -> evento do End User Messaging Social\n// -> whatsAppWebhookEntry (string JSON) -> mensagens de texto do cliente.\n//\n// Um mesmo t\u00f3pico SNS recebe mensagens do cliente E eventos de status\n// (sent, delivered, read). S\u00f3 as mensagens interessam aqui.\n\nexport function extrairMensagens(sqsRecord) {\n  const envelope = JSON.parse(sqsRecord.body);\n  // Com RawMessageDelivery=false o corpo \u00e9 o envelope do SNS (campo Message).\n  // Com RawMessageDelivery=true o corpo j\u00e1 \u00e9 o evento.\n  const evento = typeof envelope.Message === \"string\" ? JSON.parse(envelope.Message) : envelope;\n\n  const entry =\n    typeof evento.whatsAppWebhookEntry === \"string\"\n      ? JSON.parse(evento.whatsAppWebhookEntry)\n      : evento.whatsAppWebhookEntry;\n  if (!entry) return [];\n\n  const phoneArn = evento.context?.MetaPhoneNumberIds?.[0]?.arn;\n  // arn:aws:social-messaging:REGION:ACCOUNT:phone-number-id/ABC -> phone-number-id-ABC\n  const phoneNumberId = phoneArn ? phoneArn.split(\":\").pop().replace(\"/\", \"-\") : undefined;\n\n  const saida = [];\n  for (const change of entry.changes ?? []) {\n    const value = change.value ?? {};\n    const nomes = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));\n\n    for (const m of value.messages ?? []) {\n      saida.push({\n        sqsMessageId: sqsRecord.messageId, // usado no batchItemFailures\n        messageId: m.id, // wamid..., chave de idempot\u00eancia\n        telefone: m.from,\n        nome: nomes.get(m.from),\n        tipo: m.type,\n        texto: m.type === \"text\" ? m.text?.body : undefined,\n        timestamp: Number(m.timestamp), // segundos; o SNS n\u00e3o garante ordem\n        phoneNumberId,\n      });\n    }\n  }\n  return saida;\n}\n", "rag.mjs": "// RAG: Retrieve no Knowledge Base com S3 Vectors (busca vetorial) + filtro por score (igual ao v7).\n\nimport { RetrieveCommand } from \"@aws-sdk/client-bedrock-agent-runtime\";\nimport { bedrockKb } from \"./clients.mjs\";\nimport { config } from \"./config.mjs\";\n\nexport async function buscar(pergunta) {\n  const r = await bedrockKb.send(\n    new RetrieveCommand({\n      knowledgeBaseId: config.kbId,\n      retrievalQuery: { text: pergunta },\n      // KB com S3 Vectors usa vectorSearchConfiguration. (managedSearchConfiguration\n      // \u00e9 s\u00f3 para KB gerenciado, que n\u00e3o existe em us-east-2.) N\u00e3o h\u00e1 reranker aqui.\n      retrievalConfiguration: {\n        vectorSearchConfiguration: { numberOfResults: config.topK },\n      },\n    })\n  );\n\n  const todos = (r.retrievalResults ?? []).map((x) => ({\n    fonte: x.location?.s3Location?.uri?.split(\"/\").slice(-2).join(\"/\") ?? \"?\",\n    score: x.score ?? 0,\n    texto: x.content?.text ?? \"\",\n  }));\n\n  const trechos = todos.filter((t) => t.score >= config.scoreMinimo);\n  return { trechos, total: todos.length };\n}\n\nexport function montarMensagem(pergunta, trechos) {\n  if (trechos.length === 0) {\n    return (\n      `<contexto>\\nNenhum trecho relevante encontrado na base.\\n<\/contexto>\\n\\n` +\n      `Pergunta do cliente: ${pergunta}`\n    );\n  }\n\n  const contexto = trechos.map((t, i) => `[${i + 1}] fonte: ${t.fonte}\\n${t.texto}`).join(\"\\n\\n\");\n\n  return (\n    `<contexto>\\n${contexto}\\n<\/contexto>\\n\\n` +\n    `Responda a pergunta do cliente usando SOMENTE o contexto acima. ` +\n    `Se a resposta n\u00e3o estiver l\u00e1, diga que n\u00e3o encontrou e ofere\u00e7a o suporte.\\n\\n` +\n    `Pergunta do cliente: ${pergunta}`\n  );\n}\n", "telefone.mjs": "// O webhook entrega o n\u00famero do cliente sem \"+\" (ex.: 5588...), mas o\n// SendWhatsAppMessage do End User Messaging Social s\u00f3 aceita o destino com \"+\".\n// Sem ele a API devolve \"Invalid destination phone number or message Id\".\nexport function normalizarTelefone(telefone) {\n  if (!telefone) return telefone;\n  return telefone.startsWith(\"+\") ? telefone : `+${telefone}`;\n}\n", "tools.mjs": "// Tools do modelo (function calling). Mesmo contrato do v9; a diferen\u00e7a \u00e9 que\n// consultar_matricula agora l\u00ea do DynamoDB (por isso as tools s\u00e3o async).\n\nimport { buscarAluno } from \"./conversa.mjs\";\n\n// ponytail: link fixo; troca por gateway (Stripe/Pagar.me) quando existir checkout de verdade\nconst LINK_PAGAMENTO = \"https://formacaoaws.com.br/link-pagamento\";\n\nasync function consultarMatricula({ email }) {\n  const aluno = await buscarAluno(email ?? \"\");\n  return aluno ? { encontrado: true, ...aluno } : { encontrado: false };\n}\n\nasync function gerarLinkPagamento({ email }) {\n  const limpo = (email ?? \"\").trim().toLowerCase();\n  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(limpo)) {\n    return { gerado: false, motivo: \"e-mail inv\u00e1lido\" };\n  }\n  return { gerado: true, email: limpo, link: LINK_PAGAMENTO };\n}\n\nexport const EXECUTORES = {\n  consultar_matricula: consultarMatricula,\n  gerar_link_pagamento: gerarLinkPagamento,\n};\n\nexport const toolConfig = {\n  tools: [\n    {\n      toolSpec: {\n        name: \"consultar_matricula\",\n        description:\n          \"Consulta a matr\u00edcula de um aluno pelo e-mail de compra. \" +\n          \"Use quando a pessoa perguntar se a compra dela foi confirmada, \" +\n          \"qual ingresso ela tem, ou o n\u00famero do pedido. \" +\n          \"S\u00f3 chame se a pessoa j\u00e1 tiver informado o e-mail.\",\n        inputSchema: {\n          json: {\n            type: \"object\",\n            properties: {\n              email: { type: \"string\", description: \"E-mail usado na compra do ingresso\" },\n            },\n            required: [\"email\"],\n          },\n        },\n      },\n    },\n    {\n      toolSpec: {\n        name: \"gerar_link_pagamento\",\n        description:\n          \"Gera o link de pagamento do ingresso. \" +\n          \"Use quando a pessoa quiser comprar, pagar ou finalizar a compra. \" +\n          \"S\u00f3 chame depois que a pessoa informar o e-mail. \" +\n          \"OBRIGAT\u00d3RIO antes de chamar esta tool: chame consultar_matricula com o \" +\n          \"mesmo e-mail. Se voltar status 'confirmado', N\u00c3O chame esta tool \u2014 a \" +\n          \"pessoa j\u00e1 pagou, avise isso e informe o n\u00famero do pedido. \" +\n          \"S\u00f3 gere o link se a matr\u00edcula n\u00e3o existir ou n\u00e3o estiver confirmada.\",\n        inputSchema: {\n          json: {\n            type: \"object\",\n            properties: {\n              email: { type: \"string\", description: \"E-mail para envio do link de pagamento\" },\n            },\n            required: [\"email\"],\n          },\n        },\n      },\n    },\n  ],\n};\n", "whatsapp.mjs": "// Envio de mensagens pelo AWS End User Messaging Social.\n// O campo `message` \u00e9 o JSON da Cloud API da Meta, em bytes.\n\nimport { SendWhatsAppMessageCommand } from \"@aws-sdk/client-socialmessaging\";\nimport { social } from \"./clients.mjs\";\nimport { config } from \"./config.mjs\";\nimport { normalizarTelefone } from \"./telefone.mjs\";\n\nconst enviar = (phoneNumberId, payload) =>\n  social.send(\n    new SendWhatsAppMessageCommand({\n      originationPhoneNumberId: config.originationPhoneNumberId ?? phoneNumberId,\n      metaApiVersion: config.metaApiVersion,\n      message: new TextEncoder().encode(JSON.stringify({ messaging_product: \"whatsapp\", ...payload })),\n    })\n  );\n\nexport const enviarTexto = (phoneNumberId, telefone, texto) =>\n  enviar(phoneNumberId, {\n    recipient_type: \"individual\",\n    to: normalizarTelefone(telefone),\n    type: \"text\",\n    text: { body: texto },\n  });\n\n// Dois tracinhos azuis. N\u00e3o \u00e9 essencial, ent\u00e3o erro aqui n\u00e3o derruba o fluxo.\nexport const marcarComoLida = (phoneNumberId, messageId) =>\n  enviar(phoneNumberId, { status: \"read\", message_id: messageId }).catch(() => {});\n"};
const EVENT = {"Records": [{"messageId": "sqs-0001", "body": "{\"Type\":\"Notification\",\"MessageId\":\"sns-0001\",\"Message\":\"{\\\"context\\\":{\\\"MetaWabaIds\\\":[{\\\"wabaId\\\":\\\"1234567890abcde\\\",\\\"arn\\\":\\\"arn:aws:social-messaging:us-east-2:123456789012:waba/fb2594b8a7974770b128a409e2example\\\"}],\\\"MetaPhoneNumberIds\\\":[{\\\"metaPhoneNumberId\\\":\\\"321010217712345\\\",\\\"arn\\\":\\\"arn:aws:social-messaging:us-east-2:123456789012:phone-number-id/976c72a700aac43eaf573ae050example\\\"}]},\\\"whatsAppWebhookEntry\\\":\\\"{\\\\\\\"id\\\\\\\":\\\\\\\"365731266123456\\\\\\\",\\\\\\\"changes\\\\\\\":[{\\\\\\\"value\\\\\\\":{\\\\\\\"messaging_product\\\\\\\":\\\\\\\"whatsapp\\\\\\\",\\\\\\\"metadata\\\\\\\":{\\\\\\\"display_phone_number\\\\\\\":\\\\\\\"12065550100\\\\\\\",\\\\\\\"phone_number_id\\\\\\\":\\\\\\\"321010217712345\\\\\\\"},\\\\\\\"contacts\\\\\\\":[{\\\\\\\"profile\\\\\\\":{\\\\\\\"name\\\\\\\":\\\\\\\"Diego\\\\\\\"},\\\\\\\"wa_id\\\\\\\":\\\\\\\"14255550150\\\\\\\"}],\\\\\\\"messages\\\\\\\":[{\\\\\\\"from\\\\\\\":\\\\\\\"14255550150\\\\\\\",\\\\\\\"id\\\\\\\":\\\\\\\"wamid.EXEMPLO1\\\\\\\",\\\\\\\"timestamp\\\\\\\":\\\\\\\"1723506035\\\\\\\",\\\\\\\"text\\\\\\\":{\\\\\\\"body\\\\\\\":\\\\\\\"Quanto custa o ingresso VIP?\\\\\\\"},\\\\\\\"type\\\\\\\":\\\\\\\"text\\\\\\\"}]},\\\\\\\"field\\\\\\\":\\\\\\\"messages\\\\\\\"}]}\\\",\\\"aws_account_id\\\":\\\"123456789012\\\",\\\"message_timestamp\\\":\\\"2025-01-08T23:30:43.271279391Z\\\"}\"}"}]};
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* tema + índice */
const root = document.documentElement;
root.dataset.theme = localStorage.getItem('cfn-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('#theme').onclick = () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('cfn-theme', root.dataset.theme); };
const tocLinks = $$('#toc a');
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) tocLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-40% 0px -55% 0px' });
$$('main section').forEach(s => io.observe(s));

/* ── realce de JS ───────────────────────────────────────────── */
const KW = /\b(import|from|export|const|let|var|async|await|function|return|if|else|for|of|in|while|try|catch|throw|new|class|extends|super|typeof|instanceof|continue|break|undefined|null|true|false|this)\b/g;
function hlJs(line) {
  const re = /(\/\/.*$)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/g;
  let out = '', last = 0, m;
  const plain = s => esc(s).replace(KW, '<span class="t-k">$1</span>').replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="t-n">$1</span>');
  while ((m = re.exec(line))) {
    out += plain(line.slice(last, m.index));
    out += m[1] ? `<span class="t-c">${esc(m[1])}</span>` : `<span class="t-s">${esc(m[2])}</span>`;
    last = re.lastIndex;
  }
  return out + plain(line.slice(last));
}
const srcLines = f => SRC[f].replace(/\n$/, '').split('\n');
function showCode(el, file, range) {
  const L = srcLines(file);
  el.innerHTML = `<div class="ln" style="color:#7E8592;padding-left:14px">// src/${file}</div>` + L.map((l, i) => `<div class="ln" data-i="${i}"><span class="n">${i + 1}</span><span>${hlJs(l) || ' '}</span></div>`).join('');
  if (range) hlRange(el, range);
}
function hlRange(el, [a, b]) {
  $$('.ln[data-i]', el).forEach(d => { const i = +d.dataset.i; d.classList.toggle('hl', i >= a && i <= b); });
  const f = el.querySelector(`.ln[data-i="${a}"]`);
  if (f) el.scrollTo({ top: f.offsetTop - el.offsetTop - 40, behavior: 'smooth' });
}
// intervalo de linhas de um bloco que começa numa linha que casa com `re` (conta chaves)
function blockRange(file, re) {
  const L = srcLines(file); const s = L.findIndex(l => re.test(l)); if (s < 0) return [0, 0];
  let depth = 0, seen = false;
  for (let i = s; i < L.length; i++) {
    for (const ch of L[i].replace(/(['"`]).*?\1/g, '').replace(/\/\/.*$/, '')) { if (ch === '{' || ch === '(') { depth++; seen = true; } if (ch === '}' || ch === ')') depth--; }
    if (seen && depth <= 0) return [s, i];
  }
  return [s, L.length - 1];
}
const lineOf = (file, re) => srcLines(file).findIndex(l => re.test(l));

/* ── 1. mapa de arquivos ─────────────────────────────────────── */
const FILES = {
  'handler.mjs': ['entrada da Lambda; orquestra e decide o que volta para a fila', ['parseEvent.mjs', 'conversa.mjs', 'atendente.mjs', 'whatsapp.mjs', 'log.mjs']],
  'parseEvent.mjs': ['desembrulha SQS → SNS → WhatsApp (seção 3)', []],
  'conversa.mjs': ['DynamoDB: idempotência, lock, histórico, alunos (5, 6, 7)', ['clients.mjs', 'config.mjs']],
  'atendente.mjs': ['RAG + Converse + loop de tools + guardrail + cache (8, 9)', ['clients.mjs', 'config.mjs', 'rag.mjs', 'tools.mjs', 'guardrail.mjs', 'log.mjs']],
  'rag.mjs': ['Retrieve no Knowledge Base e montagem do contexto (10)', ['clients.mjs', 'config.mjs']],
  'tools.mjs': ['toolConfig e executores das tools (11)', ['conversa.mjs']],
  'guardrail.mjs': ['guardrailConfig e leitura do trace (12)', ['config.mjs']],
  'whatsapp.mjs': ['SendWhatsAppMessage e "marcar como lida" (13)', ['clients.mjs', 'config.mjs', 'telefone.mjs']],
  'telefone.mjs': ['acrescenta o "+" ao número', []],
  'clients.mjs': ['clients do SDK criados uma vez por ambiente (2)', ['config.mjs']],
  'config.mjs': ['variáveis de ambiente com padrão', []],
  'log.mjs': ['log JSON sem dados pessoais', []],
};
const FILE_NOTES = {
  'tools.mjs': 'Repare: <code>tools.mjs</code> importa <code>conversa.mjs</code> (para <code>buscarAluno</code>). A "tabela de alunos" mora na mesma tabela DynamoDB das conversas, com a chave <code>ALUNO#email</code>.',
  'atendente.mjs': 'Também lê <code>prompt.txt</code> com <code>readFileSync</code> no escopo do módulo, usando <code>import.meta.url</code> para achar a pasta (em ESM não existe <code>__dirname</code>).',
  'handler.mjs': 'É o único arquivo que conhece o SQS. Os outros não sabem de onde a mensagem veio, o que deixa o <code>atendente</code> reaproveitável (ele é o v9 sem o terminal).',
  'clients.mjs': 'Usa <code>DynamoDBDocumentClient</code> com <code>removeUndefinedValues</code>: você grava objetos JS normais e campos <code>undefined</code> são ignorados em vez de dar erro.',
};
$('#files').innerHTML = Object.keys(FILES).map(f => `<button class="file" data-f="${f}"><b>${f}</b><span>${FILES[f][0]}</span></button>`).join('');
$$('#files .file').forEach(b => b.onclick = () => {
  const f = b.dataset.f, deps = FILES[f][1], users = Object.keys(FILES).filter(k => FILES[k][1].includes(f));
  $$('#files .file').forEach(x => { x.classList.toggle('on', x === b); x.classList.toggle('dep', deps.includes(x.dataset.f)); x.classList.toggle('user', users.includes(x.dataset.f)); });
  $('#file-out').innerHTML = `<h3 style="margin-top:0">${f}</h3><p>${FILES[f][0]}</p><p><b>Importa:</b> ${deps.map(d => `<code>${d}</code>`).join(' ') || '<span class="hint">nada do projeto</span>'}</p><p><b>É importado por:</b> ${users.map(d => `<code>${d}</code>`).join(' ') || '<span class="hint">ninguém (é a entrada)</span>'}</p>${FILE_NOTES[f] ? `<p class="hint">${FILE_NOTES[f]}</p>` : ''}`;
  showCode($('#file-code'), f);
});
$('#files .file').click();

/* ── 2. cold start ───────────────────────────────────────────── */
$('#cs-lanes').innerHTML = [1, 2, 3].map(i => `<div class="lane"><b>Invocação ${i}</b><div class="track" id="cs-${i}"></div></div>`).join('');
async function coldStart() {
  [1, 2, 3].forEach(i => $('#cs-' + i).innerHTML = '');
  const put = (i, left, w, txt, bg) => { const t = document.createElement('div'); t.className = 'tok'; Object.assign(t.style, { left: left + '%', width: w + '%', background: bg, opacity: 0, color: '#15171B' }); t.textContent = txt; $('#cs-' + i).appendChild(t); requestAnimationFrame(() => t.style.opacity = 1); };
  put(1, 0, 14, 'import dos módulos', '#c4b5fd'); await sleep(450);
  put(1, 14, 14, 'new *Client()', '#c4b5fd'); await sleep(450);
  put(1, 28, 16, 'readFileSync(prompt)', '#c4b5fd'); await sleep(450);
  put(1, 44, 54, 'handler(event) → RAG, Bedrock, Dynamo…', '#86efac'); await sleep(800);
  put(2, 0, 54, 'handler(event) (reusa clients e prompt)', '#86efac'); await sleep(700);
  put(3, 0, 54, 'handler(event) (reusa clients e prompt)', '#86efac');
}
$('#cs-run').onclick = coldStart;

/* ── 3. parseEvent: camadas ──────────────────────────────────── */
function portExtrair(rec) { // mesma lógica do parseEvent.mjs, para a demonstração
  const envelope = JSON.parse(rec.body);
  const evento = typeof envelope.Message === 'string' ? JSON.parse(envelope.Message) : envelope;
  const entry = typeof evento.whatsAppWebhookEntry === 'string' ? JSON.parse(evento.whatsAppWebhookEntry) : evento.whatsAppWebhookEntry;
  const arn = evento.context?.MetaPhoneNumberIds?.[0]?.arn;
  const phoneNumberId = arn ? arn.split(':').pop().replace('/', '-') : undefined;
  const out = [];
  for (const ch of entry.changes ?? []) { const v = ch.value ?? {}; const nomes = new Map((v.contacts ?? []).map(c => [c.wa_id, c.profile?.name]));
    for (const m of v.messages ?? []) out.push({ sqsMessageId: rec.messageId, messageId: m.id, telefone: m.from, nome: nomes.get(m.from), tipo: m.type, texto: m.type === 'text' ? m.text?.body : undefined, timestamp: Number(m.timestamp), phoneNumberId }); }
  return { envelope, evento, entry, out, arn, phoneNumberId };
}
const REC = EVENT.Records[0], PX = portExtrair(REC);
const short = (v, n = 70) => typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v;
function view(obj, strKeys = []) { // JSON com strings longas encurtadas e marcadas
  return JSON.stringify(obj, (k, v) => typeof v === 'string' && v.length > 70 ? `⟨string JSON, ${v.length} chars⟩ ${short(v, 60)}` : v, 2)
    .split('\n').map(l => { const h = esc(l); return strKeys.some(k => l.includes(`"${k}"`)) ? `<span style="background:rgba(245,184,65,.22)">${h}</span>` : h; }).join('\n');
}
const LAYERS = [
  ['l0', 'Camada 1 · record do SQS', () => view({ messageId: REC.messageId, body: REC.body }, ['body']), 'O SQS entrega <code>event.Records[]</code>. O <code>messageId</code> é o ID <b>do SQS</b>, usado no <code>batchItemFailures</code>. O <code>body</code> é uma <b>string</b>: o que o SNS mandou para a fila.', /JSON\.parse\(sqsRecord\.body\)/],
  ['l1', 'Camada 2 · envelope do SNS', () => view({ Type: PX.envelope.Type, MessageId: PX.envelope.MessageId, Message: PX.envelope.Message }, ['Message']), '1º <code>JSON.parse</code>. Como a assinatura não usa <code>RawMessageDelivery</code>, o corpo é o envelope do SNS, e o conteúdo vem em <code>Message</code>, outra string. O código testa <code>typeof envelope.Message === "string"</code> para funcionar também com raw delivery ligado.', /typeof envelope\.Message/],
  ['l2', 'Camada 3 · evento do End User Messaging', () => view(PX.evento, ['whatsAppWebhookEntry']), '2º <code>JSON.parse</code>. Aqui está o <code>context</code> com o ARN do número que recebeu a mensagem, e o <code>whatsAppWebhookEntry</code>, que é o webhook da Meta repassado como mais uma string.', /whatsAppWebhookEntry === "string"/],
  ['l3', 'Camada 4 · webhook da Meta', () => view(PX.entry), '3º <code>JSON.parse</code>. Formato da Cloud API da Meta: <code>changes[].value</code> traz <code>contacts</code> (nome do perfil) e <code>messages</code>. Eventos de status (<code>sent</code>, <code>read</code>) chegam no mesmo tópico, com <code>statuses</code> em vez de <code>messages</code>. Para eles o loop não acha nada e a função devolve <code>[]</code>.', /for \(const change of entry\.changes/],
  ['l4', 'Saída · objeto limpo', () => view(PX.out[0]) + `\n\n<span style="color:#F5B841">phoneNumberId:</span>\n${esc(PX.arn)}\n  .split(":").pop()   → ${esc(PX.arn.split(':').pop())}\n  .replace("/", "-")  → ${esc(PX.phoneNumberId)}`, 'Um objeto por mensagem, com o <code>sqsMessageId</code> (para devolver à fila) e o <code>messageId</code> (o <code>wamid</code>, chave de idempotência). O <code>nome</code> vem do <code>Map</code> de <code>contacts</code> pelo <code>wa_id</code>. O <code>phoneNumberId</code> é derivado do ARN, no formato que o <code>SendWhatsAppMessage</code> aceita.', /saida\.push\(/],
];
let unPos = -1;
showCode($('#un-code'), 'parseEvent.mjs');
function unRender() {
  $('#layers').innerHTML = LAYERS.slice(0, unPos + 1).map((L, i) => `<div class="layer ${L[0]}" style="margin-left:${i * 14}px"><div class="lh"><b>${L[1]}</b>${i === unPos ? '<span class="badge b-info">aberta agora</span>' : ''}</div>${i === unPos ? `<pre class="plain">${L[2]()}</pre>` : ''}</div>`).join('');
  $('#un-pos').textContent = unPos < 0 ? '' : `${unPos + 1} de ${LAYERS.length}`;
  if (unPos >= 0) { $('#un-why').innerHTML = LAYERS[unPos][3]; const i = lineOf('parseEvent.mjs', LAYERS[unPos][4]); hlRange($('#un-code'), [i, i + (unPos === 4 ? 9 : 2)]); }
  $('#un-next').disabled = unPos >= LAYERS.length - 1;
}
$('#un-next').onclick = () => { unPos++; unRender(); };
$('#un-reset').onclick = () => { unPos = -1; $('#un-why').textContent = 'Comece pela camada de fora: o record que o SQS entrega para a Lambda.'; unRender(); };
unRender();


/* ── 4. simulador do lote ────────────────────────────────────── */
const OPTS = { ok: 'responde normal', falha: 'erro no Bedrock', lock: 'conversa ocupada', dup: 'já processada', audio: 'é um áudio', invalido: 'payload ilegível' };
const BATCH0 = [
  { id: 'sqs-1', tel: 'A', ts: 103, txt: 'e o VIP?', op: 'ok' },
  { id: 'sqs-2', tel: 'B', ts: 101, txt: 'oi', op: 'ok' },
  { id: 'sqs-3', tel: 'A', ts: 100, txt: 'quanto custa?', op: 'ok' },
  { id: 'sqs-4', tel: 'A', ts: 102, txt: 'tem boleto?', op: 'falha' },
  { id: 'sqs-5', tel: 'B', ts: 104, txt: 'valeu', op: 'lock' },
];
let batch = [];
function bDraw(list, editable = true) {
  $('#batch').innerHTML = list.map(m => `<div class="mc p${m.tel.toLowerCase()}" data-id="${m.id}"><div class="ph">${m.tel} · t=${m.ts}</div><div>"${esc(m.txt)}"</div><div class="hint" style="font-size:11px">${m.id}</div>${editable ? `<select data-id="${m.id}">${Object.entries(OPTS).map(([k, v]) => `<option value="${k}" ${k === m.op ? 'selected' : ''}>${v}</option>`).join('')}</select>` : `<div class="hint" style="font-size:11px">${OPTS[m.op]}</div>`}</div>`).join('');
  $$('#batch select').forEach(s => s.onchange = () => { batch.find(m => m.id === s.dataset.id).op = s.value; });
}
function bReset() { batch = BATCH0.map(m => ({ ...m })); bDraw(batch); $('#b-log').innerHTML = ''; $('#b-ret').textContent = '{ "batchItemFailures": [] }'; $('#b-why').innerHTML = 'Dica: o padrão já tem uma falha no telefone A. Veja o que acontece com a mensagem seguinte dele.'; }
const blog = (t, c = '') => { const b = $('#b-log'); b.insertAdjacentHTML('beforeend', `<div class="ev" style="grid-template-columns:1fr"><span class="${c}">${t}</span></div>`); b.scrollTop = b.scrollHeight; };
$('#b-run').onclick = async () => {
  $('#b-run').disabled = true; $('#b-log').innerHTML = ''; bDraw(batch, false);
  const card = id => $(`#batch .mc[data-id="${id}"]`);
  blog('1. extrairMensagens(record) para cada record', 's-cfg');
  const msgs = [];
  for (const m of batch) { await sleep(250);
    if (m.op === 'invalido') { card(m.id).classList.add('drop'); blog(`{"evento":"evento_invalido"} ${m.id}: descartado, sem retry`, 's-del'); }
    else msgs.push(m);
  }
  await sleep(400); blog('2. mensagens.sort((a, b) => a.timestamp - b.timestamp)', 's-cfg');
  msgs.sort((a, b) => a.ts - b.ts); bDraw([...msgs, ...batch.filter(m => m.op === 'invalido')], false);
  batch.filter(m => m.op === 'invalido').forEach(m => card(m.id).classList.add('drop'));
  await sleep(700);
  const falhas = new Set(), telFalha = new Set();
  blog('3. processar uma por vez', 's-cfg');
  for (const m of msgs) {
    const c = card(m.id); c.classList.add('run'); await sleep(650); c.classList.remove('run');
    if (telFalha.has(m.tel)) { falhas.add(m.id); c.classList.add('skip'); blog(`${m.id} (${m.tel}): telefone já falhou neste lote → pula e devolve à fila`, 's-prog'); continue; }
    if (m.op === 'falha') { falhas.add(m.id); telFalha.add(m.tel); c.classList.add('fail'); blog(`{"evento":"erro","erro":"ThrottlingException"} ${m.id}`, 's-fail'); }
    else if (m.op === 'lock') { falhas.add(m.id); telFalha.add(m.tel); c.classList.add('fail'); blog(`{"evento":"conversa_ocupada"} ${m.id}: outra Lambda está com o lock`, 's-fail'); }
    else if (m.op === 'dup') { c.classList.add('ok'); blog(`{"evento":"duplicada_ignorada"} ${m.id}`, 's-done'); }
    else if (m.op === 'audio') { c.classList.add('ok'); blog(`${m.id}: resposta fixa "só entendo texto", sem chamar o modelo`, 's-done'); }
    else { c.classList.add('ok'); blog(`${m.id}: respondida, histórico salvo, MSG# gravado`, 's-done'); }
  }
  const ret = { batchItemFailures: [...falhas].map(itemIdentifier => ({ itemIdentifier })) };
  $('#b-ret').textContent = JSON.stringify(ret, null, 2);
  const skipped = msgs.filter(m => telFalha.has(m.tel) && m.op !== 'falha' && m.op !== 'lock' && falhas.has(m.id));
  $('#b-why').innerHTML = `<b>${falhas.size} de ${batch.length}</b> records voltam para a fila; o SQS apaga os outros. ` +
    (skipped.length ? `${skipped.map(m => `<code>${m.id}</code>`).join(', ')} nem foi tentada: responder a ela antes da mensagem anterior do mesmo cliente deixaria a conversa fora de ordem. ` : '') +
    (batch.some(m => m.op === 'invalido') ? 'O payload ilegível não volta: retry não conserta JSON quebrado. ' : '') +
    'Depois de 5 recebimentos (<code>maxReceiveCount</code>), um record vai para a DLQ.';
  $('#b-run').disabled = false;
};
$('#b-reset').onclick = bReset;
bReset();

/* ── 5. injeção de falha no processar() ──────────────────────── */
const CSTEPS = [
  ['jaProcessada(messageId)', 'GetItem MSG#wamid'],
  ['marcarComoLida()', 'tracinhos azuis (best effort)'],
  ['carregarComLock(telefone)', 'UpdateItem condicional'],
  ['atender({ texto, nome, messages })', 'RAG + Bedrock, sem gravar nada'],
  ['enviarTexto(…)', 'o cliente recebe a resposta'],
  ['salvarEliberar(telefone, messages)', 'grava histórico, lockUntil = 0'],
  ['marcarProcessada(messageId)', 'PutItem MSG#wamid'],
];
const CRASH = [
  [{}, 'Nada foi gravado. A mensagem volta a ficar visível na fila depois do <code>VisibilityTimeout</code> (360 s) e é processada do zero. <span class="badge b-ok">seguro</span>'],
  [{}, 'O cliente viu os tracinhos azuis e nenhuma resposta. No retry tudo acontece de novo, inclusive marcar como lida (inofensivo). <span class="badge b-ok">seguro</span>'],
  [{ conv: 'lockUntil: agora+60', ch: 'conv' }, 'O lock ficou gravado. <b>Morrer</b> (timeout, falta de memória) não executa o <code>catch</code> que chamaria <code>liberar()</code>. O lock é uma <i>lease</i>: expira sozinho em 60 s (<code>LOCK_SEG</code>). Como o retry só vem depois de 360 s, ele encontra o lock vencido e segue. Outras mensagens desse cliente nesse intervalo recebem <code>conversa_ocupada</code> e voltam à fila. <span class="badge b-ok">seguro</span>'],
  [{ conv: 'lockUntil: agora+60', ch: 'conv' }, 'Igual ao anterior, mas os tokens do Bedrock já foram pagos e serão pagos de novo no retry. <span class="badge b-warn">custa 2×</span>'],
  [{ conv: 'lockUntil: agora+60', ch: 'conv' }, 'O cliente <b>já recebeu</b> a resposta, mas nada foi salvo. No retry, <code>jaProcessada</code> devolve falso e o fluxo roda inteiro: <b>o cliente recebe uma segunda resposta</b>. É a limitação conhecida do README. Para fechar essa janela seria preciso marcar a mensagem como "enviada" antes de enviar, ou guardar o ID do envio. <span class="badge b-bad">duplica a resposta</span>'],
  [{ conv: 'messages: [..., pergunta, resposta]\nlockUntil: 0', ch: 'conv' }, 'Histórico salvo e lock solto, mas falta o <code>MSG#</code>. No retry a mensagem é tratada como nova: <b>segunda resposta</b> e a mesma pergunta entra <b>duas vezes</b> no histórico. <span class="badge b-bad">duplica resposta e histórico</span>'],
  [{ conv: 'messages: [..., pergunta, resposta]\nlockUntil: 0', msg: 'ttl: agora+24h', ch: 'msg' }, 'Tudo gravado. Se a Lambda morrer antes de devolver o resultado ao SQS, o record é reentregue, e o <code>jaProcessada</code> barra logo no passo 1. O SQS entrega "pelo menos uma vez", e o <code>MSG#</code> torna isso inofensivo. <span class="badge b-ok">seguro</span>'],
];
$('#crash').innerHTML = CSTEPS.map((s, i) => `<div class="cstep" data-i="${i}"><span class="k">${i + 1}</span><span><code>${s[0]}</code> <span class="hint">${s[1]}</span></span><button class="btn" data-k="${i}" title="morrer logo depois deste passo">💥</button></div>`).join('') +
  '<div class="cstep" style="grid-template-columns:1fr auto"><span>Outra situação: <code>atender()</code> <b>lança exceção</b> (ex.: throttling do Bedrock)</span><button class="btn" data-k="exc">⚠</button></div>';
function ddbView(st) {
  const c = st.conv ? `<span class="${st.ch === 'conv' ? 'chg' : ''}">pk: CONVERSA#5588…\n  ${st.conv.replace(/\n/g, '\n  ')}</span>` : '<span style="color:#7E8592">CONVERSA#5588…: como estava antes</span>';
  const m = st.msg ? `<span class="chg">pk: MSG#wamid.HBg…\n  ${st.msg}</span>` : '<span style="color:#7E8592">MSG#wamid.HBg…: não existe</span>';
  return `<pre style="margin:0;white-space:pre-wrap">${c}\n\n${m}</pre>`;
}
$$('#crash [data-k]').forEach(b => b.onclick = () => {
  const k = b.dataset.k;
  if (k === 'exc') {
    $$('#crash .cstep[data-i]').forEach((d, i) => { d.className = 'cstep ' + (i < 3 ? 'done' : i === 3 ? 'dead' : 'never'); });
    $('#cr-ddb').innerHTML = ddbView({ conv: 'lockUntil: 0   ← liberar() no catch', ch: 'conv' });
    $('#cr-out').innerHTML = 'Exceção é diferente de morte: o <code>catch</code> em <code>processar()</code> chama <code>liberar()</code> (que zera o lock e engole o próprio erro com <code>.catch(() => {})</code>) e <b>relança</b>. O handler registra a falha e devolve o record no <code>batchItemFailures</code>. Outras mensagens desse cliente no mesmo lote são puladas. <span class="badge b-ok">seguro</span>';
    return;
  }
  const n = +k;
  $$('#crash .cstep[data-i]').forEach((d, i) => { d.className = 'cstep ' + (i <= n ? 'done' : 'never'); });
  $$('#crash .cstep[data-i]')[n].classList.add('dead');
  $('#cr-ddb').innerHTML = ddbView(CRASH[n][0]);
  $('#cr-out').innerHTML = `<b>Morreu logo depois do passo ${n + 1}.</b><p style="margin:6px 0 0">${CRASH[n][1]}</p>`;
});
$('#cr-ddb').innerHTML = ddbView({});

/* ── 6. corrida pelo lock ────────────────────────────────────── */
$('#lock-expr').innerHTML = hlJs(`new UpdateCommand({`) + '\n' + [
  `  Key: { pk: \`CONVERSA#\${telefone}\` },`,
  `  UpdateExpression: "SET lockUntil = :ate",              // :ate = agora + 60`,
  `  ConditionExpression: "attribute_not_exists(lockUntil) OR lockUntil < :agora",`,
  `  ReturnValues: "ALL_NEW",                               // devolve o item (com messages)`,
  `})`].map(hlJs).join('\n');
const lkTok = (lane, left, txt, bg) => { const t = document.createElement('div'); t.className = 'tok'; Object.assign(t.style, { left: left + '%', background: bg, color: '#15171B', opacity: 0 }); t.textContent = txt; $('#lk-' + lane).appendChild(t); requestAnimationFrame(() => t.style.opacity = 1); };
const lkDdb = (v, note) => $('#lk-ddb').innerHTML = `<pre style="margin:0">pk: CONVERSA#5588…\n  lockUntil: <span class="chg">${v}</span>\n  messages: "[…]"</pre><div style="color:#7E8592;margin-top:4px">${note}</div>`;
async function lkRun(crash) {
  $('#lk-a').innerHTML = $('#lk-b').innerHTML = ''; const clk = t => $('#lk-clock').textContent = 't = ' + t + ' s'; const out = h => $('#lk-out').innerHTML = h;
  clk(0); lkDdb(0, 'lock livre'); out('As duas Lambdas recebem mensagens do mesmo telefone quase ao mesmo tempo.'); await sleep(900);
  lkTok('a', 0, 'UpdateItem ✓ lock', '#86efac'); lkDdb(60, 'A ganhou: a condição era verdadeira (0 < agora).'); out('<b>A</b> manda o UpdateItem primeiro. A condição passa, o lock vai para agora+60 e o <code>ALL_NEW</code> já devolve o histórico. Uma ida ao DynamoDB faz as duas coisas.'); await sleep(1400);
  clk('0,1'); lkTok('b', 2, 'UpdateItem ✗ ConditionalCheckFailed', '#fca5a5'); out('<b>B</b> chega 100 ms depois. Agora <code>lockUntil (60) &lt; agora (0,1)</code> é falso: o DynamoDB recusa com <code>ConditionalCheckFailedException</code>, que o código converte em <code>ConversaOcupadaError</code>. A mensagem de B volta para a fila.'); await sleep(1700);
  if (!crash) {
    clk(3); lkTok('a', 34, 'salvarEliberar → lockUntil 0', '#93c5fd'); lkDdb(0, 'A gravou o histórico e soltou o lock na mesma operação.'); out('<b>A</b> responde, grava o histórico novo e solta o lock num único UpdateItem.'); await sleep(1600);
    clk(360); lkTok('b', 66, 'retry: UpdateItem ✓', '#86efac'); lkDdb(420, 'B pegou o lock no retry.'); out('Depois do <code>VisibilityTimeout</code>, <b>B</b> tenta de novo. A condição passa, e o <code>ALL_NEW</code> devolve o histórico <b>já com a conversa de A</b>. Sem o lock, B teria lido o histórico antigo e apagado o turno de A ao gravar.');
  } else {
    clk(5); lkTok('a', 30, '💥 morreu (timeout)', '#fca5a5'); lkDdb(60, 'lock preso: ninguém vai chamar liberar()'); out('<b>A</b> morre segurando o lock. O <code>catch</code> não roda. O lock continua até t = 60.'); await sleep(1700);
    clk(360); lkTok('b', 66, 'retry: UpdateItem ✓', '#86efac'); lkTok('a', 66, '', 'transparent'); lkDdb(420, 'lock vencido (60 < 360): B assume.'); out('No retry de B, <code>lockUntil (60) &lt; agora (360)</code> é verdadeiro: o lock venceu e B assume. A mensagem de A também volta da fila e é processada depois. O prazo de 60 s é o que impede um lock esquecido de travar a conversa para sempre.');
  }
}
$('#lk-run').onclick = () => lkRun(false);
$('#lk-crash').onclick = () => lkRun(true);
lkDdb(0, 'Primeira mensagem de um telefone novo? O UpdateItem cria o item (upsert). Foi por isso que, no smoke test, o item CONVERSA# apareceu só com lockUntil.');


/* ── 7. aparar() ─────────────────────────────────────────────── */
const H12 = [
  ['u', 'user: "Olá"'], ['a', 'asst: "Olá, Will! Sou a IA…"'], ['u', 'user: "quero o VIP"'], ['tu', 'asst: toolUse consultar_matricula'],
  ['tr', 'user: toolResult'], ['tu', 'asst: toolUse gerar_link_pagamento'], ['tr', 'user: toolResult'], ['a', 'asst: "Aqui o link…"'],
  ['u', 'user: "tem boleto?"'], ['a', 'asst: "Não tem boleto…"'], ['u', 'user: "ok"'], ['a', 'asst: "Quer o link agora?"'],
];
function apDraw() {
  const N = +$('#ap-r').value; $('#ap-n').textContent = N;
  const s = Math.max(0, H12.length - N); let start = s; const dropped = [];
  while (start < H12.length && H12[start][0] !== 'u') { dropped.push(start); start++; }
  $('#ap-hist').innerHTML = H12.map((h, i) => `<span class="hm ${h[0]} ${i < s ? 'cut' : ''} ${dropped.includes(i) ? 'cut bad' : ''} ${i === start ? 'first' : ''}">${i}: ${h[1]}</span>`).join('');
  const kept = H12.length - start;
  $('#ap-out').innerHTML = `<code>messages.slice(-${N})</code> começa no índice ${s} (${H12[s][1]}). ` +
    (dropped.length ? `Esse início é inválido para o Converse, então o <code>while</code> descarta ${dropped.map(i => `<b>${i}</b>`).join(', ')} até achar uma mensagem do usuário com texto. ` : 'Já começa numa mensagem do usuário com texto, nada a descartar. ') +
    `Ficam <b>${kept}</b> mensagens${kept < N ? ` (menos que N, de propósito)` : ''}. Além de tokens, o corte protege o limite de <b>400 KB por item</b> do DynamoDB.`;
}
$('#ap-r').oninput = apDraw; apDraw();

/* ── 8. atendente: stepper ───────────────────────────────────── */
$('#s8').insertAdjacentHTML('beforeend', '<div class="hint" style="margin-top:10px">Trecho de atendente.mjs envolvido neste passo:</div><div class="code" id="at-code" style="max-height:260px"></div>');
showCode($('#at-code'), 'atendente.mjs');
const B = (k, who, txt, pre) => ({ k, who, txt, pre });
const PRIOR = [B('user', 'user', 'Olá'), B('asst', 'assistant', 'Olá, Will! Sou a IA do Joao Willamy AWS. Como posso te ajudar?')];
const SYS = B('tool', 'system', '[prompt.txt ~3 mil tokens] · cachePoint(1h) · "Nome do cliente no WhatsApp: Will"');
const AUG = q => B('aug', `user · índice 2 trocado por comContexto()`, '', `<contexto>\n[1] fonte: imersao/ingresso-vip-preco-e-inclusos.md\nValor promocional: R$ 97 …\n[2] fonte: imersao/formas-de-pagamento.md …\n</contexto>\n\nResponda a pergunta do cliente usando SOMENTE o contexto acima…\n\nPergunta do cliente: ${q}`);
const TU1 = B('asst', 'assistant · toolUse', '', '{ "toolUse": { "toolUseId": "tooluse_a1", "name": "consultar_matricula",\n  "input": { "email": "joao@email.com" } } }');
const TR1 = B('tool', 'user · toolResult', '', '{ "toolResult": { "toolUseId": "tooluse_a1", "status": "success",\n  "content": [{ "json": { "encontrado": true, "nome": "João",\n    "ingresso": "Normal", "status": "pendente", "pedido": "HP-77104" } }] } }');
const TU2 = B('asst', 'assistant · toolUse', '', '{ "toolUse": { "toolUseId": "tooluse_b2", "name": "gerar_link_pagamento",\n  "input": { "email": "joao@email.com" } } }');
const TR2 = B('tool', 'user · toolResult', '', '{ "toolResult": { "toolUseId": "tooluse_b2", "status": "success",\n  "content": [{ "json": { "gerado": true, "email": "joao@email.com",\n    "link": "https://formacaoaws.com.br/link-pagamento" } }] } }');
const Q = { pay: 'Quero o VIP, meu e-mail é joao@email.com', simple: 'Quanto custa o VIP?', block: 'meu cartão é 4111 1111 1111 1111' };
const U = q => B('user', 'user · pergunta crua', q);
const SC = {
  pay: [
    ['RAG primeiro, sempre', 'Antes de qualquer chamada ao modelo, <code>buscar(texto)</code> consulta o Knowledge Base com a pergunta crua. Não é o modelo que decide buscar: é o código.', [], PRIOR, /await buscar\(texto\)/],
    ['A pergunta entra crua no histórico', '<code>historico = [...messages]</code> copia o array (o original fica intacto, o que importa no caminho do guardrail). <code>idxPergunta = historico.length</code> guarda <b>onde</b> a pergunta ficou: índice 2.', [], [...PRIOR, U(Q.pay)], /const idxPergunta/],
    ['Turno 0: a requisição', '<code>comContexto(historico)</code> devolve um array novo em que só o índice 2 é trocado pela mensagem aumentada com o RAG. O histórico continua com a pergunta crua. O <code>system</code> leva o prompt, o <code>cachePoint</code> e o nome. Junto vão <code>toolConfig</code> e <code>guardrailConfig</code>.', [SYS, ...PRIOR, AUG(Q.pay)], [...PRIOR, U(Q.pay)], /messages: comContexto\(historico\)/],
    ['Resposta: stopReason = "tool_use"', 'O modelo não respondeu o cliente: ele pediu uma tool. A mensagem do assistant (com o bloco <code>toolUse</code>) entra no histórico, porque o próximo turno precisa dela: um <code>toolResult</code> sem o <code>toolUse</code> correspondente é rejeitado.', [], [...PRIOR, U(Q.pay), TU1], /historico\.push\(assistantMessage\)/],
    ['O código executa a tool', '<code>EXECUTORES[name]</code> acha a função, que lê <code>ALUNO#joao@email.com</code> no DynamoDB. O resultado volta como <code>toolResult</code> com o <b>mesmo</b> <code>toolUseId</code>, dentro de uma mensagem de <b>role user</b>. O log registra só o nome da tool, não o e-mail.', [], [...PRIOR, U(Q.pay), TU1, TR1], /const executor = EXECUTORES\[name\]/],
    ['Turno 1: requisição de novo', 'O loop volta. <code>comContexto</code> continua trocando só o índice 2, então o contexto do RAG vai de novo, e o par toolUse/toolResult vai como está. Cada volta do loop é uma chamada paga ao Bedrock; o cache segura o custo do prompt.', [SYS, ...PRIOR, AUG(Q.pay), TU1, TR1], [...PRIOR, U(Q.pay), TU1, TR1], /for \(let turno = 0/],
    ['Segunda tool', 'Status <code>pendente</code>: seguindo a regra da descrição da tool, o modelo pede <code>gerar_link_pagamento</code>. Mais um par toolUse/toolResult. Se o status fosse <code>confirmado</code>, ele responderia sem gerar link.', [], [...PRIOR, U(Q.pay), TU1, TR1, TU2, TR2], /toolResults\.push/],
    ['Turno 2: stopReason = "end_turn"', 'Agora o modelo responde com texto. O código loga <code>uso_tokens</code> e devolve <code>{ resposta, messages: historico }</code>. O histórico que será salvo tem a pergunta <b>crua</b> e não carrega o contexto do RAG: os próximos turnos não ficam inflados.', [SYS, ...PRIOR, AUG(Q.pay), TU1, TR1, TU2, TR2], [...PRIOR, U(Q.pay), TU1, TR1, TU2, TR2, B('asst', 'assistant', 'Seu ingresso Normal está pendente, João. Aqui o link para o VIP: https://formacaoaws.com.br/link-pagamento. Quer ajuda com o pagamento?')], /stopReason !== "tool_use"/],
    ['De volta ao handler', 'O handler envia a resposta (<code>enviarTexto</code>), grava o histórico com <code>salvarEliberar</code>, que aplica o <code>aparar()</code> da seção 7, e marca o <code>MSG#</code>. Se o loop passasse de <code>MAX_TURNOS_TOOL</code> (5), o atendente devolveria uma mensagem de escalação e o histórico <b>original</b>, sem gravar o turno quebrado.', [], [...PRIOR, U(Q.pay), TU1, TR1, TU2, TR2, B('asst', 'assistant', 'Seu ingresso Normal está pendente, João…')], /Estourou o limite/],
  ],
  simple: [
    ['RAG primeiro', 'Mesmo começo: <code>buscar(texto)</code> com a pergunta crua.', [], PRIOR, /await buscar\(texto\)/],
    ['Pergunta crua no histórico', '<code>idxPergunta = 2</code>.', [], [...PRIOR, U(Q.simple)], /const idxPergunta/],
    ['Turno 0: requisição', 'O índice 2 vai aumentado com o contexto.', [SYS, ...PRIOR, AUG(Q.simple)], [...PRIOR, U(Q.simple)], /messages: comContexto\(historico\)/],
    ['end_turn direto', 'Sem tool: a primeira resposta já é texto. Uma única chamada ao Bedrock. Este é o caminho da maioria das mensagens.', [], [...PRIOR, U(Q.simple), B('asst', 'assistant', 'O VIP custa R$ 97 e inclui aula extra na terça, gravação por 7 dias e desafio extra. Quer o VIP?')], /stopReason !== "tool_use"/],
  ],
  block: [
    ['RAG primeiro (mesmo assim)', 'O <code>buscar()</code> roda antes do guardrail avaliar. A busca é paga mesmo que a mensagem seja bloqueada. Uma otimização possível: chamar <code>ApplyGuardrail</code> sozinho antes do RAG.', [], PRIOR, /await buscar\(texto\)/],
    ['Pergunta crua no histórico (em memória)', 'Ela entra no <code>historico</code> local, como sempre.', [], [...PRIOR, U(Q.block)], /const idxPergunta/],
    ['Turno 0: requisição com guardrailConfig', 'O guardrail avalia a entrada antes do modelo.', [SYS, ...PRIOR, AUG(Q.block)], [...PRIOR, U(Q.block)], /guardrailConfig,/],
    ['stopReason = "guardrail_intervened"', 'Não é exceção: é uma resposta normal, com o texto de bloqueio configurado no guardrail em <code>output.message</code>. <code>usage.inputTokens === 0</code> indica que o bloqueio foi na <b>entrada</b>: o modelo nem rodou, zero token. O código devolve <code>messages</code>, o array <b>original</b>, que não tem a pergunta.', [B('asst', 'resposta', 'Nao posso ajudar com isso por aqui. Quer falar sobre os ingressos da Imersao?')], PRIOR, /guardrail_intervened/],
    ['Por que descartar a pergunta', 'Se a mensagem bloqueada ficasse no histórico, ela seria reenviada em todo turno seguinte, e o guardrail bloquearia <b>todas</b> as próximas mensagens desse cliente. Por isso <code>historico = [...messages]</code> foi uma cópia: o original sobrevive intacto.', [], PRIOR, /messages, \/\/ sem a pergunta bloqueada/],
  ],
};
let sc = 'pay', at = 0;
const bub = b => `<div class="bub ${b.k}"><span class="who">${esc(b.who)}</span>${b.txt ? esc(b.txt) : ''}${b.pre ? `<pre class="plain">${esc(b.pre)}</pre>` : ''}</div>`;
function atDraw() {
  const S = SC[sc], [t, why, req, hist, re] = S[at];
  $('#at-why').innerHTML = `<div class="eyebrow">passo ${at + 1} de ${S.length}</div><h3 style="margin-top:4px">${t}</h3><p style="margin:0">${why}</p>`;
  $('#at-req').innerHTML = req.length ? req.map(bub).join('') : '<div class="hint">nenhuma chamada ao Bedrock neste passo</div>';
  $('#at-hist').innerHTML = hist.map(bub).join('');
  $('#at-hist').scrollTop = 1e6; $('#at-req').scrollTop = 1e6;
  const i = lineOf('atendente.mjs', re); if (i >= 0) hlRange($('#at-code'), [i, i + 1]);
  $('#at-pos').textContent = `${at + 1}/${S.length}`; $('#at-prev').disabled = at === 0; $('#at-next').disabled = at === S.length - 1;
}
$$('[data-sc]').forEach(b => b.onclick = () => { sc = b.dataset.sc; at = 0; $$('[data-sc]').forEach(x => x.classList.toggle('on', x === b)); atDraw(); });
$('#at-next').onclick = () => { at++; atDraw(); }; $('#at-prev').onclick = () => { at--; atDraw(); };
atDraw();

/* ── 9. cachePoint ───────────────────────────────────────────── */
function cpDraw(mode) {
  $$('[data-cp]').forEach(b => b.classList.toggle('on', b.dataset.cp === mode));
  const seg = (w, txt, bg, fg = '#15171B') => `<div style="flex:${w};background:${bg};color:${fg}">${txt}</div>`;
  const CP = seg(0.35, '◆', '#15171B', '#F5B841');
  const W = '#fdba74', R = '#86efac', N = '#e5e7eb';
  if (mode === 'right') {
    $('#cp-1').innerHTML = seg(1, 'tools', W) + seg(5, 'prompt.txt · cache WRITE', W) + CP + seg(1.3, 'nome: Diego', N) + seg(2.4, 'messages', N);
    $('#cp-2').innerHTML = seg(1, 'tools', R) + seg(5, 'prompt.txt · cache READ', R) + CP + seg(1.3, 'nome: Maria', N) + seg(2.4, 'messages', N);
    $('#cp-out').innerHTML = 'O prefixo antes do ◆ é idêntico para todos os clientes. Diego paga a gravação (1h de TTL custa 2× o preço de input); Maria e todos os seguintes leem do cache por 10% do preço. O nome muda, mas vem <b>depois</b> do ponto de corte.';
  } else {
    $('#cp-1').innerHTML = seg(1, 'tools', W) + seg(5, 'prompt.txt', W) + seg(1.3, 'nome: Diego', W) + CP + seg(2.4, 'messages', N);
    $('#cp-2').innerHTML = seg(1, 'tools', W) + seg(5, 'prompt.txt', W) + seg(1.3, 'nome: Maria', W) + CP + seg(2.4, 'messages', N);
    $('#cp-out').innerHTML = 'Agora o prefixo inclui o nome. Para Maria ele é diferente, então não há hit: cada cliente novo regrava ~3 mil tokens a 2× o preço. A documentação explica que o Claude procura o maior prefixo <b>já gravado</b> por requisições anteriores; como só o prefixo com "Diego" foi gravado, o de "Maria" não aproveita nada.';
  }
}
$$('[data-cp]').forEach(b => b.onclick = () => cpDraw(b.dataset.cp)); cpDraw('right');

/* ── 10. RAG ─────────────────────────────────────────────────── */
const SC0 = [[.743, 'imersao/ingresso-vip-preco-e-inclusos.md', 1], [.659, 'imersao/ingresso-normal-preco-e-inclusos.md', 1], [.630, 'imersao/formas-de-pagamento.md', 1], [.611, 'imersao/curso-gravado-acesso-vitalicio.md', 1], [.593, 'imersao/aula-extra-vip-cdn.md', 1],
  [.571, 'imersao/prazo-da-gravacao-por-ingresso.md'], [.552, 'imersao/reembolso-do-ingresso.md'], [.538, 'imersao/datas-e-horarios.md'], [.524, 'imersao/nota-fiscal.md'], [.512, 'imersao/troca-de-titularidade-do-ingresso.md'],
  [.498, 'formacao/o-que-e-a-formacao-aws.md'], [.487, 'imersao/conteudo-do-dia-1.md'], [.476, 'imersao/certificado-de-participacao.md'], [.465, 'formacao/desafios-da-formacao.md'], [.457, 'imersao/suporte-e-atendimento.md'],
  [.449, 'formacao/labs-especiais.md'], [.441, 'imersao/conteudo-do-dia-2.md'], [.433, 'formacao/cicd-e-git.md'], [.426, 'formacao/lambda-e-serverless.md'], [.418, 'imersao/pre-requisitos-para-participar.md']];
function rgDraw() {
  const min = +$('#rg-r').value / 100; $('#rg-v').textContent = min.toFixed(2);
  $('#rg-bars').innerHTML = SC0.map(([s, f, real]) => `<div class="sb ${s < min ? 'out' : ''}"><span style="font-family:var(--mono)">${s.toFixed(3)}</span><div class="bar"><i style="width:${s * 100}%"></i></div><span class="hint" style="font-size:11.5px">${f.split('/')[1]}${real ? ' · real' : ''}</span></div>`).join('');
  const k = SC0.filter(x => x[0] >= min).length, tok = k * 160, usd = tok * 3.3 / 1e6;
  $('#rg-out').innerHTML = `<code>trechos.length = ${k}</code> de 20 (o <code>TOP_K</code>). Contexto injetado: <b>~${tok.toLocaleString('pt-BR')} tokens</b>, cerca de <b>US$ ${usd.toFixed(4)}</b> por chamada ao Bedrock (estimativa de ~160 tokens por trecho), e cada volta do loop de tools reenvia esse contexto. ` +
    (k === 0 ? 'Com zero trechos, o <code>montarMensagem</code> manda "Nenhum trecho relevante encontrado", e o prompt orienta a oferecer o suporte.' : k >= 15 ? 'É a situação do seu log real (<code>encontrados: 20, usados: 20</code>): o corte quase não filtra.' : 'Os trechos que passam entram numerados com a <code>fonte</code>, que vem dos dois últimos pedaços da URI no S3 (<code>split("/").slice(-2)</code>).');
}
$('#rg-r').oninput = rgDraw; rgDraw();

/* ── 11. sequência da tool ───────────────────────────────────── */
const SEQ = [
  [0, 1, 'Converse({ messages, toolConfig })'], [1, 0, 'stopReason: "tool_use" · toolUse { id: a1, name, input }'],
  [0, 2, 'EXECUTORES["consultar_matricula"]({ email })'], [2, 0, '{ encontrado: true, status: "pendente", … }'],
  [0, 1, 'messages + user: toolResult { toolUseId: a1, json }'], [1, 0, 'stopReason: "end_turn" (ou outra tool)'],
];
const SEQ_TXT = ['O código envia a conversa e a lista de tools disponíveis.', 'O modelo decide que precisa de dados e devolve um pedido estruturado, validado contra o <code>inputSchema</code>.', 'O código procura o executor pelo nome. Nome desconhecido vira <code>{ erro }</code> com <code>status: "error"</code>, e o modelo lê o erro como qualquer resultado.', 'A tool lê <code>ALUNO#email</code> no DynamoDB (o e-mail é normalizado com <code>trim().toLowerCase()</code>).', 'O resultado volta como bloco <code>json</code>, ligado ao pedido pelo <code>toolUseId</code>. Vários toolUse no mesmo turno viram vários toolResult na mesma mensagem.', 'Com o dado em mãos, o modelo responde ou pede outra tool. O loop do <code>atendente</code> repete até <code>end_turn</code> ou 5 voltas.'];
$('#sq-run').onclick = async () => {
  $$('#seq .seqmsg').forEach(e => e.remove());
  const X = [16.7, 50, 83.3];
  for (let i = 0; i < SEQ.length; i++) {
    const [a, b, t] = SEQ[i], l = Math.min(X[a], X[b]), w = Math.abs(X[a] - X[b]);
    $('#seq').insertAdjacentHTML('beforeend', `<div class="seqmsg ${b > a ? 'r' : 'l'}" id="sqm${i}"><span class="lbl" style="left:${(X[a] + X[b]) / 2}%">${esc(t)}</span><span class="ln2" style="left:${l}%;width:${w}%"></span></div>`);
    await sleep(60); $('#sqm' + i).classList.add('show'); $('#sq-out').innerHTML = `<b>${i + 1}.</b> ${SEQ_TXT[i]}`; await sleep(1500);
  }
};

/* ── 12. guardrail ───────────────────────────────────────────── */
const TRACE = { guardrail: {
  inputAssessment: { uoz94sxzlv52: { contentPolicy: { filters: [{ type: 'PROMPT_ATTACK', confidence: 'NONE', action: 'NONE' }] }, sensitiveInformationPolicy: { piiEntities: [{ type: 'CREDIT_DEBIT_CARD_NUMBER', match: '4111 1111 1111 1111', action: 'BLOCKED' }] } } },
  outputAssessments: { uoz94sxzlv52: [{ contentPolicy: { filters: [{ type: 'INSULTS', confidence: 'LOW', action: 'NONE' }] } }] } } };
$('#gr-in').textContent = '// trace ilustrativo (entrada e saída juntas)\n' + JSON.stringify(TRACE, null, 2);
$('#gr-run').onclick = async () => {
  const g = TRACE.guardrail, lists = [['entrada', Object.values(g.inputAssessment).flat()], ['saida', Object.values(g.outputAssessments).flat()]];
  $('#gr-mid').textContent = '// Object.values(mapa ?? {}).flat()\n' + lists.map(([l, v]) => `${l}: [${v.length} avaliação(ões)]`).join('\n') + '\n// o objeto da entrada e o array da saída viram a mesma forma: uma lista';
  $('#gr-outp').textContent = ''; await sleep(900);
  const ach = [];
  for (const [lado, arr] of lists) for (const a of arr) {
    for (const f of a.contentPolicy?.filters ?? []) ach.push(`${lado}: ${f.type} · ${f.action}`);
    for (const p of a.sensitiveInformationPolicy?.piiEntities ?? []) ach.push(`${lado}: ${p.type} · ${p.action}`);
  }
  for (const a of ach) { $('#gr-outp').textContent += (($('#gr-outp').textContent ? '\n' : '// achados (vão para o log, sem o match)\n') + a); await sleep(450); }
};

/* ── 13. whatsapp ────────────────────────────────────────────── */
(() => { const el = $('#wa-code'); el.innerHTML = ''; const tmp = document.createElement('div'); showCode(tmp, 'telefone.mjs'); const t2 = document.createElement('div'); showCode(t2, 'whatsapp.mjs'); el.append(t2, tmp); })();

/* ── 14. quiz ────────────────────────────────────────────────── */
const QUIZ = [
  ['Quantos JSON.parse o parseEvent faz até chegar na mensagem?', ['1', '2', '3', '4'], 2, 'body (SQS) → Message (SNS) → whatsAppWebhookEntry (Meta): três strings JSON aninhadas.'],
  ['A mensagem t=102 do telefone A falhou. O que acontece com a t=103 do mesmo telefone, no mesmo lote?', ['É processada normalmente', 'Nem é tentada e volta para a fila', 'É descartada', 'Vai direto para a DLQ'], 1, 'Responder a 103 antes da 102 deixaria a conversa fora de ordem.'],
  ['Por que o lock usa um UpdateItem condicional e não GetItem + PutItem?', ['É mais barato', 'Faz checar, travar e ler numa operação atômica', 'PutItem não aceita condição', 'Por causa do TTL'], 1, 'Entre um GetItem e um PutItem outra Lambda poderia entrar. O UpdateItem com ConditionExpression e ReturnValues: ALL_NEW faz tudo de uma vez.'],
  ['A Lambda morre por timeout segurando o lock. O que acontece?', ['A conversa trava para sempre', 'O catch chama liberar()', 'O lock expira em 60 s (LOCK_SEG)', 'O SQS solta o lock'], 2, 'Morte não executa catch. O prazo do lock é a rede de segurança.'],
  ['O que fica salvo no histórico depois de um turno com RAG?', ['A mensagem aumentada com o contexto', 'A pergunta crua', 'Os dois', 'Só a resposta'], 1, 'comContexto() troca o índice só na requisição. O histórico guarda a pergunta crua, para não inflar os próximos turnos.'],
  ['O guardrail bloqueou a entrada. O que o atendente devolve como histórico?', ['O histórico com a pergunta', 'O array original, sem a pergunta', 'Um array vazio', 'Nada, lança exceção'], 1, 'Se a pergunta ficasse, seria rebloqueada em todo turno seguinte.'],
  ['Por que o nome do cliente vai depois do cachePoint?', ['Por privacidade', 'Para o prefixo cacheado ser igual para todos os clientes', 'Porque o Converse exige', 'Para economizar output'], 1, 'O prefixo antes do cachePoint tem de ser idêntico entre requisições para dar hit.'],
  ['Em qual ponto uma morte da Lambda faz o cliente receber resposta duplicada?', ['Depois do carregarComLock', 'Depois do atender()', 'Depois do enviarTexto e antes do marcarProcessada', 'Depois do marcarProcessada'], 2, 'O envio já aconteceu, mas o MSG# não foi gravado: o retry processa de novo.'],
];
let score = 0, answered = 0;
$('#quiz').innerHTML = QUIZ.map((q, i) => `<div class="q" data-q="${i}"><p>${i + 1}. ${q[0]}</p><div class="opts">${q[1].map((o, j) => `<button class="opt" data-j="${j}">${o}</button>`).join('')}</div><div class="fb"></div></div>`).join('');
$$('#quiz .q').forEach(qd => { const q = QUIZ[+qd.dataset.q];
  $$('.opt', qd).forEach(b => b.onclick = () => { if (qd.dataset.done) return; qd.dataset.done = 1; answered++;
    const ok = +b.dataset.j === q[2]; if (ok) score++;
    b.classList.add(ok ? 'right' : 'wrong'); $$('.opt', qd)[q[2]].classList.add('right');
    const fb = $('.fb', qd); fb.innerHTML = (ok ? '✅ ' : '❌ ') + q[3]; fb.classList.add('show');
    $('#score').textContent = `Acertos: ${score}/${answered}`; }); });
