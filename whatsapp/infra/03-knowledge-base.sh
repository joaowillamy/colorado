#!/usr/bin/env bash
# Bloco 3: Knowledge Base com S3 Vectors (tipo VECTOR, embedding Titan v2) + data source S3 + ingestão.
# (O KB gerenciado não existe em us-east-2, por isso usamos S3 Vectors.)
# Reexecutável: se KB_ID/DS_ID já estiverem em .state.env, só refaz a ingestão.
set -euo pipefail
source "$(dirname "$0")/env.sh"
exigir BUCKET_DOCS

KB_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$KB_ROLE_NAME"
INDEX_ARN="arn:aws:s3vectors:$AWS_REGION:$ACCOUNT_ID:bucket/$VECTOR_BUCKET/index/$VECTOR_INDEX"
EMBED_ARN="arn:aws:bedrock:$AWS_REGION::foundation-model/$EMBED_MODEL_ID"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ── Vector bucket e índice (S3 Vectors) ───────────────────────────────────
if aws s3vectors get-vector-bucket --vector-bucket-name "$VECTOR_BUCKET" >/dev/null 2>&1; then
  log "Vector bucket $VECTOR_BUCKET já existe"
else
  log "Criando vector bucket $VECTOR_BUCKET"
  aws s3vectors create-vector-bucket --vector-bucket-name "$VECTOR_BUCKET"
fi
if aws s3vectors get-index --vector-bucket-name "$VECTOR_BUCKET" --index-name "$VECTOR_INDEX" >/dev/null 2>&1; then
  log "Índice $VECTOR_INDEX já existe"
else
  log "Criando índice $VECTOR_INDEX (dimensão $EMBED_DIM, cosine, float32)"
  aws s3vectors create-index --vector-bucket-name "$VECTOR_BUCKET" --index-name "$VECTOR_INDEX" \
    --data-type float32 --dimension "$EMBED_DIM" --distance-metric cosine \
    --metadata-configuration '{"nonFilterableMetadataKeys":["AMAZON_BEDROCK_METADATA","AMAZON_BEDROCK_TEXT"]}'
fi
salvar VECTOR_BUCKET "$VECTOR_BUCKET"

# ── IAM role do KB ────────────────────────────────────────────────────────
if aws iam get-role --role-name "$KB_ROLE_NAME" >/dev/null 2>&1; then
  log "Role $KB_ROLE_NAME já existe"
else
  log "Criando role $KB_ROLE_NAME"
  cat > "$TMP/trust.json" <<JSON
{ "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "bedrock.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "$ACCOUNT_ID" },
      "ArnLike": { "aws:SourceArn": "arn:aws:bedrock:$AWS_REGION:$ACCOUNT_ID:knowledge-base/*" } } }] }
JSON
  aws iam create-role --role-name "$KB_ROLE_NAME" --assume-role-policy-document "file://$TMP/trust.json" >/dev/null
fi

cat > "$TMP/s3.json" <<JSON
{ "Version": "2012-10-17",
  "Statement": [
    { "Sid": "S3List", "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::$BUCKET_DOCS",
      "Condition": { "StringEquals": { "aws:ResourceAccount": "$ACCOUNT_ID" } } },
    { "Sid": "S3Get", "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::$BUCKET_DOCS/*",
      "Condition": { "StringEquals": { "aws:ResourceAccount": "$ACCOUNT_ID" } } } ] }
JSON
cat > "$TMP/embed.json" <<JSON
{ "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["bedrock:ListFoundationModels", "bedrock:ListCustomModels"], "Resource": "*" },
    { "Effect": "Allow", "Action": "bedrock:InvokeModel", "Resource": "$EMBED_ARN" } ] }
JSON
cat > "$TMP/vectors.json" <<JSON
{ "Version": "2012-10-17",
  "Statement": [
    { "Sid": "S3VectorBucketReadAndWritePermission", "Effect": "Allow",
      "Action": ["s3vectors:PutVectors", "s3vectors:GetVectors", "s3vectors:DeleteVectors",
                 "s3vectors:QueryVectors", "s3vectors:GetIndex"],
      "Resource": "$INDEX_ARN" } ] }
JSON
aws iam put-role-policy --role-name "$KB_ROLE_NAME" --policy-name kb-s3-read      --policy-document "file://$TMP/s3.json"
aws iam put-role-policy --role-name "$KB_ROLE_NAME" --policy-name kb-embed-model  --policy-document "file://$TMP/embed.json"
aws iam put-role-policy --role-name "$KB_ROLE_NAME" --policy-name kb-s3-vectors   --policy-document "file://$TMP/vectors.json"
log "Aguardando propagação do IAM"; sleep 15

