#!/usr/bin/env bash
# Start the local TRACE demo bridge (FastAPI on :8788) pointing at RunPod.
#
# Third of four scripts in the lean local TRACE loop:
#   1. ./scripts/dev-trace-demo-backend.sh
#   2. ./scripts/dev-trace-demo-bridge.sh   (this script)
#   3. ./scripts/dev-trace-demo.sh
#   4. ./scripts/dev-trace-demo-tunnel.sh
#
# Reads RunPod credentials from scripts/.env.dev-trace-demo.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/demo-bridge"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/scripts/.env.dev-trace-demo}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[trace-demo bridge] ERROR: $ENV_FILE not found. See scripts/.env.dev-trace-demo.example." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${LATENCE_TRACE_URL:?missing LATENCE_TRACE_URL}"
: "${LATENCE_TRACE_API_KEY:?missing LATENCE_TRACE_API_KEY}"

export LATENCE_TRACE_URL
export LATENCE_TRACE_DEPLOYMENT="${LATENCE_TRACE_DEPLOYMENT:-runpod}"
export LATENCE_TRACE_API_KEY
export LATENCE_TRACE_TIMEOUT="${LATENCE_TRACE_TIMEOUT:-600}"
export TRACE_DEMO_CATALOGUE_ROOT="${TRACE_DEMO_CATALOGUE_ROOT:-$REPO_ROOT/docs/trace-catalogue}"
export PYTHONPATH="${PYTHONPATH:-/workspace/latence-trace-python/src:.}"

BRIDGE_HOST="${BRIDGE_HOST:-127.0.0.1}"
BRIDGE_PORT="${BRIDGE_PORT:-8788}"

cat <<EOF
[trace-demo bridge] starting demo-bridge on http://$BRIDGE_HOST:$BRIDGE_PORT
  LATENCE_TRACE_URL=$LATENCE_TRACE_URL
  LATENCE_TRACE_DEPLOYMENT=$LATENCE_TRACE_DEPLOYMENT
  TRACE_DEMO_CATALOGUE_ROOT=$TRACE_DEMO_CATALOGUE_ROOT
EOF

exec python -m uvicorn demo_bridge.main:app --host "$BRIDGE_HOST" --port "$BRIDGE_PORT"
