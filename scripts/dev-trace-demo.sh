#!/usr/bin/env bash
# Start the LibreChat Vite dev server in TRACE-demo no-auth mode.
#
# This is one of four pieces of the lean local TRACE demo loop. Run each in
# its own terminal so you can see the logs and Ctrl-C cleanly:
#
#   1. ./scripts/dev-trace-demo-backend.sh   (fly proxy 27017 + Node backend on :3080)
#   2. ./scripts/dev-trace-demo-bridge.sh    (TRACE bridge on :8788 -> RunPod)
#   3. ./scripts/dev-trace-demo.sh           (this script, Vite on :3090)
#   4. ./scripts/dev-trace-demo-tunnel.sh    (cloudflared quick tunnel -> :3090)
#
# The Vite proxy points at http://localhost:3080 by default so the
# uncommitted backend code (DemoUser.js, librechat.yaml, etc.) is exercised
# end-to-end without a Fly redeploy. To proxy to the deployed Fly backend
# instead set DEV_API_PROXY_TARGET=https://latenceai-trace-demo.fly.dev,
# but be aware that any local backend changes will then be invisible.
#
# Defaults:
#   PORT                          3090
#   HOST                          0.0.0.0
#   BACKEND_PORT                  3080  (vite.config.ts default fallback target)
#   TRACE_DEMO_BRIDGE_DEV_URL     http://127.0.0.1:8788   (Vite proxy target for /trace-bridge)
#   VITE_TRACE_DEMO_BRIDGE_URL    <unset>                 (frontend then uses /trace-bridge proxy ->
#                                                         the LOCAL bridge above; set this only if you
#                                                         deliberately want to hit the deployed Fly bridge)
#   VITE_LATENCE_DEMO_DISABLE_AUTH=true
#   VITE_ALLOWED_HOSTS=.trycloudflare.com,localhost

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PORT="${PORT:-3090}"
export HOST="${HOST:-0.0.0.0}"
export BACKEND_PORT="${BACKEND_PORT:-3080}"
export TRACE_DEMO_BRIDGE_DEV_URL="${TRACE_DEMO_BRIDGE_DEV_URL:-http://127.0.0.1:8788}"
# Intentionally NOT exporting VITE_TRACE_DEMO_BRIDGE_URL: the frontend falls
# back to the relative '/trace-bridge' proxy so all bridge traffic goes to the
# LOCAL bridge above. Set VITE_TRACE_DEMO_BRIDGE_URL=https://... only when
# you explicitly want to test against the deployed Fly bridge.
if [[ -n "${VITE_TRACE_DEMO_BRIDGE_URL:-}" ]]; then
  export VITE_TRACE_DEMO_BRIDGE_URL
fi
export VITE_LATENCE_DEMO_DISABLE_AUTH="${VITE_LATENCE_DEMO_DISABLE_AUTH:-true}"
export VITE_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS:-.trycloudflare.com,localhost}"

# Preflight: warn loudly if upstream pieces are not running.
warn_missing() {
  printf '\n[trace-demo dev] WARNING: %s\n' "$1" >&2
}
if ! ss -ltn 2>/dev/null | grep -qE ":${BACKEND_PORT}\b"; then
  warn_missing "Backend not listening on :${BACKEND_PORT}. Run ./scripts/dev-trace-demo-backend.sh first."
fi
if ! ss -ltn 2>/dev/null | grep -qE ':8788\b'; then
  warn_missing "Bridge not listening on :8788. Run ./scripts/dev-trace-demo-bridge.sh first."
fi

cat <<EOF
[trace-demo dev] starting Vite with:
  PORT=$PORT HOST=$HOST BACKEND_PORT=$BACKEND_PORT
  DEV_API_PROXY_TARGET=${DEV_API_PROXY_TARGET:-<falls back to http://localhost:$BACKEND_PORT>}
  TRACE_DEMO_BRIDGE_DEV_URL=$TRACE_DEMO_BRIDGE_DEV_URL  (Vite proxies /trace-bridge here)
  VITE_TRACE_DEMO_BRIDGE_URL=${VITE_TRACE_DEMO_BRIDGE_URL:-<unset; using /trace-bridge proxy>}
  VITE_LATENCE_DEMO_DISABLE_AUTH=$VITE_LATENCE_DEMO_DISABLE_AUTH
  VITE_ALLOWED_HOSTS=$VITE_ALLOWED_HOSTS

Open http://localhost:$PORT/trace-demo (or your Cloudflare tunnel pointed at $PORT).
EOF

exec npm run frontend:dev
