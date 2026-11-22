# Tool Use: a IA passa de responder para agir / Tool Use: from answering to taking action

## EN

### What it is
With Tool Use, the model identifies when an action is needed and requests a tool. Your code runs the function against real systems, such as DynamoDB or a payment API, and returns the result to the model, which then writes the final answer.

### Why it matters
Static information is not enough for questions like "Has my payment been confirmed?". Documents do not change in real time, so RAG alone cannot answer. A tool brings live data into the conversation.

### Simple example (illustrative)
- Without Tool Use: "I can't check your purchase."
- With Tool Use: "Yes, Maria. Your payment is confirmed. Order HP-88213."

### How it works with Amazon Bedrock
1. The code sends the tool definitions (name, description, input schema) in the Converse API request, in toolConfig.
2. If the model needs a tool, it stops with stopReason tool_use and the tool name and arguments.
3. The code executes the function (for example, a DynamoDB lookup by e-mail) and sends back a toolResult.
4. The model uses the result to write the final answer.
5. This loop is limited to 5 turns per question, to avoid infinite loops and runaway cost. Each tool used adds one more model call.

Important: the model only suggests the call. Your code runs it. Rules such as "look up the order before generating a payment link" are written in the tool description, which guides the model but is not a hard guarantee. Anything that must always be true should be enforced in the code.

## PT-BR

### O que é
Com Tool Use, o modelo identifica quando uma ação é necessária e pede uma tool. O seu código executa a função em sistemas reais, como o DynamoDB ou uma API de pagamento, e devolve o resultado ao modelo, que então escreve a resposta final.

### Por que importa
Informação estática não basta para perguntas como "Meu pagamento foi confirmado?". Documentos não mudam em tempo real, então só o RAG não responde. Uma tool traz dado vivo para dentro da conversa.

### Exemplo simples (ilustrativo)
- Sem Tool Use: "Não consigo verificar sua compra."
- Com Tool Use: "Sim, Maria. Seu pagamento está confirmado. Pedido HP-88213."

### Como funciona com o Amazon Bedrock
1. O código envia as definições das tools (nome, descrição, schema de entrada) na requisição da API Converse, em toolConfig.
2. Se o modelo precisa de uma tool, ele para com stopReason tool_use e informa o nome e os argumentos.
3. O código executa a função (por exemplo, uma consulta no DynamoDB por e-mail) e devolve um toolResult.
4. O modelo usa o resultado para escrever a resposta final.
5. Esse loop é limitado a 5 voltas por pergunta, para evitar loop infinito e custo descontrolado. Cada tool usada soma mais uma chamada ao modelo.

Importante: o modelo só sugere a chamada. Quem executa é o seu código. Regras como "consulte o pedido antes de gerar o link de pagamento" ficam na descrição da tool, o que orienta o modelo mas não é garantia. O que precisa ser sempre verdade deve ser garantido no código.
