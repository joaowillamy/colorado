#!/usr/bin/env bash
# Sobe uma nova versão do código da Lambda (src/, prompt.txt, dependências).
# Use depois de alterar o prompt.txt ou qualquer arquivo de src/.
#
#   ./deploy-lambda.sh
#
# Não serve para documentos do RAG (docs-rag-v2/): para eles rode
# ./02-s3-docs.sh e ./03-knowledge-base.sh.
set -euo pipefail
source "$(dirname "$0")/env.sh"
exigir KB_ID GUARDRAIL_ID GUARDRAIL_VERSION FUNCAO

cd "$WHATSAPP_DIR"

log "Testes"
npm install --no-audit --no-fund --silent
npm test

log "Build"
sam build

log "Deploy do stack $STACK em $AWS_REGION"
sam deploy \
  --stack-name "$STACK" --region "$AWS_REGION" \
  --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides \
    "KbId=$KB_ID" "GuardrailId=$GUARDRAIL_ID" "GuardrailVersion=$GUARDRAIL_VERSION" "ModelId=$MODEL_ID"

log "Versão no ar"
aws lambda get-function-configuration --function-name "$FUNCAO" \
  --query '{ultimaAlteracao:LastModified,sha256:CodeSha256,estado:LastUpdateStatus}' --output table
log "OK: nova versão publicada. Vale a partir da próxima mensagem."
