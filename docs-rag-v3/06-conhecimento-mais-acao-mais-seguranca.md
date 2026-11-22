# Conhecimento + ação + segurança / Knowledge + action + safety

## EN

Three AI capabilities turn a chatbot into a real assistant:

- RAG provides knowledge: answers grounded in your own data.
- Tool Use enables actions: queries to real systems, with live data.
- Guardrails establish boundaries: safety policies enforced outside the prompt.

Knowledge + action + safety. That is the combination that moves an AI demo closer to a reliable system for real customers. Remove any one of them and the assistant becomes less trustworthy: without RAG it guesses, without tools it cannot act on real data, and without guardrails it has no enforced limits.

How they work together in one request: the Lambda first retrieves context from the Knowledge Base (RAG), then calls the model through the Converse API with the tool definitions and the guardrail attached. The guardrail checks the input, the model may request tools, your code runs them, and the guardrail checks the output before it is sent on WhatsApp.

Combined with the architecture (SQS, DLQ, idempotency, locks, DynamoDB, prompt caching, AWS SAM), this is what makes the assistant production-ready, not only a demo.

## PT-BR

Três capacidades de IA transformam um chatbot em um assistente de verdade:

- RAG dá conhecimento: respostas ancoradas nos seus próprios dados.
- Tool Use permite ações: consultas a sistemas reais, com dado vivo.
- Guardrails estabelecem limites: políticas de segurança aplicadas fora do prompt.

Conhecimento + ação + segurança. Essa é a combinação que aproxima uma demo de IA de um sistema confiável para clientes reais. Tirando qualquer uma, o assistente fica menos confiável: sem RAG ele chuta, sem tools ele não age sobre dados reais e sem guardrails ele não tem limites garantidos.

Como trabalham juntos em uma requisição: a Lambda primeiro recupera contexto da Knowledge Base (RAG), depois chama o modelo pela API Converse com as definições de tools e o guardrail anexado. O guardrail verifica a entrada, o modelo pode pedir tools, o seu código as executa, e o guardrail verifica a saída antes de ela ser enviada no WhatsApp.

Somado à arquitetura (SQS, DLQ, idempotência, locks, DynamoDB, prompt caching, AWS SAM), isso é o que torna o assistente pronto para produção, e não só uma demo.
