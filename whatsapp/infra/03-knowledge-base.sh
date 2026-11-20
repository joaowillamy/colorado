#!/usr/bin/env bash
# Bloco 3: Knowledge Base GERENCIADO (embedding e reranker gerenciados) + data source S3 + ingestão.
# Reexecutável: se KB_ID/DS_ID já estiverem em .state.env, só refaz a ingestão.
set -euo pipefail
source "$(dirname "$0")/env.sh"
exigir BUCKET_DOCS

KB_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$KB_ROLE_NAME"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

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
  sleep 15
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
aws iam put-role-policy --role-name "$KB_ROLE_NAME" --policy-name kb-s3-read --policy-document "file://$TMP/s3.json"

# ── Knowledge Base ────────────────────────────────────────────────────────
if [ -z "${KB_ID:-}" ]; then
  log "Criando Knowledge Base gerenciado"
  echo '{"type":"MANAGED","managedKnowledgeBaseConfiguration":{"embeddingModelType":"MANAGED"}}' > "$TMP/kb.json"
  KB_ID=$(aws bedrock-agent create-knowledge-base \
    --name "${PROJ}-kb" --description "Documentos da Imersao e da Formacao AWS" \
    --role-arn "$KB_ROLE_ARN" --knowledge-base-configuration "file://$TMP/kb.json" \
    --query 'knowledgeBase.knowledgeBaseId' --output text)
  salvar KB_ID "$KB_ID"
fi
log "KB_ID=$KB_ID, aguardando ACTIVE"
for _ in $(seq 1 40); do
  ST=$(aws bedrock-agent get-knowledge-base --knowledge-base-id "$KB_ID" --query 'knowledgeBase.status' --output text)
  [ "$ST" = "ACTIVE" ] && break
  [ "$ST" = "FAILED" ] && { echo "ERRO: KB em FAILED" >&2; exit 1; }
  sleep 15
done
[ "$ST" = "ACTIVE" ] || { echo "ERRO: KB não ficou ACTIVE a tempo (status $ST)" >&2; exit 1; }

# ── Data source S3 ────────────────────────────────────────────────────────
if [ -z "${DS_ID:-}" ]; then
  log "Criando data source S3"
  cat > "$TMP/ds.json" <<JSON
{ "type": "MANAGED_KNOWLEDGE_BASE_CONNECTOR",
  "managedKnowledgeBaseConnectorConfiguration": {
    "connectorParameters": {
      "type": "S3", "version": "1",
      "connectionConfiguration": { "bucketName": "$BUCKET_DOCS", "bucketOwnerAccountId": "$ACCOUNT_ID" },
      "deletionProtectionConfiguration": { "enableDeletionProtection": false } } } }
JSON
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

# ── Verificação: o documento do VIP precisa aparecer ──────────────────────
log "Retrieve de teste"
OUT=$(aws bedrock-agent-runtime retrieve --knowledge-base-id "$KB_ID" \
  --retrieval-query '{"text":"Quanto custa o ingresso VIP?"}' \
  --retrieval-configuration '{"managedSearchConfiguration":{"numberOfResults":5,"rerankingModelType":"MANAGED"}}' \
  --query 'retrievalResults[].{score:score,fonte:location.s3Location.uri}' --output json)
echo "$OUT"
echo "$OUT" | grep -q "ingresso-vip-preco-e-inclusos" \
  || { echo "ERRO: documento do VIP não apareceu no top 5" >&2; exit 1; }
log "OK: bloco 3 concluído"
