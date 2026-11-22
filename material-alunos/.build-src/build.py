import json, re, pathlib
base = pathlib.Path(__file__).resolve().parent
mat = base.parent; src = mat.parent / 'whatsapp' / 'src'
cf = (mat / 'cloudformation-template.html').read_text()
css = re.search(r'<style>.*?</style>', cf, re.S).group(0)
SRC = {p.name: p.read_text() for p in sorted(src.glob('*.mjs'))}
EVENT = json.loads((mat.parent / 'whatsapp' / 'events' / 'sqs-sns-mensagem.json').read_text())
toc = ['Mapa dos arquivos','Cold start','parseEvent: camadas','handler: o lote','Falhas no meio','O lock','Histórico e aparar','Loop de tools','cachePoint','RAG e score','Contrato das tools','Guardrail','WhatsApp e log','Teste você']
nav = '<nav class="toc" id="toc"><div class="eyebrow">Roteiro</div>' + ''.join(f'<a href="#s{i+1}">{i+1} · {t}</a>' for i, t in enumerate(toc)) + '</nav>'
part1 = (base / 'part1.html').read_text()
extra_css, body = part1.split('</style>', 1)
js = '\n'.join((base / f'part{i}.js').read_text() for i in (2, 3, 4))
data = 'const SRC = ' + json.dumps(SRC).replace('</', '<\\/') + ';\nconst EVENT = ' + json.dumps(EVENT).replace('</', '<\\/') + ';\n'
html = f'''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>O código do atendente, por dentro · whatsapp/src</title>
{css}
{extra_css}</style>
</head><body><div class="layout">{nav}<main>{body}</main></div>
<script>
{data}
{js}
</script></body></html>'''
(mat / 'codigo-node-atendente.html').write_text(html)
(base / 'all.js').write_text(data + js)
print('ok', len(html))
