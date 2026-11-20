// Guardrail: mesma ideia do v9, só que o log vai para o CloudWatch (JSON).

import { config } from "./config.mjs";

export const guardrailConfig =
  config.guardrailId === "off"
    ? undefined
    : {
        guardrailIdentifier: config.guardrailId,
        guardrailVersion: config.guardrailVersion,
        trace: "enabled", // sem isso você sabe QUE bloqueou, mas não POR QUE
      };

// Devolve uma lista de achados ("entrada: EMAIL · ANONYMIZED") para logar.
export function achadosDoGuardrail(trace) {
  const g = trace?.guardrail;
  if (!g) return [];

  const achados = [];
  for (const [lado, mapa] of [
    ["entrada", g.inputAssessment],
    ["saida", g.outputAssessments],
  ]) {
    for (const a of Object.values(mapa ?? {}).flat()) {
      const s = a.sensitiveInformationPolicy;
      for (const f of a.contentPolicy?.filters ?? []) achados.push(`${lado}: ${f.type} · ${f.action}`);
      for (const p of s?.piiEntities ?? []) achados.push(`${lado}: ${p.type} · ${p.action}`);
      for (const r of s?.regexes ?? []) achados.push(`${lado}: ${r.name} · ${r.action}`);
    }
  }
  return achados;
}
