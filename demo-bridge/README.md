# Latence TRACE Demo Bridge

This service is the server-side bridge between LibreChat demo turns and TRACE.
It is intentionally SDK-only: runtime access goes through `latence.Latence`,
including RunPod deployments configured with `LATENCE_TRACE_DEPLOYMENT=runpod`.

## Run Locally

```bash
cd demo-bridge
python -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[dev]"

export LATENCE_TRACE_URL="https://api.runpod.ai/v2/campegd1dctnx2/runsync"
export LATENCE_TRACE_API_KEY="..."
export LATENCE_TRACE_DEPLOYMENT=runpod
export LATENCE_TRACE_TIMEOUT=600

uvicorn demo_bridge.main:app --host 127.0.0.1 --port 8788
```

## Contract

`POST /api/trace/run` accepts a normalized demo turn:

```json
{
  "scenario": "support_refund_rag",
  "integration": "langchain",
  "kind": "rag",
  "question": "Can I promise this customer a refund within 48 hours?",
  "context": "Refunds require manual finance approval before timelines are promised.",
  "answer": "Yes. The refund will arrive within 48 hours."
}
```

The response is UI-ready:

```json
{
  "scenario": "support_refund_rag",
  "integration": "langchain",
  "risk_band": "amber",
  "trace_score": 0.45,
  "runtime_decision": { "action": "review" },
  "request_id": "req_...",
  "latency_ms": 300,
  "evidence": [],
  "privacy": null,
  "memory": null,
  "raw": {}
}
```
