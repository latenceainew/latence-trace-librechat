#!/usr/bin/env bash
# Start the LibreChat Vite dev server in TRACE-demo no-auth mode.
#
# Mirrors the env that the Fly Dockerfile bakes into the production image
# (see Dockerfile + .github/workflows/fly-deploy-demo.yml). Without these
# vars the local frontend silently falls back to the standard auth-required
# flow and chat submit fails with no obvious error.
#
# Usage:
#   ./scripts/dev-trace-demo.sh                   # defaults below
#   PORT=3091 ./scripts/dev-trace-demo.sh         # override any var
#
# Defaults:
#   PORT                          3090
#   HOST                          0.0.0.0
#   DEV_API_PROXY_TARGET          https://latenceai-trace-demo.fly.dev   (Fly LibreChat backend)
#   TRACE_DEMO_BRIDGE_DEV_URL     http://127.0.0.1:8788                  (local bridge for HMR iteration)
#   VITE_TRACE_DEMO_BRIDGE_URL    https://latenceai-trace-bridge.fly.dev (inlined Vite var; fallback bridge)
#   VITE_LATENCE_DEMO_DISABLE_AUTH=true
#   VITE_ALLOWED_HOSTS=.trycloudflare.com,localhost  (so a quick tunnel works out of the box)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PORT="${PORT:-3090}"
export HOST="${HOST:-0.0.0.0}"
export DEV_API_PROXY_TARGET="${DEV_API_PROXY_TARGET:-https://latenceai-trace-demo.fly.dev}"
export TRACE_DEMO_BRIDGE_DEV_URL="${TRACE_DEMO_BRIDGE_DEV_URL:-http://127.0.0.1:8788}"
export VITE_TRACE_DEMO_BRIDGE_URL="${VITE_TRACE_DEMO_BRIDGE_URL:-https://latenceai-trace-bridge.fly.dev}"
export VITE_LATENCE_DEMO_DISABLE_AUTH="${VITE_LATENCE_DEMO_DISABLE_AUTH:-true}"
export VITE_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS:-.trycloudflare.com,localhost}"

cat <<EOF
[trace-demo dev] starting Vite with:
  PORT=$PORT HOST=$HOST
  DEV_API_PROXY_TARGET=$DEV_API_PROXY_TARGET
  TRACE_DEMO_BRIDGE_DEV_URL=$TRACE_DEMO_BRIDGE_DEV_URL
  VITE_TRACE_DEMO_BRIDGE_URL=$VITE_TRACE_DEMO_BRIDGE_URL
  VITE_LATENCE_DEMO_DISABLE_AUTH=$VITE_LATENCE_DEMO_DISABLE_AUTH
  VITE_ALLOWED_HOSTS=$VITE_ALLOWED_HOSTS

Open http://localhost:$PORT/trace-demo (or your Cloudflare tunnel pointed at $PORT).
For the public tunnel run in a second terminal:
  cloudflared tunnel --url http://localhost:$PORT --http-host-header localhost:$PORT
EOF

exec npm run frontend:dev
