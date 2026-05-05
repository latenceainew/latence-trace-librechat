# Latence TRACE LibreChat Demo Baseline

This fork is the public visual host for Latence TRACE demo showcases.

## Baseline Scope

- Preserve upstream LibreChat history, license files, and notices.
- Configure OpenRouter with `nvidia/nemotron-3-super-120b-a12b:free` as the default server-side model through `librechat.yaml`.
- Keep secrets server-side only: `OPENROUTER_KEY`, `LATENCE_TRACE_API_KEY`, and deployment URLs stay in environment variables.
- Add `/trace-demo` as a public scenario launcher and buyer-facing entry point.
- Keep TRACE runtime access SDK-first. Application code should call the `latence` SDK or a backend bridge built around it, not raw RunPod HTTP.

## Current Demo Entry Points

- `/trace-demo`: public Latence TRACE overview and scenario launcher.
- `/c/new`: upstream LibreChat chat surface configured for the OpenRouter custom endpoint.

## Required Environment

```bash
CONFIG_PATH=./librechat.yaml
ENDPOINTS=custom
LATENCE_DEMO_MODE=true
LATENCE_DEMO_PUBLIC_URL=https://demo.latence.ai
OPENROUTER_KEY=...
LATENCE_TRACE_URL=https://api.runpod.ai/v2/campegd1dctnx2/runsync
LATENCE_TRACE_API_KEY=...
LATENCE_TRACE_DEPLOYMENT=runpod
LATENCE_TRACE_TIMEOUT=600
```

## Gate For This Baseline

The baseline is not the full demo. It is ready when:

- The fork opens locally or on staging.
- `/trace-demo` renders without authentication.
- Chat uses OpenRouter through server-side `OPENROUTER_KEY`.
- No OpenRouter or TRACE key is present in client code or committed config.
- The next phase can add the SDK-backed TRACE bridge without changing the UI contract.
