const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* tema + índice */
const root = document.documentElement;
root.dataset.theme = localStorage.getItem('cfn-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('#theme').onclick = () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('cfn-theme', root.dataset.theme); };
const tocLinks = $$('#toc a');
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) tocLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-40% 0px -55% 0px' });
$$('main section').forEach(s => io.observe(s));

/* ── realce de JS ───────────────────────────────────────────── */
const KW = /\b(import|from|export|const|let|var|async|await|function|return|if|else|for|of|in|while|try|catch|throw|new|class|extends|super|typeof|instanceof|continue|break|undefined|null|true|false|this)\b/g;
function hlJs(line) {
  const re = /(\/\/.*$)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/g;
  let out = '', last = 0, m;
  const plain = s => esc(s).replace(KW, '<span class="t-k">$1</span>').replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="t-n">$1</span>');
  while ((m = re.exec(line))) {
    out += plain(line.slice(last, m.index));
    out += m[1] ? `<span class="t-c">${esc(m[1])}</span>` : `<span class="t-s">${esc(m[2])}</span>`;
    last = re.lastIndex;
  }
  return out + plain(line.slice(last));
}
const srcLines = f => SRC[f].replace(/\n$/, '').split('\n');
function showCode(el, file, range) {
  const L = srcLines(file);
  el.innerHTML = `<div class="ln" style="color:#7E8592;padding-left:14px">// src/${file}</div>` + L.map((l, i) => `<div class="ln" data-i="${i}"><span class="n">${i + 1}</span><span>${hlJs(l) || ' '}</span></div>`).join('');
  if (range) hlRange(el, range);
}
function hlRange(el, [a, b]) {
  $$('.ln[data-i]', el).forEach(d => { const i = +d.dataset.i; d.classList.toggle('hl', i >= a && i <= b); });
  const f = el.querySelector(`.ln[data-i="${a}"]`);
  if (f) el.scrollTo({ top: f.offsetTop - el.offsetTop - 40, behavior: 'smooth' });
}
// intervalo de linhas de um bloco que começa numa linha que casa com `re` (conta chaves)
function blockRange(file, re) {
  const L = srcLines(file); const s = L.findIndex(l => re.test(l)); if (s < 0) return [0, 0];
  let depth = 0, seen = false;
  for (let i = s; i < L.length; i++) {
    for (const ch of L[i].replace(/(['"`]).*?\1/g, '').replace(/\/\/.*$/, '')) { if (ch === '{' || ch === '(') { depth++; seen = true; } if (ch === '}' || ch === ')') depth--; }
    if (seen && depth <= 0) return [s, i];
  }
  return [s, L.length - 1];
}
const lineOf = (file, re) => srcLines(file).findIndex(l => re.test(l));

/* ── 1. mapa de arquivos ─────────────────────────────────────── */
const FILES = {
  'handler.mjs': ['entrada da Lambda; orquestra e decide o que volta para a fila', ['parseEvent.mjs', 'conversa.mjs', 'atendente.mjs', 'whatsapp.mjs', 'log.mjs']],
  'parseEvent.mjs': ['desembrulha SQS → SNS → WhatsApp (seção 3)', []],
  'conversa.mjs': ['DynamoDB: idempotência, lock, histórico, alunos (5, 6, 7)', ['clients.mjs', 'config.mjs']],
  'atendente.mjs': ['RAG + Converse + loop de tools + guardrail + cache (8, 9)', ['clients.mjs', 'config.mjs', 'rag.mjs', 'tools.mjs', 'guardrail.mjs', 'log.mjs']],
  'rag.mjs': ['Retrieve no Knowledge Base e montagem do contexto (10)', ['clients.mjs', 'config.mjs']],
  'tools.mjs': ['toolConfig e executores das tools (11)', ['conversa.mjs']],
  'guardrail.mjs': ['guardrailConfig e leitura do trace (12)', ['config.mjs']],
  'whatsapp.mjs': ['SendWhatsAppMessage e "marcar como lida" (13)', ['clients.mjs', 'config.mjs', 'telefone.mjs']],
  'telefone.mjs': ['acrescenta o "+" ao número', []],
  'clients.mjs': ['clients do SDK criados uma vez por ambiente (2)', ['config.mjs']],
  'config.mjs': ['variáveis de ambiente com padrão', []],
  'log.mjs': ['log JSON sem dados pessoais', []],
};
const FILE_NOTES = {
  'tools.mjs': 'Repare: <code>tools.mjs</code> importa <code>conversa.mjs</code> (para <code>buscarAluno</code>). A "tabela de alunos" mora na mesma tabela DynamoDB das conversas, com a chave <code>ALUNO#email</code>.',
  'atendente.mjs': 'Também lê <code>prompt.txt</code> com <code>readFileSync</code> no escopo do módulo, usando <code>import.meta.url</code> para achar a pasta (em ESM não existe <code>__dirname</code>).',
  'handler.mjs': 'É o único arquivo que conhece o SQS. Os outros não sabem de onde a mensagem veio, o que deixa o <code>atendente</code> reaproveitável (ele é o v9 sem o terminal).',
  'clients.mjs': 'Usa <code>DynamoDBDocumentClient</code> com <code>removeUndefinedValues</code>: você grava objetos JS normais e campos <code>undefined</code> são ignorados em vez de dar erro.',
};
$('#files').innerHTML = Object.keys(FILES).map(f => `<button class="file" data-f="${f}"><b>${f}</b><span>${FILES[f][0]}</span></button>`).join('');
$$('#files .file').forEach(b => b.onclick = () => {
  const f = b.dataset.f, deps = FILES[f][1], users = Object.keys(FILES).filter(k => FILES[k][1].includes(f));
  $$('#files .file').forEach(x => { x.classList.toggle('on', x === b); x.classList.toggle('dep', deps.includes(x.dataset.f)); x.classList.toggle('user', users.includes(x.dataset.f)); });
  $('#file-out').innerHTML = `<h3 style="margin-top:0">${f}</h3><p>${FILES[f][0]}</p><p><b>Importa:</b> ${deps.map(d => `<code>${d}</code>`).join(' ') || '<span class="hint">nada do projeto</span>'}</p><p><b>É importado por:</b> ${users.map(d => `<code>${d}</code>`).join(' ') || '<span class="hint">ninguém (é a entrada)</span>'}</p>${FILE_NOTES[f] ? `<p class="hint">${FILE_NOTES[f]}</p>` : ''}`;
  showCode($('#file-code'), f);
});
$('#files .file').click();

/* ── 2. cold start ───────────────────────────────────────────── */
$('#cs-lanes').innerHTML = [1, 2, 3].map(i => `<div class="lane"><b>Invocação ${i}</b><div class="track" id="cs-${i}"></div></div>`).join('');
async function coldStart() {
  [1, 2, 3].forEach(i => $('#cs-' + i).innerHTML = '');
  const put = (i, left, w, txt, bg) => { const t = document.createElement('div'); t.className = 'tok'; Object.assign(t.style, { left: left + '%', width: w + '%', background: bg, opacity: 0, color: '#15171B' }); t.textContent = txt; $('#cs-' + i).appendChild(t); requestAnimationFrame(() => t.style.opacity = 1); };
  put(1, 0, 14, 'import dos módulos', '#c4b5fd'); await sleep(450);
  put(1, 14, 14, 'new *Client()', '#c4b5fd'); await sleep(450);
  put(1, 28, 16, 'readFileSync(prompt)', '#c4b5fd'); await sleep(450);
  put(1, 44, 54, 'handler(event) → RAG, Bedrock, Dynamo…', '#86efac'); await sleep(800);
  put(2, 0, 54, 'handler(event) (reusa clients e prompt)', '#86efac'); await sleep(700);
  put(3, 0, 54, 'handler(event) (reusa clients e prompt)', '#86efac');
}
$('#cs-run').onclick = coldStart;

/* ── 3. parseEvent: camadas ──────────────────────────────────── */
function portExtrair(rec) { // mesma lógica do parseEvent.mjs, para a demonstração
  const envelope = JSON.parse(rec.body);
  const evento = typeof envelope.Message === 'string' ? JSON.parse(envelope.Message) : envelope;
  const entry = typeof evento.whatsAppWebhookEntry === 'string' ? JSON.parse(evento.whatsAppWebhookEntry) : evento.whatsAppWebhookEntry;
  const arn = evento.context?.MetaPhoneNumberIds?.[0]?.arn;
  const phoneNumberId = arn ? arn.split(':').pop().replace('/', '-') : undefined;
  const out = [];
  for (const ch of entry.changes ?? []) { const v = ch.value ?? {}; const nomes = new Map((v.contacts ?? []).map(c => [c.wa_id, c.profile?.name]));
    for (const m of v.messages ?? []) out.push({ sqsMessageId: rec.messageId, messageId: m.id, telefone: m.from, nome: nomes.get(m.from), tipo: m.type, texto: m.type === 'text' ? m.text?.body : undefined, timestamp: Number(m.timestamp), phoneNumberId }); }
  return { envelope, evento, entry, out, arn, phoneNumberId };
}
const REC = EVENT.Records[0], PX = portExtrair(REC);
const short = (v, n = 70) => typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v;
function view(obj, strKeys = []) { // JSON com strings longas encurtadas e marcadas
  return JSON.stringify(obj, (k, v) => typeof v === 'string' && v.length > 70 ? `⟨string JSON, ${v.length} chars⟩ ${short(v, 60)}` : v, 2)
    .split('\n').map(l => { const h = esc(l); return strKeys.some(k => l.includes(`"${k}"`)) ? `<span style="background:rgba(245,184,65,.22)">${h}</span>` : h; }).join('\n');
}
const LAYERS = [
  ['l0', 'Camada 1 · record do SQS', () => view({ messageId: REC.messageId, body: REC.body }, ['body']), 'O SQS entrega <code>event.Records[]</code>. O <code>messageId</code> é o ID <b>do SQS</b>, usado no <code>batchItemFailures</code>. O <code>body</code> é uma <b>string</b>: o que o SNS mandou para a fila.', /JSON\.parse\(sqsRecord\.body\)/],
  ['l1', 'Camada 2 · envelope do SNS', () => view({ Type: PX.envelope.Type, MessageId: PX.envelope.MessageId, Message: PX.envelope.Message }, ['Message']), '1º <code>JSON.parse</code>. Como a assinatura não usa <code>RawMessageDelivery</code>, o corpo é o envelope do SNS, e o conteúdo vem em <code>Message</code>, outra string. O código testa <code>typeof envelope.Message === "string"</code> para funcionar também com raw delivery ligado.', /typeof envelope\.Message/],
  ['l2', 'Camada 3 · evento do End User Messaging', () => view(PX.evento, ['whatsAppWebhookEntry']), '2º <code>JSON.parse</code>. Aqui está o <code>context</code> com o ARN do número que recebeu a mensagem, e o <code>whatsAppWebhookEntry</code>, que é o webhook da Meta repassado como mais uma string.', /whatsAppWebhookEntry === "string"/],
  ['l3', 'Camada 4 · webhook da Meta', () => view(PX.entry), '3º <code>JSON.parse</code>. Formato da Cloud API da Meta: <code>changes[].value</code> traz <code>contacts</code> (nome do perfil) e <code>messages</code>. Eventos de status (<code>sent</code>, <code>read</code>) chegam no mesmo tópico, com <code>statuses</code> em vez de <code>messages</code>. Para eles o loop não acha nada e a função devolve <code>[]</code>.', /for \(const change of entry\.changes/],
  ['l4', 'Saída · objeto limpo', () => view(PX.out[0]) + `\n\n<span style="color:#F5B841">phoneNumberId:</span>\n${esc(PX.arn)}\n  .split(":").pop()   → ${esc(PX.arn.split(':').pop())}\n  .replace("/", "-")  → ${esc(PX.phoneNumberId)}`, 'Um objeto por mensagem, com o <code>sqsMessageId</code> (para devolver à fila) e o <code>messageId</code> (o <code>wamid</code>, chave de idempotência). O <code>nome</code> vem do <code>Map</code> de <code>contacts</code> pelo <code>wa_id</code>. O <code>phoneNumberId</code> é derivado do ARN, no formato que o <code>SendWhatsAppMessage</code> aceita.', /saida\.push\(/],
];
let unPos = -1;
showCode($('#un-code'), 'parseEvent.mjs');
function unRender() {
  $('#layers').innerHTML = LAYERS.slice(0, unPos + 1).map((L, i) => `<div class="layer ${L[0]}" style="margin-left:${i * 14}px"><div class="lh"><b>${L[1]}</b>${i === unPos ? '<span class="badge b-info">aberta agora</span>' : ''}</div>${i === unPos ? `<pre class="plain">${L[2]()}</pre>` : ''}</div>`).join('');
  $('#un-pos').textContent = unPos < 0 ? '' : `${unPos + 1} de ${LAYERS.length}`;
  if (unPos >= 0) { $('#un-why').innerHTML = LAYERS[unPos][3]; const i = lineOf('parseEvent.mjs', LAYERS[unPos][4]); hlRange($('#un-code'), [i, i + (unPos === 4 ? 9 : 2)]); }
  $('#un-next').disabled = unPos >= LAYERS.length - 1;
}
$('#un-next').onclick = () => { unPos++; unRender(); };
$('#un-reset').onclick = () => { unPos = -1; $('#un-why').textContent = 'Comece pela camada de fora: o record que o SQS entrega para a Lambda.'; unRender(); };
unRender();
