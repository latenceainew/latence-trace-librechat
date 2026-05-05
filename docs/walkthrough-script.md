# Demo Walkthrough Script

## 1. Open With The Buyer Problem

"Agentic products are shipping faster than their evidence systems. TRACE shows the
exact moment an answer, tool route, or coding claim stops being supported."

Open `/trace-demo`.

## 2. Show The Scenario Launcher

Pick `Support RAG`.

Call out:

- The integration surface is visible.
- The runtime action is buyer-readable.
- Evidence is separate from the model answer.
- The "so what" card translates the signal into an operational decision.

## 3. Run A Chat Turn

Open the scenario chat. Use the refund fixture:

```text
Can I tell this customer their refund will arrive within 48 hours?
```

Reference context:

```text
Refunds require manual finance approval before timelines are promised.
```

Expected TRACE result:

- Risk band: amber.
- Runtime action: auto_repair or review.
- Buyer explanation: do not promise the timeline before approval.

## 4. Switch Integrations

Show the same policy claim through:

- Native SDK.
- LangChain.
- LlamaIndex.
- LangGraph.
- n8n via SDK bridge.

The point is sameness: different frameworks, one TRACE contract.

## 5. Close With Integration Path

"A team can start with one SDK call, add framework callbacks later, and keep the
same UI evidence shape for product, compliance, and engineering reviewers."

## Known Limitations For Staging

- Public deployment is blocked until hosting and OpenRouter secrets are provided.
- n8n workflow JSON is ready but not deployed to a live n8n instance.
- The current UI uses demo fixtures and bridge contract outputs; full chat-turn side-panel binding is the next hardening step.
