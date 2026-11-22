# RAG: conhecimento baseado nos seus dados / RAG: knowledge grounded in your data

## EN

### What it is
RAG (Retrieval-Augmented Generation) retrieves relevant information from a Knowledge Base and provides it to the model as context for the answer.

### Why it matters
The model should not have to guess your prices, policies or business information. A language model does not know your private documents, and when it does not know, it may invent an answer. RAG grounds the answer in your own data.

### Simple example (illustrative)
- Without RAG: "I don't have access to the current prices." (or worse, an invented value)
- With RAG: "The VIP plan costs R$ 97 and includes an extra class and 7 days of recording."

### How it works in this assistant
1. The documents are stored in Amazon S3 and indexed in an Amazon Bedrock Knowledge Base, using S3 Vectors as the vector store.
2. On every customer message, the Lambda calls the Retrieve API on the Knowledge Base (top 20 results, with reranking).
3. Passages with a score below a minimum threshold are discarded, to avoid noise.
4. The remaining passages are placed inside a context block in the user message, with the instruction to answer using ONLY that context.
5. The search is unconditional: the code decides to search, not the model.

Trade-off: retrieved passages enter the input, so they add tokens (cost) to every request.

## PT-BR

### O que é
RAG (Retrieval-Augmented Generation, geração aumentada por recuperação) busca informações relevantes em uma Knowledge Base e entrega ao modelo como contexto para a resposta.

### Por que importa
O modelo não deve ter que adivinhar seus preços, políticas ou informações do negócio. Um modelo de linguagem não conhece seus documentos privados e, quando não sabe, pode inventar uma resposta. O RAG ancora a resposta nos seus próprios dados.

### Exemplo simples (ilustrativo)
- Sem RAG: "Não tenho acesso aos preços atuais." (ou pior, um valor inventado)
- Com RAG: "O plano VIP custa R$ 97 e inclui uma aula extra e 7 dias de gravação."

### Como funciona neste assistente
1. Os documentos ficam no Amazon S3 e são indexados em uma Knowledge Base do Amazon Bedrock, com S3 Vectors como armazenamento de vetores.
2. A cada mensagem do cliente, a Lambda chama a API Retrieve na Knowledge Base (top 20 resultados, com reranking).
3. Trechos com score abaixo de um mínimo são descartados, para evitar ruído.
4. Os trechos restantes entram num bloco de contexto na mensagem do usuário, com a instrução de responder usando SOMENTE esse contexto.
5. A busca é incondicional: o código decide buscar, não o modelo.

Trade-off: os trechos recuperados entram no input, então somam tokens (custo) a cada requisição.
