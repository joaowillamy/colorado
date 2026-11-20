#!/usr/bin/env bash
# Remove tudo (ordem inversa). DESTRUTIVO: exige digitar o nome do stack.
# A WABA e o número na Meta/WhatsApp NÃO são removidos aqui (desvincule no console).
set -euo pipefail
source "$(dirname "$0")/env.sh"

echo "Isto apaga: stack $STACK, guardrail, KB, role do KB e o bucket $BUCKET_DOCS."
read -r -p "Digite o nome do stack para confirmar: " R
[ "$R" = "$STACK" ] || { echo "Cancelado."; exit 1; }

sam delete --stack-name "$STACK" --region "$AWS_REGION" --no-prompts || true
[ -n "${GUARDRAIL_ID:-}" ] && aws bedrock delete-guardrail --guardrail-identifier "$GUARDRAIL_ID" || true
if [ -n "${KB_ID:-}" ]; then
  [ -n "${DS_ID:-}" ] && aws bedrock-agent delete-data-source --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" || true
  aws bedrock-agent delete-knowledge-base --knowledge-base-id "$KB_ID" || true
fi
aws iam delete-role-policy --role-name "$KB_ROLE_NAME" --policy-name kb-s3-read 2>/dev/null || true
aws iam delete-role --role-name "$KB_ROLE_NAME" 2>/dev/null || true
aws s3 rb "s3://$BUCKET_DOCS" --force || true
rm -f "$STATE_FILE"
log "Concluído"
