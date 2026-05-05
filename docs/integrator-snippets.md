# Integrator Snippets

All examples route through the SDK bridge. Do not call RunPod directly.

## Native SDK Bridge Request

```bash
curl -X POST "$TRACE_DEMO_BRIDGE_URL/api/trace/run" \
  -H 'Content-Type: application/json' \
  -d '{
    "scenario": "support_refund_rag",
    "integration": "native",
    "kind": "rag",
    "question": "Can I promise a refund in 48 hours?",
    "context": "Refunds require manual finance approval.",
    "answer": "Yes. The refund arrives in 48 hours."
  }'
```

## Python SDK Equivalent

```python
from latence import Latence

trace = Latence(timeout=600)
score = trace.grounding.rag(
    query="Can I promise a refund in 48 hours?",
    raw_context="Refunds require manual finance approval.",
    response_text="Yes. The refund arrives in 48 hours.",
)

decision = score.runtime_decision.action if score.runtime_decision else score.risk_band
```

## LangGraph Route

```python
route = {
    "green": "pass",
    "amber": "review",
    "red": "retry",
}.get(trace_band, "retry")
```

## n8n Route

n8n should call:

```text
POST {{$env.TRACE_DEMO_BRIDGE_URL}}/api/trace/run
```

The bridge owns the SDK runtime call.
