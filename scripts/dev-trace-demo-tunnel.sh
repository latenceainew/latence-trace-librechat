#!/usr/bin/env bash
# Expose the local Vite dev server (:3090) via a Cloudflare quick tunnel.
#
# Fourth of four scripts in the lean local TRACE loop. Run this last; it
# prints the public https://*.trycloudflare.com URL Cloudflare assigns.

set -euo pipefail

PORT="${PORT:-3090}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[trace-demo tunnel] ERROR: cloudflared not installed in PATH." >&2
  exit 1
fi

if ! ss -ltn 2>/dev/null | grep -qE ":${PORT}\b"; then
  echo "[trace-demo tunnel] WARNING: nothing listening on :${PORT}. Start ./scripts/dev-trace-demo.sh first." >&2
fi

echo "[trace-demo tunnel] starting Cloudflare quick tunnel -> http://localhost:$PORT"
exec cloudflared tunnel --url "http://localhost:$PORT" --http-host-header "localhost:$PORT"
