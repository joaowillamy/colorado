// Detecção simples de idioma (pt ou en) para as mensagens fixas.
//
// O Bedrock já responde no idioma do usuário (regra do prompt). Esta função
// existe só para os textos hardcoded, que não passam pelo modelo. Conta
// palavras comuns de cada idioma; empate ou texto vazio dá "pt".
// Palavras ambíguas (a, me, no, se, ok) ficam de fora de propósito.

const EN = new Set(
  "the is are was were you your yours i im i'm my we it this that these those and or but of to in on for with from what how why who when where which can could would should do does did not dont don't want need know tell please thanks thank hello hi hey yes yeah sure okay about more have has had will just really like".split(" ")
);
const PT = new Set(
  "o os as de do da dos das que não nao sim oi olá ola você voce vc como para por com um uma uns umas é são foi era eu meu minha nós isso esse essa este esta aqui mais quero preciso queria sei tudo obrigado obrigada valeu tá ta pode podem quer quem qual quando onde porque pra mas ou então entao já ja bom dia tarde noite".split(" ")
);

export function detectarIdioma(texto) {
  const palavras = (texto ?? "").toLowerCase().match(/[\p{L}']+/gu) ?? [];
  let en = 0;
  let pt = 0;
  for (const p of palavras) {
    if (EN.has(p)) en++;
    if (PT.has(p)) pt++;
  }
  return en > pt ? "en" : "pt";
}
