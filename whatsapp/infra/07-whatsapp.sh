#!/usr/bin/env bash
# Bloco 7: WhatsApp. O cadastro é MANUAL (login na Meta, código por SMS/voz). Este script
# só imprime o que você precisa e confere o resultado depois.
#   ./07-whatsapp.sh          mostra o roteiro
#   ./07-whatsapp.sh check    confere se a WABA está vinculada
set -euo pipefail
source "$(dirname "$0")/env.sh"
exigir TOPIC_ARN

if [ "${1:-}" = "check" ]; then
  aws socialmessaging list-linked-whatsapp-business-accounts --region "$AWS_REGION" \
    --query 'linkedAccounts[].{waba:arn,registro:registrationStatus}' --output table
  exit 0
fi

cat <<TXT
Roteiro manual (console AWS End User Messaging > Social messaging):

 1. Tenha um número DEDICADO (nunca usado no WhatsApp, ou com a conta de WhatsApp já excluída)
    que receba SMS ou ligação. Não use o número pessoal.
 2. Add WhatsApp phone number > Launch Facebook portal > entre na Meta, escolha/crie a WABA.
 3. Informe o número, verifique por SMS ou voz, defina um PIN (guarde).
 4. Ligue "Message and event publishing" > Amazon SNS > tópico padrão:

      $TOPIC_ARN

 5. Add phone number. Depois rode:  ./07-whatsapp.sh check
 6. Guarde o phone-number-id (arn ...:phone-number-id/XXXX). O código deriva o ID do evento;
    só defina ORIGINATION_PHONE_NUMBER_ID na Lambda se o envio rejeitar o formato.
TXT
