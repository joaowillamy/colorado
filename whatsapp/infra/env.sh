#!/usr/bin/env bash
# Variáveis e funções comuns. Não execute: os outros scripts fazem `source env.sh`.
# Estado entre scripts fica em infra/.state.env (ignorado pelo git).

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export WHATSAPP_DIR="$(cd "$INFRA_DIR/.." && pwd)"
export DOCS_DIR="${DOCS_DIR:-$(cd "$WHATSAPP_DIR/.." && pwd)/docs-rag-v3}"
STATE_FILE="$INFRA_DIR/.state.env"

export AWS_REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"
# export AWS_PROFILE=formacaoaws   # os scripts do curso usam este profile

export PROJ="${PROJ:-whatsapp-atendente}"
export STACK="${STACK:-whatsapp-atendente}"
export MODEL_ID="${MODEL_ID:-us.anthropic.claude-sonnet-4-6}"

export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export BUCKET_DOCS="${BUCKET_DOCS:-${PROJ}-docs-${ACCOUNT_ID}-${AWS_REGION}}"
export KB_ROLE_NAME="${PROJ}-kb-role"

# Knowledge Base com S3 Vectors (o KB gerenciado não existe em us-east-2)
export VECTOR_BUCKET="${VECTOR_BUCKET:-${PROJ}-vectors-${ACCOUNT_ID}-${AWS_REGION}}"
export VECTOR_INDEX="${VECTOR_INDEX:-docs-rag-v3}"
export EMBED_MODEL_ID="${EMBED_MODEL_ID:-amazon.titan-embed-text-v2:0}"
export EMBED_DIM="${EMBED_DIM:-1024}"

# carrega o que os scripts anteriores gravaram (KB_ID, GUARDRAIL_ID, ...)
# shellcheck disable=SC1090
[ -f "$STATE_FILE" ] && source "$STATE_FILE"

# salvar CHAVE VALOR: grava no arquivo de estado e exporta
salvar() {
  local k="$1" v="$2"
  touch "$STATE_FILE"
  grep -v "^export $k=" "$STATE_FILE" > "$STATE_FILE.tmp" || true
  echo "export $k=\"$v\"" >> "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  export "$k=$v"
}

# exigir VAR...: aborta se alguma variável estiver vazia
exigir() {
  for v in "$@"; do
    [ -n "${!v:-}" ] || { echo "ERRO: $v vazio. Rode antes o script que o define." >&2; exit 1; }
  done
}

log() { echo "[$(date +%H:%M:%S)] $*"; }
