# Decisões de engenharia / Engineering decisions

## EN

What makes this architecture production-ready are the engineering decisions behind the flow, not just the AWS services.

### Resilience (SQS)
SQS decouples message ingestion from processing and absorbs traffic spikes. It also protects Amazon Bedrock from too many calls at once. Lambda reads in batches of up to 5 messages and concurrency is limited.

### Retry + DLQ
If processing a message fails, it returns to the queue and is retried, up to 5 times. After that it goes to a DLQ (dead-letter queue), so messages that repeatedly fail are isolated for investigation instead of silently disappearing. Lambda reports partial failures (batchItemFailures), so only the messages that failed go back to the queue and the good ones in the same batch are not reprocessed.

### Idempotency
Amazon SNS may deliver the same event more than once. Each WhatsApp message has a unique ID (wamid). After a message is processed, the ID is saved in DynamoDB with a TTL. If the same message arrives again, it is ignored. Goal: duplicate deliveries should not result in duplicate customer responses. Known limit: if Lambda crashes after sending the reply but before saving the ID, a retry can answer again.

### Concurrency control
Standard SNS does not guarantee message order, and SQS can deliver messages from the same customer in parallel. A conversation-level lock in DynamoDB (conditional write, 60 seconds) prevents multiple Lambdas from modifying the same conversation state at the same time. If the lock is taken, the message goes back to the queue and is retried. The handler also sorts each batch by timestamp.

### Persistence
Lambda keeps no memory between invocations. Conversation history and state live in DynamoDB, keyed by the user's phone number, with a 24-hour TTL. That matches the 24-hour customer service window of WhatsApp. Only the last 20 messages are kept, to limit tokens and stay under the DynamoDB item size limit (400 KB).

### Cost optimization (prompt caching)
The system prompt is large and identical for every conversation. With Amazon Bedrock prompt caching, it is processed once and then read from the cache, which costs much less than reprocessing it on every message. The customer's name is placed after the cache point so the cache can be shared across all customers.

### Reproducible infrastructure
Everything is provisioned using AWS SAM (infrastructure as code) and deployment scripts, so the whole stack can be created, updated and destroyed in a repeatable way.

### Other decisions
- No streaming: WhatsApp does not show a response arriving, so the code uses the non-streaming Converse API.
- Only text messages: audio and images get a fixed reply, without calling the model, so no tokens are spent.
- Credentials: Lambda uses its execution role, with no keys in the code.

## PT-BR

O que torna esta arquitetura pronta para produção são as decisões de engenharia por trás do fluxo, e não apenas os serviços da AWS.

### Resiliência (SQS)
O SQS desacopla a entrada das mensagens do processamento e absorve picos de tráfego. Também protege o Amazon Bedrock de excesso de chamadas simultâneas. A Lambda lê em lotes de até 5 mensagens e a concorrência é limitada.

### Retry + DLQ
Se o processamento de uma mensagem falha, ela volta para a fila e é tentada de novo, até 5 vezes. Depois disso vai para uma DLQ, então mensagens que falham repetidamente ficam isoladas para investigação, em vez de sumirem em silêncio. A Lambda reporta falhas parciais (batchItemFailures): só as mensagens que falharam voltam para a fila, e as boas do mesmo lote não são reprocessadas.

### Idempotência
O Amazon SNS pode entregar o mesmo evento mais de uma vez. Cada mensagem do WhatsApp tem um ID único (wamid). Depois de processada, o ID é salvo no DynamoDB com TTL. Se a mesma mensagem chegar de novo, é ignorada. Objetivo: entregas duplicadas não devem gerar respostas duplicadas para o cliente. Limite conhecido: se a Lambda cair depois de enviar a resposta e antes de salvar o ID, um retry pode responder de novo.

### Controle de concorrência
O SNS padrão não garante ordem, e o SQS pode entregar mensagens do mesmo cliente em paralelo. Um lock por conversa no DynamoDB (escrita condicional, 60 segundos) impede que várias Lambdas alterem o estado da mesma conversa ao mesmo tempo. Se o lock está ocupado, a mensagem volta para a fila e é tentada depois. O handler também ordena cada lote por timestamp.

### Persistência
A Lambda não guarda memória entre invocações. O histórico e o estado da conversa ficam no DynamoDB, com o telefone do usuário como chave e TTL de 24 horas, a mesma janela de atendimento do WhatsApp. Só as últimas 20 mensagens são mantidas, para limitar tokens e ficar abaixo do limite de tamanho do item do DynamoDB (400 KB).

### Otimização de custo (prompt caching)
O prompt do sistema é grande e idêntico em todas as conversas. Com o prompt caching do Amazon Bedrock, ele é processado uma vez e depois lido do cache, o que custa bem menos do que reprocessá-lo a cada mensagem. O nome do cliente fica depois do ponto de cache, para o cache ser compartilhado entre todos os clientes.

### Infraestrutura reproduzível
Tudo é provisionado com AWS SAM (infraestrutura como código) e scripts de deploy, então a stack inteira pode ser criada, atualizada e destruída de forma repetível.

### Outras decisões
- Sem streaming: o WhatsApp não mostra a resposta chegando, então o código usa a API Converse sem streaming.
- Só texto: áudio e imagem recebem uma resposta fixa, sem chamar o modelo, então nenhum token é gasto.
- Credenciais: a Lambda usa a role de execução, sem chaves no código.
