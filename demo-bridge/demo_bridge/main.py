from __future__ import annotations

import os
import time
from collections.abc import Mapping
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from latence import Latence
from latence.integrations.langchain import LatenceTraceCallback
from pydantic import BaseModel, Field

Integration = Literal["native", "langchain", "llamaindex", "langgraph", "n8n"]
ScenarioKind = Literal["rag", "code", "privacy", "memory", "compression", "rollup"]


class DemoTraceRequest(BaseModel):
    scenario: str = Field(..., examples=["support_refund_rag"])
    integration: Integration = "native"
    kind: ScenarioKind = "rag"
    question: str | None = None
    context: str | list[str] | None = None
    answer: str | None = None
    text: str | None = None
    turns: list[dict[str, Any]] = Field(default_factory=list)
    prior_memory_state: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DemoTraceResponse(BaseModel):
    scenario: str
    integration: Integration
    risk_band: str
    trace_score: float | None = None
    runtime_decision: Mapping[str, Any] | None = None
    request_id: str | None = None
    latency_ms: float
    evidence: list[Mapping[str, Any]] = Field(default_factory=list)
    privacy: Mapping[str, Any] | None = None
    memory: Mapping[str, Any] | None = None
    compression: Mapping[str, Any] | None = None
    raw: Mapping[str, Any] = Field(default_factory=dict)


