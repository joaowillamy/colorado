import assert from "node:assert/strict";
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

assert.equal(passouDoLimite(hist(7), 8), false);
assert.equal(passouDoLimite(hist(8), 8), true); // a 9ª pergunta já é bloqueada

assert.equal(mensagemLimite("https://lnkd.in/x"), MSG_DEFAULT_MAX_MSGS.replace("{LINK_POST}", "https://lnkd.in/x"));
assert.ok(!mensagemLimite("https://lnkd.in/x").includes("{LINK_POST}"));
console.log("ok: limite");
