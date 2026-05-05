from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
from latence import Latence

from demo_bridge.main import DemoTraceRequest, _run_with_client

SAMPLE_RESPONSE = {
    "risk_band": "amber",
    "scores": {"groundedness_v2": 0.42, "risk_band": "amber"},
    "runtime_decision": {
        "action": "review",
        "score": 0.42,
        "score_channel": "mock",
        "class_key": "rag.prose.enterprise",
    },
    "support_units": [{"source_id": "policy", "usage_state": "used"}],
}


class _FakeGrounding:
    def rag(self, **_kwargs):
        return SimpleNamespace(
            risk_band=SimpleNamespace(value="amber"),
            scores=SimpleNamespace(
                groundedness_v2=0.42,
                coverage_score_u=None,
                context_coverage_ratio=None,
            ),
            runtime_decision=SimpleNamespace(
                model_dump=lambda **_options: {"action": "review"},
            ),
            request_id="req-rag",
            support_units=[{"source_id": "policy", "usage_state": "used"}],
            raw={"risk_band": "amber"},
        )

    def code(self, **_kwargs):
        return self.rag(**_kwargs)


class _FakePrivacy:
    def redact(self, **kwargs):
        assert kwargs["labels"] == ["email", "person", "account_number"]
        return SimpleNamespace(
            entity_count=1,
            unique_labels=["email"],
            redacted_text="Contact [EMAIL]",
            request_id="req-redact",
            raw={"entity_count": 1},
        )


class _FakeCompression:
    def text(self, _text):
        return SimpleNamespace(
            compressed_text="short policy",
            tokens_saved=12,
            compression_ratio=0.4,
            preserved_terms=["approval"],
            request_id="req-compress",
            raw={"tokens_saved": 12},
        )


class _FakeTrace:
    grounding = _FakeGrounding()
    privacy = _FakePrivacy()
    compression = _FakeCompression()


def test_bridge_normalizes_rag_response() -> None:
    response = _run_with_client(
        _FakeTrace(),
        DemoTraceRequest(
            scenario="support_refund_rag",
            integration="native",
            kind="rag",
            question="Can I promise a refund?",
            context="Refunds require approval.",
            answer="The refund arrives in 48 hours.",
        ),
        started=0.0,
    )

    assert response.scenario == "support_refund_rag"
    assert response.integration == "native"
    assert response.risk_band == "amber"
    assert response.trace_score == 0.42
    assert response.runtime_decision is not None
    assert response.runtime_decision["action"] == "review"
    assert response.request_id == "req-rag"
    assert response.evidence == [{"source_id": "policy", "usage_state": "used"}]


def test_bridge_runs_langchain_callback_path() -> None:
    response = _run_with_client(
        _FakeTrace(),
        DemoTraceRequest(
            scenario="support_refund_rag",
            integration="langchain",
            kind="rag",
            question="Can I promise a refund?",
            context="Refunds require approval.",
            answer="The refund arrives in 48 hours.",
        ),
        started=0.0,
    )

    assert response.integration == "langchain"
    assert response.risk_band == "amber"
    assert response.trace_score == 0.42
    assert response.runtime_decision == {"action": "review"}
    assert response.request_id == "req-rag"


def test_bridge_runs_llamaindex_postprocessor_path() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/groundedness"
        body = json.loads(request.content)
        assert body["raw_context"] == "Refunds require approval.\n\nFinance owns refund timing."
        return httpx.Response(200, json=SAMPLE_RESPONSE, headers={"x-request-id": "req-rag"})

    response = _run_with_client(
        Latence(transport=httpx.MockTransport(handler)),
        DemoTraceRequest(
            scenario="support_refund_rag",
            integration="llamaindex",
            kind="rag",
            question="Can I promise a refund?",
            context=["Refunds require approval.", "Finance owns refund timing."],
            answer="The refund arrives in 48 hours.",
        ),
        started=0.0,
    )

    assert response.integration == "llamaindex"
    assert response.risk_band == "amber"
    assert response.trace_score == 0.42
    assert response.runtime_decision is not None
    assert response.runtime_decision["action"] == "review"
    assert response.request_id == "req-rag"
    assert response.evidence[0]["source_id"] == "support_refund_rag-1"
    assert response.evidence[0]["text"] == "Refunds require approval."


def test_bridge_runs_langgraph_code_route() -> None:
    response = _run_with_client(
        _FakeTrace(),
        DemoTraceRequest(
            scenario="coding_agent_retry",
            integration="langgraph",
            kind="code",
            question="Does this patch add auth checks?",
            context="def handler(request):\n    return fetch_user(request.user_id)",
            answer="The patch validates admin auth before fetching the user.",
        ),
        started=0.0,
    )

    assert response.integration == "langgraph"
    assert response.risk_band == "amber"
    assert response.trace_score == 0.42
    assert response.runtime_decision == {"action": "review", "graph_route": "review"}
    assert response.request_id == "req-rag"


def test_bridge_normalizes_privacy_response() -> None:
    response = _run_with_client(
        _FakeTrace(),
        DemoTraceRequest(
            scenario="support_privacy",
            integration="native",
            kind="privacy",
            text="Contact jane@example.com",
        ),
        started=0.0,
    )

    assert response.risk_band == "red"
    assert response.privacy == {
        "entity_count": 1,
        "unique_labels": ["email"],
        "redacted_text": "Contact [EMAIL]",
    }


def test_bridge_normalizes_compression_response() -> None:
    response = _run_with_client(
        _FakeTrace(),
        DemoTraceRequest(
            scenario="policy_compression",
            integration="native",
            kind="compression",
            text="Long policy text with approval constraints.",
        ),
        started=0.0,
    )

    assert response.risk_band == "green"
    assert response.trace_score == 12
    assert response.compression == {
        "compressed_text": "short policy",
        "tokens_saved": 12,
        "compression_ratio": 0.4,
        "preserved_terms": ["approval"],
    }
