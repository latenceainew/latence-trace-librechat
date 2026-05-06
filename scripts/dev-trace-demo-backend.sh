#!/usr/bin/env bash
# Start the lean local LibreChat dev backend for the TRACE demo.
#
# Two pieces in one process tree:
#   1) `fly proxy 27017 -a latenceai-trace-mongo` so :27017 -> deployed Fly Mongo
#   2) the LibreChat Node API on :3080 with LATENCE_DEMO_DISABLE_AUTH=true
#
# This is the second of four scripts in the lean local TRACE loop:
#   1. ./scripts/dev-trace-demo-backend.sh   (this script)
#   2. ./scripts/dev-trace-demo-bridge.sh    (TRACE bridge -> RunPod)
#   3. ./scripts/dev-trace-demo.sh           (Vite frontend)
#   4. ./scripts/dev-trace-demo-tunnel.sh    (cloudflared)
#
# Secrets live in scripts/.env.dev-trace-demo (gitignored). Copy from
# scripts/.env.dev-trace-demo.example and fill the values once - they
# match what is set on Fly via `fly secrets list -a latenceai-trace-demo`
# and `fly secrets list -a latenceai-trace-mongo`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-scripts/.env.dev-trace-demo}"
if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<EOF
[trace-demo backend] ERROR: $ENV_FILE not found.
Copy scripts/.env.dev-trace-demo.example to $ENV_FILE and fill in the secrets:
  cp scripts/.env.dev-trace-demo.example $ENV_FILE
  \$EDITOR $ENV_FILE
EOF
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${MONGO_USERNAME:?missing MONGO_USERNAME}"
: "${MONGO_PASSWORD:?missing MONGO_PASSWORD}"
: "${JWT_SECRET:?missing JWT_SECRET}"
: "${JWT_REFRESH_SECRET:?missing JWT_REFRESH_SECRET}"
: "${CREDS_KEY:?missing CREDS_KEY}"
: "${CREDS_IV:?missing CREDS_IV}"
: "${OPENROUTER_KEY:?missing OPENROUTER_KEY}"

export FLYCTL_INSTALL="${FLYCTL_INSTALL:-/root/.fly}"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

cleanup() {
  if [[ -n "${FLY_PROXY_PID:-}" ]] && kill -0 "$FLY_PROXY_PID" 2>/dev/null; then
    kill "$FLY_PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if ss -ltn 2>/dev/null | grep -qE ':27017\b'; then
  echo "[trace-demo backend] :27017 already listening - assuming an existing fly proxy is healthy"
else
  echo "[trace-demo backend] starting fly proxy 27017 -> latenceai-trace-mongo.internal"
  fly proxy 27017 -a latenceai-trace-mongo &
  FLY_PROXY_PID=$!
  for _ in {1..20}; do
    if ss -ltn 2>/dev/null | grep -qE ':27017\b'; then break; fi
    sleep 0.5
  done
  if ! ss -ltn 2>/dev/null | grep -qE ':27017\b'; then
    echo "[trace-demo backend] ERROR: fly proxy 27017 did not come up" >&2
    exit 1
  fi
fi

export MONGO_URI="${MONGO_URI:-mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@127.0.0.1:27017/LibreChat?authSource=admin&directConnection=true}"
export JWT_SECRET JWT_REFRESH_SECRET CREDS_KEY CREDS_IV OPENROUTER_KEY
export LATENCE_DEMO_DISABLE_AUTH="${LATENCE_DEMO_DISABLE_AUTH:-true}"
export LATENCE_DEMO_USER_EMAIL="${LATENCE_DEMO_USER_EMAIL:-demo+trace@latence.ai}"
export LATENCE_DEMO_USER_NAME="${LATENCE_DEMO_USER_NAME:-Latence TRACE Demo}"
export LATENCE_DEMO_MODE="${LATENCE_DEMO_MODE:-true}"
export TRACE_DEMO_BRIDGE_URL="${TRACE_DEMO_BRIDGE_URL:-https://latenceai-trace-bridge.fly.dev}"
export CONFIG_PATH="${CONFIG_PATH:-$REPO_ROOT/librechat.yaml}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3080}"
export ALLOW_REGISTRATION="${ALLOW_REGISTRATION:-false}"
export ALLOW_EMAIL_LOGIN="${ALLOW_EMAIL_LOGIN:-false}"
export ALLOW_SOCIAL_LOGIN="${ALLOW_SOCIAL_LOGIN:-false}"
export DOMAIN_CLIENT="${DOMAIN_CLIENT:-http://localhost:3090}"
export DOMAIN_SERVER="${DOMAIN_SERVER:-http://localhost:$PORT}"

cat <<EOF
[trace-demo backend] starting LibreChat API:
  HOST=$HOST PORT=$PORT
  CONFIG_PATH=$CONFIG_PATH
  LATENCE_DEMO_DISABLE_AUTH=$LATENCE_DEMO_DISABLE_AUTH
  LATENCE_DEMO_USER_EMAIL=$LATENCE_DEMO_USER_EMAIL
  MONGO_URI=mongodb://*****@127.0.0.1:27017/LibreChat?authSource=admin&directConnection=true
EOF

exec npm run backend:dev
