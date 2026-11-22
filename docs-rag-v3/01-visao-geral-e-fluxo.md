# Visão geral: como esta IA foi construída / Overview: how this AI was built

## EN

This assistant is a WhatsApp AI assistant built by Joao Willamy as a serverless architecture on AWS, designed with real-world production scenarios in mind.

The idea is simple: pay for processing, not for a machine waiting for messages. There is no server running 24/7. The question that started the project: what if a WhatsApp AI assistant could scale without keeping a server running all the time?

### How a message flows through the architecture

1. A customer sends a WhatsApp message.
2. AWS End User Messaging Social receives it.
3. Amazon SNS distributes the event.
4. Amazon SQS buffers traffic and provides a DLQ (dead-letter queue).
5. AWS Lambda (Node.js) orchestrates the processing.
6. Amazon Bedrock understands the message and generates the response.
7. Amazon DynamoDB stores conversation history and state.
8. The response is sent back to the customer through the same path (SendWhatsAppMessage API).

Connecting AWS services is not what makes an architecture production-ready. The difference comes from the engineering decisions behind the flow (see the document about engineering decisions).

### Example used to explain the flow

A customer named Diego writes: "How much is the VIP ticket?". The message goes through all the steps above. Lambda searches the Knowledge Base (RAG), calls the model with the retrieved context, and sends the answer back on WhatsApp. This is only an illustrative example.

### Tech stack

Amazon Bedrock (Claude Sonnet 4.6 + Knowledge Base with S3 Vectors), AWS Lambda (Node.js), Amazon SQS, Amazon SNS, Amazon DynamoDB, AWS End User Messaging Social, and AWS SAM.

## PT-BR

Esta IA é um assistente de WhatsApp criado pelo Joao Willamy com arquitetura serverless na AWS, pensada para cenários reais de produção.

A ideia é simples: pagar pelo processamento, e não por uma máquina ligada esperando mensagens. Não existe servidor rodando 24/7. A pergunta que originou o projeto: e se um assistente de IA no WhatsApp pudesse escalar sem manter um servidor ligado o tempo todo?

### O caminho de uma mensagem

1. O cliente envia uma mensagem no WhatsApp.
2. O AWS End User Messaging Social recebe.
3. O Amazon SNS distribui o evento.
4. O Amazon SQS segura o tráfego e oferece uma DLQ (fila de mensagens que falharam).
5. O AWS Lambda (Node.js) orquestra o processamento.
6. O Amazon Bedrock entende a mensagem e gera a resposta.
7. O Amazon DynamoDB guarda o histórico da conversa e o estado.
8. A resposta volta ao cliente pelo mesmo caminho (API SendWhatsAppMessage).

Ligar serviços da AWS não é o que torna uma arquitetura pronta para produção. A diferença está nas decisões de engenharia por trás do fluxo (veja o documento de decisões de engenharia).

### Exemplo usado para explicar o fluxo

O cliente Diego escreve: "Quanto custa o ingresso VIP?". A mensagem passa por todas as etapas acima. A Lambda busca no Knowledge Base (RAG), chama o modelo com o contexto recuperado e envia a resposta de volta no WhatsApp. É apenas um exemplo ilustrativo.

### Stack

Amazon Bedrock (Claude Sonnet 4.6 + Knowledge Base com S3 Vectors), AWS Lambda (Node.js), Amazon SQS, Amazon SNS, Amazon DynamoDB, AWS End User Messaging Social e AWS SAM.
