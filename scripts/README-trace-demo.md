# Lean local TRACE demo loop

Iterate on the LibreChat + TRACE demo without paying the 30-minute Fly deploy
on every change. All four pieces run on this pod against the deployed Fly Mongo
and the deployed RunPod TRACE runtime.

## Stack

| Layer    | Where                         | Script                              |
| -------- | ----------------------------- | ----------------------------------- |
| Mongo    | Fly (`latenceai-trace-mongo`) | reused via `fly proxy 27017`        |
| Backend  | local `:3080`                 | `npm run trace:dev:backend`         |
| Bridge   | local `:8788`                 | `npm run trace:dev:bridge`          |
| Frontend | local `:3090` (Vite + HMR)    | `npm run trace:dev`                 |
| Tunnel   | Cloudflare quick tunnel       | `npm run trace:dev:tunnel`          |
| Runtime  | RunPod (`campegd1dctnx2`)     | n/a, hit by the bridge              |

## One-time setup

1. Install Fly CLI in `/root/.fly` (already done on this pod).
2. Copy and fill the env file:

```bash
cp scripts/.env.dev-trace-demo.example scripts/.env.dev-trace-demo
$EDITOR scripts/.env.dev-trace-demo
```

`scripts/.env.dev-trace-demo` is gitignored. Values come from:

- `MONGO_PASSWORD` -> generated when `latenceai-trace-mongo` was created.
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV` -> generated when
  `latenceai-trace-demo` was created.
- `OPENROUTER_KEY` -> the demo OpenRouter key on the same Fly app.
- `LATENCE_TRACE_URL`, `LATENCE_TRACE_API_KEY` -> RunPod endpoint + token.

## Running it (four terminals)

```bash
npm run trace:dev:backend   # fly proxy 27017 + LibreChat on :3080 (no-auth demo mode)
npm run trace:dev:bridge    # FastAPI bridge on :8788 -> RunPod
npm run trace:dev           # Vite on :3090, /api proxied to local :3080
npm run trace:dev:tunnel    # cloudflared quick tunnel -> :3090, prints public URL
```

Open the printed `https://*.trycloudflare.com/trace-demo` URL.

## Why this exists

A `fly deploy -a latenceai-trace-demo` is ~30 minutes. The lean loop swaps
that for HMR (~1 second per frontend edit) and a `nodemon` restart (~3 seconds
per backend edit) while still talking to the real Fly Mongo and the real
RunPod TRACE runtime, so behaviour is faithful to production.

If `npm run trace:dev` defaults to proxying `/api` to the deployed Fly
backend (via `DEV_API_PROXY_TARGET=https://latenceai-trace-demo.fly.dev`),
**any uncommitted changes in `api/`, `librechat.yaml`, or `packages/` are
silently ignored**. Keep `DEV_API_PROXY_TARGET` unset (the new default) so
the local backend is exercised end-to-end.

## When you finish iterating

Once the local stack is happy:

```bash
git status            # review uncommitted files
git add ...
git commit -m "..."
git push              # triggers Fly deploy via .github/workflows/fly-deploy-demo.yml
```
