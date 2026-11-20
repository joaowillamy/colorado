# Fluxo completo: do WhatsApp até a IA e de volta

Exemplo seguido neste documento: o cliente Diego escreve **"Quanto custa o ingresso VIP?"**.

## 1. Visão geral

```mermaid
flowchart LR
    C([Cliente<br/>WhatsApp]) --> M[Meta / WhatsApp]
    M --> E[AWS End User<br/>Messaging Social]
    E --> S[SNS<br/>tópico padrão]
    S --> Q[(SQS)]
    Q -->|lote de até 5| L[Lambda<br/>handler.mjs]
    Q -.->|5 falhas| D[(DLQ)]
    L <--> DB[(DynamoDB)]
    L <--> B[Bedrock<br/>KB + Converse + Guardrail]
    L -->|SendWhatsAppMessage| E
    E --> M
    M --> C
```

## 2. Sequência detalhada

```mermaid
sequenceDiagram
    autonumber
    actor U as Cliente
    participant W as WhatsApp / End User Messaging
    participant N as SNS
    participant Q as SQS
    participant L as Lambda
    participant D as DynamoDB
    participant K as Bedrock KB
    participant B as Bedrock Converse + Guardrail

    U->>W: "Quanto custa o ingresso VIP?"
    W->>N: evento (whatsAppWebhookEntry)
    N->>Q: envelope SNS
    Q->>L: lote de records

    Note over L: parseEvent: desembrulha e ordena por timestamp
    L->>D: GetItem MSG#wamid (já processou?)
    D-->>L: não existe
    L->>W: marca como lida (best effort)
    L->>D: UpdateItem CONVERSA#telefone (pega o lock)
    D-->>L: histórico anterior

    L->>K: Retrieve (top 20 + rerank)
    K-->>L: trechos com score
    Note over L: filtra score >= 0.5 e monta a mensagem com <contexto>

    loop até 5 turnos (se o modelo pedir tool)
        L->>B: Converse (system + histórico + tools + guardrailConfig)
        alt guardrail_intervened
            B-->>L: texto de bloqueio
            Note over L: pergunta NÃO entra no histórico
        else tool_use
            B-->>L: toolUse consultar_matricula(email)
            L->>D: GetItem ALUNO#email
            D-->>L: matrícula
            Note over L: devolve toolResult e chama o Converse de novo
        else end_turn
            B-->>L: resposta final
        end
    end

    L->>W: SendWhatsAppMessage (resposta)
    W->>U: "Olá, Diego! O VIP custa 97..."
    L->>D: grava histórico + solta o lock
    L->>D: PutItem MSG#wamid (marca processada)
    L-->>Q: batchItemFailures vazio, records apagados
```

## 3. O dado em cada etapa

| # | Onde | Forma do dado |
|---|---|---|
| 1 | Cliente | Texto digitado |
| 2 | End User Messaging → SNS | JSON com cabeçalho AWS e o campo `whatsAppWebhookEntry` como **string JSON** |
| 3 | SNS → SQS | Envelope SNS: o evento acima fica em `Message`, também como string |
| 4 | SQS → Lambda | `event.Records[].body` (string) |
| 5 | `parseEvent.mjs` | Objeto limpo (abaixo) |
| 6 | `rag.mjs` | `[{ fonte, score, texto }]` |
| 7 | `atendente.mjs` → Bedrock | `messages` no formato Converse |
| 8 | Bedrock → Lambda | `output.message`, `stopReason`, `usage`, `trace` |
| 9 | `whatsapp.mjs` | JSON da Cloud API da Meta, em bytes |

Etapa 5, saída do parser:

```json
{
  "sqsMessageId": "sqs-0001",
  "messageId": "wamid.EXEMPLO1",
  "telefone": "14255550150",
  "nome": "Diego",
  "tipo": "text",
  "texto": "Quanto custa o ingresso VIP?",
  "timestamp": 1723506035,
  "phoneNumberId": "phone-number-id-976c72a700aac43eaf573ae050example"
}
```

Etapa 7, o que vai ao modelo. O histórico guarda só a pergunta crua. O contexto do RAG entra apenas na requisição:

```
system:   [ prompt.txt ] [cachePoint 1h] [ "Nome do cliente no WhatsApp: Diego" ]
messages: [ ...histórico anterior...,
            { user: "<contexto>[1] fonte: ... </contexto>
                     Responda ... usando SOMENTE o contexto acima ...
                     Pergunta do cliente: Quanto custa o ingresso VIP?" } ]
toolConfig:      consultar_matricula, gerar_link_pagamento
guardrailConfig: { identifier, version, trace: enabled }
```

Etapa 9, o que volta ao cliente:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "14255550150",
  "type": "text",
  "text": { "body": "Olá, Diego! O VIP custa 97 ... Quer o VIP?" }
}
```

## 4. Caminhos alternativos

```mermaid
flowchart TD
    A[Record chega na Lambda] --> B{Payload legível?}
    B -- não --> X1[Loga evento_invalido e descarta]
    B -- sim --> C{Evento tem mensagem?}
    C -- "só status (sent, read)" --> X2[Ignora]
    C -- sim --> D{wamid já processado?}
    D -- sim --> X3[Ignora duplicata]
    D -- não --> E{Tipo é texto?}
    E -- "áudio, imagem" --> X4[Resposta fixa, sem chamar o modelo]
    E -- sim --> F{Lock da conversa livre?}
    F -- não --> R1[batchItemFailures: volta p/ fila]
    F -- sim --> G[RAG + Converse]
    G --> H{stopReason}
    H -- guardrail_intervened --> I[Envia texto de bloqueio<br/>histórico fica sem a pergunta]
    H -- "tool_use (até 5x)" --> G
    H -- end_turn --> J[Envia resposta]
    G -- exceção --> R2[Solta o lock e batchItemFailures]
    R1 --> K{5 tentativas?}
    R2 --> K
    K -- sim --> DLQ[(DLQ)]
    K -- não --> A
```

## 5. Quem faz o quê

| Arquivo | Etapas |
|---|---|
| `src/parseEvent.mjs` | 4 → 5 |
| `src/handler.mjs` | orquestra tudo, decide o que vai para `batchItemFailures` |
| `src/conversa.mjs` | idempotência, lock, histórico (DynamoDB) |
| `src/rag.mjs` | 6 |
| `src/atendente.mjs` | 7 e 8, incluindo o loop de tools |
| `src/tools.mjs` | executa `consultar_matricula` e `gerar_link_pagamento` |
| `src/guardrail.mjs` | `guardrailConfig` e leitura do trace |
| `src/whatsapp.mjs` | 9 |
