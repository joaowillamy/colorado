#!/usr/bin/env bash
# Bloco 5: instala dependências, roda o teste do parser, faz build e deploy do stack SAM
# (SNS + policy do tópico, SQS + DLQ, DynamoDB, Lambda, IAM) e grava as saídas em .state.env.
set -euo pipefail
source "$(dirname "$0")/env.sh"
exigir KB_ID GUARDRAIL_ID GUARDRAIL_VERSION

# Aviso: ReservedConcurrentExecutions=10 exige >= 10 de concorrência NÃO reservada na conta.
read -r TOTAL LIVRE < <(aws lambda get-account-settings \
  --query 'AccountLimit.[ConcurrentExecutions,UnreservedConcurrentExecutions]' --output text)
log "Concorrência da conta: total=$TOTAL, não reservada=$LIVRE"
if [ "$LIVRE" -lt 20 ]; then
  echo "AVISO: pouca concorrência livre. O deploy pode falhar com a reserva de 10." >&2
  echo "       Peça aumento de cota ou reduza ReservedConcurrentExecutions no template.yaml." >&2
  [ "${FORCAR:-0}" = "1" ] || { echo "Rode com FORCAR=1 para tentar mesmo assim." >&2; exit 1; }
fi

cd "$WHATSAPP_DIR"
npm install --no-audit --no-fund
npm test
sam build
sam deploy \
  --stack-name "$STACK" --region "$AWS_REGION" \
  --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides \
    "KbId=$KB_ID" "GuardrailId=$GUARDRAIL_ID" "GuardrailVersion=$GUARDRAIL_VERSION" "ModelId=$MODEL_ID"

saida() { aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
fisico() { aws cloudformation describe-stack-resource --stack-name "$STACK" \
  --logical-resource-id "$1" --query StackResourceDetail.PhysicalResourceId --output text; }

salvar TOPIC_ARN "$(saida TopicoArn)"
salvar DLQ_URL   "$(saida DlqUrl)"
salvar TABELA    "$(fisico Tabela)"
salvar FILA_URL  "$(fisico Fila)"
salvar FUNCAO    "$(fisico Funcao)"

log "Verificando"
aws sns get-topic-attributes --topic-arn "$TOPIC_ARN" --query 'Attributes.Policy' --output text \
  | grep -q "social-messaging.amazonaws.com" || { echo "ERRO: policy do tópico sem o End User Messaging" >&2; exit 1; }
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --query 'Subscriptions[].[Protocol,SubscriptionArn]' --output text
aws lambda get-function-configuration --function-name "$FUNCAO" \
  --query 'Environment.Variables.{KB_ID:KB_ID,GUARDRAIL_ID:GUARDRAIL_ID,GUARDRAIL_VERSION:GUARDRAIL_VERSION,TABELA:TABELA}'
log "OK: bloco 5 concluído. Tópico para o WhatsApp: $TOPIC_ARN"
