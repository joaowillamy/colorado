import assert from "node:assert/strict";
import { alarmeDisparou } from "../src/disjuntor.mjs";

const ev = (msg) => ({ Records: [{ Sns: { Message: typeof msg === "string" ? msg : JSON.stringify(msg) } }] });

assert.equal(alarmeDisparou(ev({ NewStateValue: "ALARM" })), true);
assert.equal(alarmeDisparou(ev({ NewStateValue: "OK" })), false);
assert.equal(alarmeDisparou(ev("não é json")), false);
assert.equal(alarmeDisparou({}), false);
console.log("ok: disjuntor");
