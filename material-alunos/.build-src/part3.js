
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
