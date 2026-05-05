# Staging Deployment

This demo needs a full LibreChat deployment, not a static site. The public staging
gate is blocked until a hosting target and server-side secrets are configured.

## Required Secrets

- `OPENROUTER_KEY`: server-side OpenRouter key. The selected model is `nvidia/nemotron-3-super-120b-a12b:free`.
- `LATENCE_TRACE_URL`: TRACE runtime URL, usually the RunPod `/runsync` endpoint.
- `LATENCE_TRACE_API_KEY`: TRACE runtime API key.
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV`: LibreChat auth/secrets.
- `MONGO_URI`: managed MongoDB or the deployment platform's private Mongo service.

## Required Public Env

```bash
CONFIG_PATH=./librechat.yaml
ENDPOINTS=custom
LATENCE_DEMO_MODE=true
LATENCE_DEMO_PUBLIC_URL=https://demo.latence.ai
LATENCE_TRACE_DEPLOYMENT=runpod
LATENCE_TRACE_TIMEOUT=600
```

## Staging Gate

Before `demo.latence.ai` cutover:

- `/trace-demo` opens without authentication.
- `/c/new` can complete one OpenRouter chat turn.
- OpenRouter and TRACE keys are not present in client bundles, logs, docs, or committed config.
- The TRACE bridge uses the `latence` SDK only.
- The Phase 5 SDK-only proof passes against the same TRACE runtime used by staging.

## Current Blockers

- Hosting path selected: finish local development and smoke testing first, then deploy to Fly.io.
- No authenticated Fly.io deployment session is available on this machine yet.
- `OPENROUTER_KEY` has been provided for configuration, but still needs to be installed as a server-side deployment secret.
- A commit/push is required before any Git-backed deployment can build this fork.

## Local-First Then Fly.io

Recommended sequence:

1. Finish local bridge + UI iteration.
2. Push the fork to `latenceainew/latence-trace-librechat`.
3. Create Fly.io apps for LibreChat and the TRACE bridge.
4. Install server-side secrets with `fly secrets set`.
5. Attach managed MongoDB or a private Mongo service.
6. Run `npm run latence:demo:seed` against the public bridge URL.
7. Smoke `/trace-demo`, `/c/new`, and n8n webhook calls.

Fly.io secret names should match the local env names:

```bash
OPENROUTER_KEY=...
LATENCE_TRACE_URL=...
LATENCE_TRACE_API_KEY=...
TRACE_DEMO_BRIDGE_URL=...
N8N_WEBHOOK_BASE_URL=...
```