# ── Knowledge Base ────────────────────────────────────────────────────────
if [ -z "${KB_ID:-}" ]; then
  log "Criando Knowledge Base (VECTOR + S3_VECTORS)"
  cat > "$TMP/kb.json" <<JSON
{ "type": "VECTOR",
  "vectorKnowledgeBaseConfiguration": {
    "embeddingModelArn": "$EMBED_ARN",
    "embeddingModelConfiguration": {
      "bedrockEmbeddingModelConfiguration": { "dimensions": $EMBED_DIM, "embeddingDataType": "FLOAT32" } } } }
JSON
  echo "{\"type\":\"S3_VECTORS\",\"s3VectorsConfiguration\":{\"indexArn\":\"$INDEX_ARN\"}}" > "$TMP/storage.json"
  KB_ID=$(aws bedrock-agent create-knowledge-base \
    --name "${PROJ}-kb" --description "Documentos da Imersao e da Formacao do Joao Willamy" \
    --role-arn "$KB_ROLE_ARN" \
    --knowledge-base-configuration "file://$TMP/kb.json" \
    --storage-configuration "file://$TMP/storage.json" \
    --query 'knowledgeBase.knowledgeBaseId' --output text)
  salvar KB_ID "$KB_ID"
fi
log "KB_ID=$KB_ID, aguardando ACTIVE"
for _ in $(seq 1 40); do
  ST=$(aws bedrock-agent get-knowledge-base --knowledge-base-id "$KB_ID" --query 'knowledgeBase.status' --output text)
  [ "$ST" = "ACTIVE" ] && break
  [ "$ST" = "FAILED" ] && { echo "ERRO: KB em FAILED" >&2; exit 1; }
  sleep 10
done
[ "$ST" = "ACTIVE" ] || { echo "ERRO: KB não ficou ACTIVE a tempo (status $ST)" >&2; exit 1; }

# ── Data source S3 ────────────────────────────────────────────────────────
if [ -z "${DS_ID:-}" ]; then
  log "Criando data source S3"
  echo "{\"type\":\"S3\",\"s3Configuration\":{\"bucketArn\":\"arn:aws:s3:::$BUCKET_DOCS\"}}" > "$TMP/ds.json"
  DS_ID=$(aws bedrock-agent create-data-source --knowledge-base-id "$KB_ID" --name s3-docs-rag-v2 \
    --data-source-configuration "file://$TMP/ds.json" --data-deletion-policy DELETE \
    --query 'dataSource.dataSourceId' --output text)
  salvar DS_ID "$DS_ID"
fi

# ── Ingestão ──────────────────────────────────────────────────────────────
log "Iniciando ingestão"
JOB=$(aws bedrock-agent start-ingestion-job --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" \
  --query 'ingestionJob.ingestionJobId' --output text)
for _ in $(seq 1 60); do
  ST=$(aws bedrock-agent get-ingestion-job --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" \
    --ingestion-job-id "$JOB" --query 'ingestionJob.status' --output text)
  [ "$ST" = "COMPLETE" ] && break
  [ "$ST" = "FAILED" ] && {
    aws bedrock-agent get-ingestion-job --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" \
      --ingestion-job-id "$JOB" --query 'ingestionJob.failureReasons' >&2
    exit 1; }
  sleep 10
done
[ "$ST" = "COMPLETE" ] || { echo "ERRO: ingestão não terminou (status $ST)" >&2; exit 1; }
aws bedrock-agent get-ingestion-job --knowledge-base-id "$KB_ID" --data-source-id "$DS_ID" \
  --ingestion-job-id "$JOB" --query 'ingestionJob.statistics'

# ── Verificação: o documento do fluxo precisa aparecer ──────────────────────
log "Retrieve de teste"
OUT=$(aws bedrock-agent-runtime retrieve --knowledge-base-id "$KB_ID" \
  --retrieval-query '{"text":"Como você foi construída? Qual o fluxo de uma mensagem?"}' \
  --retrieval-configuration '{"vectorSearchConfiguration":{"numberOfResults":5}}' \
  --query 'retrievalResults[].{score:score,fonte:location.s3Location.uri}' --output json)
echo "$OUT"
echo "$OUT" | grep -q "01-visao-geral-e-fluxo" \
  || { echo "ERRO: documento do fluxo não apareceu no top 5" >&2; exit 1; }
log "OK: bloco 3 concluído"
