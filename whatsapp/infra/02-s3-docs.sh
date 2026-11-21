#!/usr/bin/env bash
# Bloco 2: bucket S3 e upload de docs-rag-v2/** (mantém as pastas imersao/ e formacao/).
# Reexecutável: o sync só envia o que mudou (e remove do bucket o que saiu da pasta local).
set -euo pipefail
source "$(dirname "$0")/env.sh"

[ -d "$DOCS_DIR" ] || { echo "ERRO: pasta não encontrada: $DOCS_DIR" >&2; exit 1; }

if aws s3api head-bucket --bucket "$BUCKET_DOCS" 2>/dev/null; then
  log "Bucket $BUCKET_DOCS já existe"
else
  log "Criando bucket $BUCKET_DOCS"
  # só us-east-1 não aceita --create-bucket-configuration
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET_DOCS"
  else
    aws s3api create-bucket --bucket "$BUCKET_DOCS" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION"
  fi
fi
aws s3api put-public-access-block --bucket "$BUCKET_DOCS" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

log "Enviando $DOCS_DIR"
aws s3 sync "$DOCS_DIR/" "s3://$BUCKET_DOCS/" --exclude ".*" --delete

N=$(aws s3 ls "s3://$BUCKET_DOCS/" --recursive | wc -l)
LOCAL=$(find "$DOCS_DIR" -type f -name '*.md' | wc -l)
log "Objetos no bucket: $N (locais: $LOCAL)"
[ "$N" -eq "$LOCAL" ] || { echo "ERRO: contagem diferente" >&2; exit 1; }
salvar BUCKET_DOCS "$BUCKET_DOCS"
log "OK: bloco 2 concluído"
