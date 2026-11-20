#!/usr/bin/env bash
# Roda os blocos automáticos em ordem. O bloco 7 (WhatsApp) é manual e fica de fora:
# rode ./07-whatsapp.sh depois do 05. Peça confirmação ao usuário antes de executar.
set -euo pipefail
cd "$(dirname "$0")"
for s in 01-bedrock 02-s3-docs 03-knowledge-base 04-guardrail 05-deploy-stack 06-seed-dynamodb; do
  echo "================ $s"
  ./$s.sh
done
echo "Próximo passo manual: ./07-whatsapp.sh   (depois: ./08-smoke-test.sh)"
