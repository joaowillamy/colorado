#!/usr/bin/env bash
# Bloco 8: teste de fumaça SEM WhatsApp. Injeta o evento de exemplo na fila.
# O envio final falha de propósito (telefone fictício), mas os logs "rag" e "uso_tokens"
# provam SQS -> Lambda -> KB -> Bedrock -> DynamoDB. A mensagem vai a retry e depois à DLQ:
# o script limpa fila e DLQ no final.
set -euo pipefail
source "$(dirname "$0")/env.sh"
exigir FILA_URL DLQ_URL FUNCAO

BODY=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['Records'][0]['body'])" \
  "$WHATSAPP_DIR/events/sqs-sns-mensagem.json")
aws sqs send-message --queue-url "$FILA_URL" --message-body "$BODY" --query MessageId --output text

log "Aguardando 45 s pelos logs"
sleep 45
aws logs tail "/aws/lambda/$FUNCAO" --since 3m --format short | grep -E '"evento":"(rag|uso_tokens|guardrail|erro)"' || \
  echo "Nenhum log encontrado. Veja: aws logs tail /aws/lambda/$FUNCAO --since 10m"

log "Limpando fila e DLQ"
aws sqs purge-queue --queue-url "$FILA_URL" || true
aws sqs purge-queue --queue-url "$DLQ_URL" || true
