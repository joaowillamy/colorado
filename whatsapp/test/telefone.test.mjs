import assert from "node:assert/strict";
import { normalizarTelefone } from "../src/telefone.mjs";

assert.equal(normalizarTelefone("558892345678"), "+558892345678");
assert.equal(normalizarTelefone("+558892345678"), "+558892345678");
assert.equal(normalizarTelefone("14255550150"), "+14255550150");
assert.equal(normalizarTelefone(undefined), undefined);
console.log("ok: telefone");
