// Tools do modelo (function calling). Mesmo contrato do v9; a diferença é que
// consultar_matricula agora lê do DynamoDB (por isso as tools são async).

import { buscarAluno } from "./conversa.mjs";

// ponytail: link fixo; troca por gateway (Stripe/Pagar.me) quando existir checkout de verdade
const LINK_PAGAMENTO = "https://formacaoaws.com.br/link-pagamento";

async function consultarMatricula({ email }) {
  const aluno = await buscarAluno(email ?? "");
  return aluno ? { encontrado: true, ...aluno } : { encontrado: false };
}

async function gerarLinkPagamento({ email }) {
  const limpo = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) {
    return { gerado: false, motivo: "e-mail inválido" };
  }
  return { gerado: true, email: limpo, link: LINK_PAGAMENTO };
}

export const EXECUTORES = {
  consultar_matricula: consultarMatricula,
  gerar_link_pagamento: gerarLinkPagamento,
};

export const toolConfig = {
  tools: [
    {
      toolSpec: {
        name: "consultar_matricula",
        description:
          "Consulta a matrícula de um aluno pelo e-mail de compra. " +
          "Use quando a pessoa perguntar se a compra dela foi confirmada, " +
          "qual ingresso ela tem, ou o número do pedido. " +
          "Só chame se a pessoa já tiver informado o e-mail.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              email: { type: "string", description: "E-mail usado na compra do ingresso" },
            },
            required: ["email"],
          },
        },
      },
    },
    {
      toolSpec: {
        name: "gerar_link_pagamento",
        description:
          "Gera o link de pagamento do ingresso. " +
          "Use quando a pessoa quiser comprar, pagar ou finalizar a compra. " +
          "Só chame depois que a pessoa informar o e-mail. " +
          "OBRIGATÓRIO antes de chamar esta tool: chame consultar_matricula com o " +
          "mesmo e-mail. Se voltar status 'confirmado', NÃO chame esta tool — a " +
          "pessoa já pagou, avise isso e informe o número do pedido. " +
          "Só gere o link se a matrícula não existir ou não estiver confirmada.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              email: { type: "string", description: "E-mail para envio do link de pagamento" },
            },
            required: ["email"],
          },
        },
      },
    },
  ],
};
