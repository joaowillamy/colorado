#!/usr/bin/env bash
# Bloco 1: confere o acesso ao modelo (a primeira chamada dispara a assinatura no Marketplace).
# Antes (manual, console): formulário de caso de uso da Anthropic (modelos anteriores ao Opus 4.7).
set -euo pipefail
source "$(dirname "$0")/env.sh"

log "Inference profile $MODEL_ID"
aws bedrock get-inference-profile --inference-profile-identifier "$MODEL_ID" \
  --query '{id:inferenceProfileId,status:status}' --output table

log "Chamada de teste (Converse)"
RESP=$(aws bedrock-runtime converse --model-id "$MODEL_ID" \
  --messages '[{"role":"user","content":[{"text":"Responda apenas: ok"}]}]' \
  --inference-config '{"maxTokens":20}' \
  --query 'output.message.content[0].text' --output text)
echo "resposta: $RESP"
[ -n "$RESP" ] && log "OK: bloco 1 concluído" || { echo "ERRO: sem resposta do modelo" >&2; exit 1; }
