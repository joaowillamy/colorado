# WhatsApp + Amazon Bedrock em Lambda

O `scripts/sdk-node/v9-guardrail.mjs` adaptado para rodar como atendente de WhatsApp.

```
Cliente ─► WhatsApp ─► End User Messaging Social ─► SNS ─► SQS ─► Lambda
                                                                   │
                         ┌─────────────────────────────────────────┤
                         ▼                  ▼                      ▼
                     DynamoDB        Bedrock (KB + Converse     End User Messaging
                  (histórico, lock,    + tools + guardrail)       Social (resposta)
                  idempotência, alunos)
```

## Do v9 para a Lambda

| v9 (terminal) | Aqui |
|---|---|
| `readline` em loop | `src/handler.mjs`, uma invocação por lote do SQS |
| `messages = []` em memória | DynamoDB, `src/conversa.mjs` (chave = telefone, TTL 24h) |
| `ALUNOS = {...}` | DynamoDB, `ALUNO#<email>` |
| `console.log` da resposta | `src/whatsapp.mjs` (`SendWhatsAppMessage`) |
| `buscar` / `montarMensagem` | `src/rag.mjs` |
| `toolConfig` / executores | `src/tools.mjs` |
| `guardrailConfig` / trace | `src/guardrail.mjs` |
| loop `ConverseCommand` + tools | `src/atendente.mjs` |
| painéis de tokens | log JSON no CloudWatch (`src/log.mjs`) |
| `profile: "formacaoaws"` | role da Lambda |

## Estrutura

```
whatsapp/
├── template.yaml        SAM: SNS, SQS+DLQ, DynamoDB, Lambda, IAM
├── prompt.txt           system prompt (cópia de scripts/prompt-valendo.txt)
├── events/              evento de exemplo (SQS > SNS > End User Messaging Social)
├── test/                teste do parser
└── src/
    ├── handler.mjs      entrada da Lambda, orquestra o fluxo
    ├── parseEvent.mjs   desembrulha SQS > SNS > whatsAppWebhookEntry
    ├── conversa.mjs     DynamoDB: histórico, lock, idempotência, alunos
    ├── atendente.mjs    RAG + Converse + tools + guardrail
    ├── rag.mjs          Retrieve no Knowledge Base
    ├── tools.mjs        consultar_matricula, gerar_link_pagamento
    ├── guardrail.mjs    guardrailConfig e leitura do trace
    ├── whatsapp.mjs     envio de mensagens
    ├── clients.mjs      clients do SDK (fora do handler)
    ├── config.mjs       variáveis de ambiente
    └── log.mjs          log JSON
```

## Decisões

- **SNS padrão, não FIFO.** O End User Messaging Social só publica em tópico padrão
  ([doc](https://docs.aws.amazon.com/end-user-messaging/latest/userguide/nx-whatsapp-send-inbound.html)),
  então a ordem não é garantida. O handler ordena o lote por `timestamp`, e um lock
  no DynamoDB impede duas Lambdas de mexerem na mesma conversa ao mesmo tempo.
- **Idempotência.** O `wamid` de cada mensagem é gravado no fim do processamento. Se
  a mensagem chegar duas vezes, a segunda é ignorada.
- **Falha parcial.** `batchItemFailures` devolve só as mensagens que falharam. Depois
  de 5 tentativas vão para a DLQ.
- **Guardrail bloqueou.** O texto de bloqueio é enviado ao cliente e a pergunta não
  entra no histórico (mesma regra do v9).
- **Prompt cache.** O nome do cliente vai depois do `cachePoint`, para o prompt grande
  continuar compartilhado entre todos os clientes.
- **Streaming removido.** O WhatsApp não mostra a resposta chegando, então usa `ConverseCommand`.

## Limitações conhecidas

- Se a Lambda cair entre enviar a resposta e gravar o histórico, o retry responde de novo (duplicata possível).
- Só texto. Áudio e imagem recebem uma resposta fixa.
- Respostas livres só dentro da janela de 24h do WhatsApp. Fora dela exige template aprovado.
- Se o guardrail anonimizar ou bloquear e-mail, o fluxo de pagamento (que pede e-mail) quebra.
- `ALUNO#<email>` precisa ser populado (ver abaixo). O link de pagamento continua fixo, como no v9.

## Rodar

```bash
npm install
npm test                     # parser, sem precisar de AWS

sam build
sam deploy --guided --parameter-overrides KbId=<kb> GuardrailId=<id> GuardrailVersion=<n>
```

Depois do deploy, no console do **AWS End User Messaging > Social messaging**, abra o
número de WhatsApp, ligue **Message and event publishing** e escolha o tópico `TopicoArn`
(saída do stack).

Cadastrar um aluno de teste:

```bash
aws dynamodb put-item --table-name <TABELA> --item '{
  "pk": {"S": "ALUNO#maria@email.com"}, "nome": {"S": "Maria"},
  "ingresso": {"S": "VIP"}, "status": {"S": "confirmado"}, "pedido": {"S": "HP-88213"}
}'
```

Ver logs: CloudWatch Logs Insights, `fields @timestamp, evento | filter evento = "guardrail_bloqueou"`.
