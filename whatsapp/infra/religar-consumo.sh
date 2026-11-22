#!/usr/bin/env bash
# Religa o consumo da fila depois que o disjuntor desligou (alarme de ataque).
#
#   ./religar-consumo.sh             mostra o estado e religa, processando o que acumulou
#   PURGAR=1 ./religar-consumo.sh    descarta TUDO que está na fila e depois religa
#
# PURGAR apaga também mensagens legítimas que chegaram durante o ataque.
# O SQS só permite um purge a cada 60 s e leva até 60 s para concluir.
set -euo pipefail
source "$(dirname "$0")/env.sh"
exigir FUNCAO FILA_URL

ESTADO() {
  aws lambda list-event-source-mappings --function-name "$FUNCAO" \
    --query 'EventSourceMappings[].{uuid:UUID,estado:State}' --output table
}

log "Estado atual"; ESTADO
log "Mensagens na fila: $(aws sqs get-queue-attributes --queue-url "$FILA_URL" \
  --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)"

if [ "${PURGAR:-0}" = "1" ]; then
  log "Descartando tudo que está na fila"
  aws sqs purge-queue --queue-url "$FILA_URL"
  sleep 60
fi

for UUID in $(aws lambda list-event-source-mappings --function-name "$FUNCAO" \
    --query 'EventSourceMappings[].UUID' --output text); do
  aws lambda update-event-source-mapping --uuid "$UUID" --enabled >/dev/null
done

# O alarme continua em ALARM até a métrica baixar; ele só dispara de novo ao
# passar por OK -> ALARM. Volta para OK para o disjuntor funcionar no próximo ataque.
aws cloudwatch set-alarm-state --alarm-name "${STACK}-ataque" --state-value OK \
  --state-reason "religado manualmente" 2>/dev/null || true

sleep 5; log "Estado depois"; ESTADO
