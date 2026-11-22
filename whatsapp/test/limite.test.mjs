import assert from "node:assert/strict";
import { detectarIdioma } from "../src/idioma.mjs";
import { contarPerguntas, passouDoLimite, mensagemLimite, MSG_DEFAULT_MAX_MSGS } from "../src/limite.mjs";

const user = (t) => ({ role: "user", content: [{ text: t }] });
const ia = (t) => ({ role: "assistant", content: [{ text: t }] });
const toolUse = { role: "assistant", content: [{ toolUse: { toolUseId: "1", name: "x", input: {} } }] };
const toolResult = { role: "user", content: [{ toolResult: { toolUseId: "1", content: [{ text: "ok" }] } }] };

const par = (i) => [user(`p${i}`), ia(`r${i}`)];
const hist = (n) => Array.from({ length: n }, (_, i) => par(i)).flat();

assert.equal(contarPerguntas([]), 0);
assert.equal(contarPerguntas(hist(3)), 3);
// toolResult é role "user", mas não é pergunta do usuário
assert.equal(contarPerguntas([user("a"), toolUse, toolResult, ia("b")]), 1);

assert.equal(passouDoLimite(hist(3), 4), false);
assert.equal(passouDoLimite(hist(4), 4), true); // a 5ª pergunta já recebe a mensagem fixa

assert.equal(mensagemLimite("oi", "https://lnkd.in/x"), MSG_DEFAULT_MAX_MSGS.replace("{LINK_POST}", "https://lnkd.in/x"));
assert.ok(!mensagemLimite("oi", "https://lnkd.in/x").includes("{LINK_POST}"));
assert.ok(MSG_DEFAULT_MAX_MSGS.includes("diagrama animado"));
assert.ok(MSG_DEFAULT_MAX_MSGS.includes("exemplos"));

// idioma
assert.equal(detectarIdioma("What is the cost of this?"), "en");
assert.equal(detectarIdioma("how do you work"), "en");
assert.equal(detectarIdioma("Quero saber como você funciona"), "pt");
assert.equal(detectarIdioma("ok"), "pt");
assert.equal(detectarIdioma(""), "pt");
assert.equal(detectarIdioma(undefined), "pt");
assert.ok(mensagemLimite("what is this", "https://lnkd.in/x").startsWith("You can head over"));
assert.ok(mensagemLimite("o que é isso", "https://lnkd.in/x").startsWith("Já dá"));
assert.ok(!mensagemLimite("hello you", "https://lnkd.in/x").includes("{LINK_POST}"));
console.log("ok: limite");
