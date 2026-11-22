
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