def create_app() -> FastAPI:
    app = FastAPI(title="Latence TRACE Demo Bridge", version="0.1.0")

    cors_origins = [
        origin.strip()
        for origin in os.environ.get(
            "TRACE_DEMO_BRIDGE_CORS_ORIGINS",
            "https://latenceai-trace-demo.fly.dev,http://localhost:3080,http://localhost:3090,http://localhost:3092",
        ).split(",")
        if origin.strip()
    ]
    cors_origin_regex = os.environ.get(
        "TRACE_DEMO_BRIDGE_CORS_ORIGIN_REGEX",
        r"https://[a-z0-9-]+\.trycloudflare\.com",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_origin_regex=cors_origin_regex,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    def healthz() -> dict[str, Any]:
        return {
            "ok": True,
            "sdk_only": True,
            "trace_url_configured": bool(os.environ.get("LATENCE_TRACE_URL")),
        }

    @app.post("/api/trace/run", response_model=DemoTraceResponse)
    def run_trace(request: DemoTraceRequest) -> DemoTraceResponse:
        started = time.perf_counter()
        trace = Latence(timeout=float(os.environ.get("LATENCE_TRACE_TIMEOUT", "600")))
        try:
            return _run_with_client(trace, request, started)
        finally:
            trace.close()

    return app


def _run_with_client(
    trace: Latence,
    request: DemoTraceRequest,
    started: float,
) -> DemoTraceResponse:
    if request.kind == "privacy":
        result = trace.privacy.redact(
            text=_required(request.text, "text"),
            labels=["email", "person", "account_number"],
            include_original_text=False,
        )
        return DemoTraceResponse(
            scenario=request.scenario,
            integration=request.integration,
            risk_band="red" if result.entity_count else "green",
            trace_score=float(result.entity_count),
            request_id=result.request_id,
            latency_ms=_elapsed_ms(started),
            privacy={
                "entity_count": result.entity_count,
                "unique_labels": result.unique_labels,
                "redacted_text": result.redacted_text,
            },
            raw=result.raw or {},
        )

    if request.kind == "memory":
        result = trace.memory.step(
            turn_text=_required(request.text or request.answer, "text or answer"),
            prior_memory_state=request.prior_memory_state,
            metadata=request.metadata,
        )
        return DemoTraceResponse(
            scenario=request.scenario,
            integration=request.integration,
            risk_band="green",
            request_id=result.request_id,
            latency_ms=_elapsed_ms(started),
            memory={
                "next_memory_state": result.next_memory_state,
                "hot_context": result.hot_context,
                "actions": result.actions,
            },
            raw=result.raw or {},
        )

    if request.kind == "compression":
        result = trace.compression.text(_required(_compression_text(request), "text or context"))
        saved = result.tokens_saved or 0
        return DemoTraceResponse(
            scenario=request.scenario,
            integration=request.integration,
            risk_band="green",
            trace_score=float(saved),
            request_id=result.request_id,
            latency_ms=_elapsed_ms(started),
            compression={
                "compressed_text": result.compressed_text,
                "tokens_saved": saved,
                "compression_ratio": result.compression_ratio,
                "preserved_terms": result.preserved_terms,
            },
            raw=result.raw or {},
        )

    if request.kind == "rollup":
        result = trace.rollup(request.turns)
        return DemoTraceResponse(
            scenario=request.scenario,
            integration=request.integration,
            risk_band=str(result.get("risk_band") or result.get("overall_risk_band") or "unknown"),
            request_id=str(result.get("request_id")) if result.get("request_id") else None,
            latency_ms=_elapsed_ms(started),
            raw=dict(result),
        )

    if request.kind == "rag" and request.integration == "langchain":
        return _run_langchain_rag(trace, request, started)
    if request.kind == "rag" and request.integration == "llamaindex":
        return _run_llamaindex_rag(trace, request, started)
    if request.kind == "code" and request.integration == "langgraph":
        return _run_langgraph_code(trace, request, started)

    if request.kind == "code":
        result = trace.grounding.code(
            query=_required(request.question, "question"),
            response_text=_required(request.answer, "answer"),
            raw_context=_coerce_context(request.context),
        )
    else:
        result = trace.grounding.rag(
            query=_required(request.question, "question"),
            response_text=_required(request.answer, "answer"),
            raw_context=_coerce_context(request.context),
        )
    score = (
        result.scores.groundedness_v2
        or result.scores.coverage_score_u
        or result.scores.context_coverage_ratio
    )
    runtime_decision = (
        result.runtime_decision.model_dump(mode="json", exclude_none=True)
        if result.runtime_decision
        else None
    )
    risk_band = result.risk_band.value if result.risk_band else "unknown"
    if risk_band == "unknown" and isinstance(runtime_decision, Mapping):
        risk_band = str(
            runtime_decision.get("band") or runtime_decision.get("risk_band") or "unknown"
        )
    if score is None and isinstance(runtime_decision, Mapping):
        runtime_score = runtime_decision.get("score")
        score = float(runtime_score) if isinstance(runtime_score, int | float) else None
    return DemoTraceResponse(
        scenario=request.scenario,
        integration=request.integration,
        risk_band=risk_band,
        trace_score=float(score) if score is not None else None,
        runtime_decision=runtime_decision,
        request_id=result.request_id,
        latency_ms=_elapsed_ms(started),
        evidence=list(result.support_units),
        raw=result.raw or {},
    )


def _run_langchain_rag(
    trace: Latence,
    request: DemoTraceRequest,
    started: float,
) -> DemoTraceResponse:
    callback = LatenceTraceCallback(trace)
    run_id = uuid4()
    inputs = {
        "question": _required(request.question, "question"),
        "context": _coerce_context(request.context),
    }
    outputs = {"answer": _required(request.answer, "answer")}
    callback.on_chain_start({}, inputs, run_id=run_id)
    callback.on_chain_end(outputs, run_id=run_id)
    metadata = outputs.get("metadata", {}).get("latence_trace") or callback.last_result
    if not isinstance(metadata, Mapping):
        raise HTTPException(status_code=502, detail="LangChain TRACE callback produced no metadata")
    runtime_decision = metadata.get("runtime_decision")
    trace_score = _optional_float(metadata.get("trace_score"))
    if isinstance(runtime_decision, Mapping) and (trace_score is None or trace_score == 0):
        trace_score = _optional_float(runtime_decision.get("score"))
    return DemoTraceResponse(
        scenario=request.scenario,
        integration=request.integration,
        risk_band=str(metadata.get("risk_band") or "unknown"),
        trace_score=trace_score,
        runtime_decision=runtime_decision if isinstance(runtime_decision, Mapping) else None,
        request_id=str(metadata.get("request_id")) if metadata.get("request_id") else None,
        latency_ms=_elapsed_ms(started),
        raw=dict(metadata),
    )


def _run_llamaindex_rag(
    trace: Latence,
    request: DemoTraceRequest,
    started: float,
) -> DemoTraceResponse:
    from latence.integrations.llama_index import LatenceTracePostProcessor
    from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode

    context_chunks = _coerce_context(request.context).split("\n\n")
    nodes = [
        NodeWithScore(
            node=TextNode(text=chunk, metadata={"source_id": f"{request.scenario}-{index + 1}"}),
            score=1.0,
        )
        for index, chunk in enumerate(context_chunks)
        if chunk.strip()
    ]
    processed = LatenceTracePostProcessor(trace)._postprocess_nodes(
        nodes,
        query_bundle=QueryBundle(query_str=_required(request.question, "question")),
    )
    metadata = {}
    evidence = []
    for node in processed:
        annotation = node.node.metadata.get("latence_trace")
        if isinstance(annotation, Mapping):
            metadata = dict(annotation)
        evidence.append(
            {
                "source_id": node.node.metadata.get("source_id"),
                "text": node.node.get_content(),
                "score": node.score,
            }
        )
    if not metadata:
        raise HTTPException(
            status_code=502,
            detail="LlamaIndex TRACE postprocessor produced no metadata",
        )
    runtime_decision = metadata.get("runtime_decision")
    trace_score = _optional_float(metadata.get("trace_score"))
    if isinstance(runtime_decision, Mapping) and (trace_score is None or trace_score == 0):
        trace_score = _optional_float(runtime_decision.get("score"))
    return DemoTraceResponse(
        scenario=request.scenario,
        integration=request.integration,
        risk_band=str(metadata.get("risk_band") or "unknown"),
        trace_score=trace_score,
        runtime_decision=runtime_decision if isinstance(runtime_decision, Mapping) else None,
        request_id=str(metadata.get("request_id")) if metadata.get("request_id") else None,
        latency_ms=_elapsed_ms(started),
        evidence=evidence,
        raw=dict(metadata),
    )


def _run_langgraph_code(
    trace: Latence,
    request: DemoTraceRequest,
    started: float,
) -> DemoTraceResponse:
    from latence.integrations.langgraph import score_groundedness_node

    node = score_groundedness_node(trace, mode="code")
    state = node(
        {
            "question": _required(request.question, "question"),
            "answer": _required(request.answer, "answer"),
            "raw_context": _coerce_context(request.context),
        }
    )
    metadata = state.get("latence_trace")
    runtime_decision = metadata.get("runtime_decision") if isinstance(metadata, Mapping) else None
    route = _langgraph_route(str(state.get("trace_band") or "unknown"), runtime_decision)
    trace_score = _optional_float(state.get("trace_score"))
    if isinstance(runtime_decision, Mapping) and (trace_score is None or trace_score == 0):
        trace_score = _optional_float(runtime_decision.get("score"))
    return DemoTraceResponse(
        scenario=request.scenario,
        integration=request.integration,
        risk_band=str(state.get("trace_band") or "unknown"),
        trace_score=trace_score,
        runtime_decision={
            **(dict(runtime_decision) if isinstance(runtime_decision, Mapping) else {}),
            "graph_route": route,
        },
        request_id=(
            str(metadata.get("request_id"))
            if isinstance(metadata, Mapping) and metadata.get("request_id")
            else None
        ),
        latency_ms=_elapsed_ms(started),
        raw=(
            dict(metadata)
            if isinstance(metadata, Mapping)
            else {"trace_band": state.get("trace_band")}
        ),
    )


def _langgraph_route(band: str, runtime_decision: Any) -> str:
    if isinstance(runtime_decision, Mapping):
        action = str(runtime_decision.get("action") or "")
        if action in {"auto_repair", "retry"}:
            return "retry"
        if action in {"review", "block"}:
            return "review"
    if band == "green":
        return "pass"
    if band == "amber":
        return "review"
    return "retry"


def _required(value: str | None, field: str) -> str:
    if value is None or not value.strip():
        raise HTTPException(status_code=422, detail=f"{field} is required for this scenario")
    return value


def _coerce_context(value: str | list[str] | None) -> str:
    if value is None:
        raise HTTPException(status_code=422, detail="context is required for this scenario")
    if isinstance(value, str):
        return value
    return "\n\n".join(str(item) for item in value)


def _compression_text(request: DemoTraceRequest) -> str | None:
    if request.text:
        return request.text
    if isinstance(request.context, str):
        return request.context
    if isinstance(request.context, list):
        return "\n\n".join(str(item) for item in request.context)
    return request.answer


def _optional_float(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _elapsed_ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000.0, 2)


app = create_app()
