# n8n Demo Workflow

The n8n demo workflow is SDK-only by construction: it calls the local TRACE demo
bridge, and the bridge calls the TRACE runtime through `latence.Latence`.
n8n must not call RunPod directly.

## Workflow

- `workflows/trace-demo-sdk-bridge.json`
- Webhook path: `/webhook/latence-trace-demo`
- Required n8n env: `TRACE_DEMO_BRIDGE_URL=https://<bridge-host>`

## Expected Request

```json
{
  "scenario": "support_refund_rag",
  "integration": "n8n",
  "kind": "rag",
  "question": "Can I promise a refund in 48 hours?",
  "context": "Refunds require manual finance approval.",
  "answer": "Yes. The refund arrives in 48 hours."
}
```

## Expected Response

```json
{
  "ok": true,
  "action": "review",
  "trace": {
    "risk_band": "amber",
    "trace_score": 0.74,
    "runtime_decision": { "action": "auto_repair" }
  }
}
```

## Current Deployment Blockers

- `N8N_WEBHOOK_BASE_URL` and `N8N_API_KEY` are not available in this workspace.
- The workflow JSON is ready to import, but it has not been deployed to a live n8n instance.
- LibreChat UI status cards can target the webhook once the public n8n URL is known.

## Self-Hosted Later

For the local-first path, run n8n only after the bridge contract is stable.

Required n8n environment:

```bash
N8N_HOST=n8n.demo.latence.ai
N8N_PROTOCOL=https
WEBHOOK_URL=https://n8n.demo.latence.ai
TRACE_DEMO_BRIDGE_URL=https://trace-bridge.demo.latence.ai
```

Import `workflows/trace-demo-sdk-bridge.json`, set `TRACE_DEMO_BRIDGE_URL`, then activate the workflow.
After activation, set LibreChat/server env:

```bash
N8N_WEBHOOK_BASE_URL=https://n8n.demo.latence.ai
N8N_API_KEY=...
```

n8n still calls only the SDK bridge. It must not call RunPod directly.
