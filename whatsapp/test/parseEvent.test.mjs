// Teste de fumaça do parser: node test/parseEvent.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extrairMensagens } from "../src/parseEvent.mjs";

const evento = JSON.parse(readFileSync(new URL("../events/sqs-sns-mensagem.json", import.meta.url)));
const [m] = extrairMensagens(evento.Records[0]);

assert.equal(m.telefone, "14255550150");
assert.equal(m.nome, "Diego");
assert.equal(m.texto, "Quanto custa o ingresso VIP?");
assert.equal(m.messageId, "wamid.EXEMPLO1");
assert.equal(m.timestamp, 1723506035);
assert.equal(m.phoneNumberId, "phone-number-id-976c72a700aac43eaf573ae050example");
assert.equal(m.sqsMessageId, "sqs-0001");
console.log("ok: parseEvent");
