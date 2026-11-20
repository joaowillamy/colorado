#!/usr/bin/env bash
# Bloco 4: cria o guardrail (infra/guardrail.json), publica uma versão numerada e testa.
# Reexecutável: se GUARDRAIL_ID já existe em .state.env, não recria. Para mudar regras,
# edite guardrail.json, rode `aws bedrock update-guardrail` e crie nova versão (ou apague o
# guardrail e remova GUARDRAIL_ID/GUARDRAIL_VERSION do .state.env).
set -euo pipefail
source "$(dirname "$0")/env.sh"

if [ -z "${GUARDRAIL_ID:-}" ]; then
  log "Criando guardrail"
  GUARDRAIL_ID=$(aws bedrock create-guardrail --cli-input-json "file://$INFRA_DIR/guardrail.json" \
    --query guardrailId --output text)
  salvar GUARDRAIL_ID "$GUARDRAIL_ID"
fi

if [ -z "${GUARDRAIL_VERSION:-}" ]; then
  log "Publicando versão (congela o comportamento; DRAFT muda a cada edição)"
  V=$(aws bedrock create-guardrail-version --guardrail-identifier "$GUARDRAIL_ID" --query version --output text)
  salvar GUARDRAIL_VERSION "$V"
fi
log "Guardrail $GUARDRAIL_ID versão $GUARDRAIL_VERSION"

testar() { # texto esperado
  local a
  a=$(aws bedrock-runtime apply-guardrail --guardrail-identifier "$GUARDRAIL_ID" \
    --guardrail-version "$GUARDRAIL_VERSION" --source INPUT \
    --content "[{\"text\":{\"text\":\"$1\"}}]" --query action --output text)
  echo "  '$1' -> $a (esperado $2)"
  [ "$a" = "$2" ] || { echo "ERRO: guardrail com comportamento inesperado" >&2; exit 1; }
}
testar "meu cartao e 4111 1111 1111 1111" GUARDRAIL_INTERVENED
testar "quero pagar, meu email e joao@email.com" NONE
testar "quanto custa o ingresso VIP?" NONE
log "OK: bloco 4 concluído"
