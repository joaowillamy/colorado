#!/usr/bin/env bash
# Bloco 6: alunos de teste (os mesmos do v9). Sem atributo ttl, para o DynamoDB não apagá-los.
set -euo pipefail
source "$(dirname "$0")/env.sh"
exigir TABELA

aws dynamodb put-item --table-name "$TABELA" --item '{
  "pk": {"S": "ALUNO#maria@email.com"}, "nome": {"S": "Maria"},
  "ingresso": {"S": "VIP"}, "status": {"S": "confirmado"}, "pedido": {"S": "HP-88213"}}'
aws dynamodb put-item --table-name "$TABELA" --item '{
  "pk": {"S": "ALUNO#joao@email.com"}, "nome": {"S": "João"},
  "ingresso": {"S": "Normal"}, "status": {"S": "pendente"}, "pedido": {"S": "HP-77104"}}'

aws dynamodb get-item --table-name "$TABELA" --key '{"pk":{"S":"ALUNO#maria@email.com"}}' \
  --query 'Item.pedido.S' --output text | grep -q HP-88213
log "OK: bloco 6 concluído"
