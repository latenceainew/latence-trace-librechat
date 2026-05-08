from __future__ import annotations

import json
import logging
import os
import re
import smtplib
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from latence import Latence
from latence._transport import runpod_request_body, unwrap_runpod_response
from latence.integrations.langchain import LatenceTraceCallback
from pydantic import BaseModel, Field

_log = logging.getLogger(__name__)

Integration = Literal["native", "langchain", "llamaindex", "langgraph", "n8n"]
ScenarioKind = Literal["rag", "privacy", "compression"]

# Language detection: matches the runtime detector so the bridge surfaces
# the same hint the runtime would auto-resolve. We pin the seed for
# determinism so the `Calibration: en/de` chip on the heatmap never
# flickers between identical replays of the same scenario.
try:
    from langdetect import DetectorFactory as _LangDetectorFactory
    from langdetect import LangDetectException as _LangDetectException
    from langdetect import detect_langs as _langdetect_detect_langs

    _LangDetectorFactory.seed = 42
except ImportError:  # pragma: no cover - optional dep in dev shells
    _langdetect_detect_langs = None  # type: ignore[assignment]
    _LangDetectException = Exception  # type: ignore[assignment, misc]


def _bridge_is_german(text: str | None) -> bool:
    """Return True iff ``text`` reads as German with high confidence.

    Mirrors ``latence_trace.core.language_detector.is_german`` so the
    bridge sends the same language hint the runtime would otherwise
    auto-detect. We probe at most 200 characters to keep latency below
    10 ms even on large RAG contexts.
    """

    if not text or _langdetect_detect_langs is None:
        return False
    probe = text[:256].strip()
    if len(probe) < 30:
        return False
    try:
        results = _langdetect_detect_langs(probe)
    except _LangDetectException:
        return False
    if not results:
        return False
    return getattr(results[0], "lang", None) == "de"


def _bridge_resolve_language(
    *, response_text: str | None, query: str | None, raw_context: str | None
) -> str:
    """Resolve the effective language using the same probe ladder as the
    runtime: response → query → raw_context, capped at 200 chars per slot.
    Always returns either ``"de"`` or ``"en"``; we do not support a third
    language path natively today."""

    for probe in (response_text, query, raw_context):
        if probe and probe.strip():
            if _bridge_is_german(probe):
                return "de"
            # First non-empty probe decides; if it's not German, we fall
            # to English without consulting the next probe. This matches
            # the runtime's resolve_language order.
            return "en"
    return "en"


def _wrap_context_with_file_headers(
    *,
    context: str | list[str] | None,
    scenario: str,
) -> str:
    """Wrap ``context`` chunks with ``# file:`` markers.

    The runtime's ``split_raw_context_by_file_headers`` looks for lines
    starting with ``# file:`` and treats each section as one semantic
    support unit. Pre-wrapping here keeps the runtime's reranker aligned
    on the chunks the scenario author intended (instead of paragraph-
    splitting heuristically inside the runtime).

    - List inputs: each element becomes its own ``# file:`` section.
    - String inputs: split on blank lines (paragraphs) and wrap each
      paragraph in its own ``# file:`` section. This is the same chunking
      the bridge already does upstream; making it explicit here means the
      runtime's segmenter matches the heatmap labels we display.
    - ``None`` returns ``""`` so the caller's existing required-context
      validation still triggers.
    """

    if context is None:
        return ""
    safe_scenario = re.sub(r"[^a-zA-Z0-9_-]", "-", scenario or "scenario").strip("-") or "scenario"

    if isinstance(context, list):
        chunks = [str(item).strip() for item in context if str(item).strip()]
    else:
        chunks = [
            paragraph.strip()
            for paragraph in re.split(r"\n\s*\n", str(context))
            if paragraph.strip()
        ]
        if not chunks:
            chunks = [str(context).strip()]
    sections: list[str] = []
    for idx, chunk in enumerate(chunks):
        # Skip if the chunk already starts with a file-header to avoid
        # double-wrapping (e.g. when the scenario JSON already provides
        # markers as part of the prose).
        first_line = chunk.split("\n", 1)[0].strip().lower()
        if first_line.startswith("# file:") or first_line.startswith("// file:"):
            sections.append(chunk)
        else:
            sections.append(f"# file: {safe_scenario}-chunk-{idx:02d}\n{chunk}")
    return "\n\n".join(sections)

CATALOGUE_ROOT = Path(
    os.environ.get(
        "TRACE_DEMO_CATALOGUE_ROOT",
        str(Path(__file__).resolve().parents[2] / "docs" / "trace-catalogue"),
    )
).resolve()
SCENARIOS_DIR = CATALOGUE_ROOT / "scenarios"
RUNS_DIR = CATALOGUE_ROOT / "runs"
SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,80}$")


class DemoTraceRequest(BaseModel):
    scenario: str = Field(..., examples=["support_refund_rag"])
    integration: Integration = "native"
    kind: ScenarioKind = "rag"
    # New chat shape: the frontend sends the verbatim user message
    # (`user_input`) and the assistant model output (`assistant_response`).
    # The bridge's parser (parse_user_input) splits user_input into
    # query + context. Backwards-compat: tools/run_scenario.py and tests
    # still pass question/context/answer pre-split, which is honoured.
    user_input: str | None = None
    assistant_response: str | None = None
    question: str | None = None
    context: str | list[str] | None = None
    answer: str | None = None
    text: str | None = None
    turns: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DemoTraceParseInfo(BaseModel):
    """How the bridge parsed `user_input` into query + context. Surfaced
    so the frontend can render the parse-mode chip in the heatmap header.

    ``language`` records the bridge's binary detection (``de``/``en``).
    The runtime is the source of truth for the *effective* language used
    during scoring (it re-runs detection if the request omits the hint),
    but exposing the bridge's view here means the chip is filled in even
    when the runtime is unreachable.
    """

    mode: Literal["markers", "head", "tail", "none", "preparsed"] = "none"
    query: str | None = None
    context_char_count: int = 0
    context_chunk_count: int = 0
    marker_present: bool = False
    language: Literal["de", "en"] | None = None
    language_source: Literal["request", "auto", "fallback_en"] | None = None


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
    compression: Mapping[str, Any] | None = None
    parse: DemoTraceParseInfo | None = None
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

    @app.get("/api/scenarios")
    def list_scenarios() -> dict[str, Any]:
        """Return the catalogue index so the frontend can build the picker."""
        return {"scenarios": _list_scenarios()}

    @app.get("/api/scenarios/{use_case}/{scenario_id}")
    def get_scenario(use_case: str, scenario_id: str) -> dict[str, Any]:
        """Return a single scenario bundle (manifest + corpus + question)."""
        bundle = _load_scenario_bundle(use_case, scenario_id)
        if bundle is None:
            raise HTTPException(status_code=404, detail="scenario not found")
        return bundle

    @app.get("/api/scenarios/{use_case}/{scenario_id}/{filename}")
    def get_scenario_file(use_case: str, scenario_id: str, filename: str) -> FileResponse:
        """Serve raw catalogue files (corpus.md, etc.) verbatim."""
        path = _resolve_scenario_file(use_case, scenario_id, filename)
        if path is None:
            raise HTTPException(status_code=404, detail="file not found")
        return FileResponse(path)

    @app.post("/api/trace/capture")
    def capture_run(payload: dict[str, Any]) -> JSONResponse:
        """Persist a frontend-captured TraceDemoMessageResult (or any raw
        run blob) into docs/trace-catalogue/runs/<scenario_id>/. Used by
        the LibreChat shell's "Save raw" button so SDK-baseline and chat
        runs land side-by-side for parity-diffing."""
        scenario_id = str(payload.get("scenario_id") or "").strip()
        integration = str(payload.get("integration") or "unknown").strip()
        source = str(payload.get("source") or "librechat").strip()
        if not scenario_id or not SAFE_ID_RE.match(scenario_id):
            raise HTTPException(status_code=400, detail="scenario_id is required and must be safe")
        if not SAFE_ID_RE.match(integration):
            raise HTTPException(status_code=400, detail="integration must be a safe identifier")
        if not SAFE_ID_RE.match(source):
            raise HTTPException(status_code=400, detail="source must be a safe identifier")
        run_dir = RUNS_DIR / scenario_id
        run_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = run_dir / f"{source}-{integration}-{ts}.json"
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        return JSONResponse(
            {
                "ok": True,
                "path": str(path.relative_to(CATALOGUE_ROOT.parent)),
                "scenario_id": scenario_id,
            }
        )

    @app.post("/api/verify-turnstile")
    def verify_turnstile(payload: dict[str, Any]) -> JSONResponse:
        """Validate a Cloudflare Turnstile token server-side."""
        token = str(payload.get("token") or "").strip()
        if not token:
            raise HTTPException(status_code=400, detail="token is required")
        secret = os.environ.get("TURNSTILE_SECRET_KEY", "")
        if not secret:
            return JSONResponse({"ok": True, "skipped": True})
        try:
            resp = httpx.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={"secret": secret, "response": token},
                timeout=10,
            )
            result = resp.json()
        except Exception as exc:
            _log.warning("Turnstile verification failed: %s", exc)
            return JSONResponse({"ok": True, "skipped": True})
        if result.get("success"):
            return JSONResponse({"ok": True})
        return JSONResponse({"ok": False, "error": "verification failed"}, status_code=403)

    @app.post("/api/lead-capture")
    def lead_capture(payload: dict[str, Any]) -> JSONResponse:
        """Capture a lead from the demo signup modal."""
        name = str(payload.get("name") or "").strip()
        company = str(payload.get("company") or "").strip()
        email = str(payload.get("email") or "").strip()
        message = str(payload.get("message") or "").strip()
        if not name or not company or not email:
            raise HTTPException(status_code=400, detail="name, company, and email are required")
        lead_to = os.environ.get("LEAD_CAPTURE_EMAIL", "admin@latence.ai")
        smtp_host = os.environ.get("SMTP_HOST")
        smtp_port = int(os.environ.get("SMTP_PORT", "587"))
        smtp_user = os.environ.get("SMTP_USER")
        smtp_pass = os.environ.get("SMTP_PASS")
        smtp_from = os.environ.get("SMTP_FROM", lead_to)
        body = (
            f"New TRACE demo lead:\n\n"
            f"Name: {name}\n"
            f"Company: {company}\n"
            f"Email: {email}\n"
            f"Message: {message or '(none)'}\n"
            f"Timestamp: {datetime.now(timezone.utc).isoformat()}\n"
        )
        if smtp_host and smtp_user and smtp_pass:
            try:
                msg = EmailMessage()
                msg["Subject"] = f"TRACE Demo Lead: {company} ({name})"
                msg["From"] = smtp_from
                msg["To"] = lead_to
                msg["Reply-To"] = email
                msg.set_content(body)
                with smtplib.SMTP(smtp_host, smtp_port) as server:
                    server.starttls()
                    server.login(smtp_user, smtp_pass)
                    server.send_message(msg)
            except Exception as exc:
                _log.warning("SMTP send failed, logging lead instead: %s", exc)
                _log.info("LEAD CAPTURE: %s", body)
        else:
            _log.info("LEAD CAPTURE (no SMTP configured): %s", body)
        return JSONResponse({"ok": True})

    return app


def _run_with_client(
    trace: Latence,
    request: DemoTraceRequest,
    started: float,
) -> DemoTraceResponse:
    # Parse user_input -> (query, context). The bridge owns input
    # shaping; the frontend just forwards the raw chat message and the
    # assistant response. Catalogue auto-pick is no longer used in the
    # chat path (catalogue is for tools/run_scenario.py only).
    parse_info = _shape_request_with_parser(request)
    if request.kind == "privacy":
        # Trust the runtime: with mode=open and no explicit labels the
        # SDK calls all_gdpr_labels() which is the full shipped GDPR
        # catalog (identity_and_contact + government_and_legal +
        # digital_and_location + financial + employment_and_education +
        # health_and_medical_article_9 + sensitive_and_biometric_article_9).
        # See latence_trace.compliance.labels.resolve_label_set. This is
        # strictly broader than any hand-picked subset we maintain and
        # the GLiNER aliases / canonical mapping live there too.
        result = trace.privacy.redact(
            text=_required(request.text, "text"),
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
            parse=parse_info,
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
            parse=parse_info,
            raw=result.raw or {},
        )

    # All integration labels (native, langchain, llamaindex, langgraph,
    # n8n) now use the same canonical grounding path so every integration
    # gets the full nli_diagnostics, support_units, context_trust_diagnostics,
    # and scores payload the frontend needs for rich analytics.  The
    # integration label is preserved in the response for display purposes.

    # Quality lane + reverse-context-only by default. The frontend / SDK
    # driver can override per-request via metadata.trace_extra (e.g. to A/B
    # against the standard preset). Reasoning:
    #   - profile=quality enables atomic NLI claim decomposition, which is
    #     the dataset the claim-span heatmap renders against.
    #   - include_triangular_diagnostics=False stops query-conditioned
    #     channels from running when query_text is present; the headline
    #     stays reverse_context.
    #   - response_format=canonical returns the full Pydantic dump from
    #     the runpod handler, including nli_diagnostics with claim text +
    #     char_start/char_end + atoms (the per-span heatmap dataset). The
    #     compact shape strips this; we cannot get spans without canonical.
    sdk_extra: dict[str, Any] = {
        "profile": "quality",
        "include_triangular_diagnostics": False,
        "response_format": "canonical",
    }
    # Language hint: forward the bridge-side detection to the runtime so
    # the same language flows into the per-class calibration bundle
    # loader and the German balanced NLI defaults (top_k=2, concat=False,
    # max-aggregate). The runtime will re-detect when the field is
    # absent, but sending it explicitly avoids a second langdetect call
    # on every request.
    if parse_info is not None and parse_info.language:
        sdk_extra.setdefault("language", parse_info.language)
    if isinstance(request.metadata, Mapping):
        override = request.metadata.get("trace_extra")
        if isinstance(override, Mapping):
            sdk_extra.update({str(k): v for k, v in override.items()})
    query_arg = (request.question or "").strip() or None
    # File-headed raw_context: wrap the scenario chunks with `# file:`
    # markers so the runtime's split_raw_context_by_file_headers treats
    # each scenario chunk as one semantic support unit. This aligns the
    # reranker with the chunks the scenario author intended (instead of
    # the runtime's heuristic paragraph splitter, which over-splits long
    # German prose into low-signal pieces).
    raw_context = _wrap_context_with_file_headers(
        context=request.context,
        scenario=request.scenario,
    )
    if not raw_context:
        # Preserve the historical 422 message when the scenario is missing
        # context entirely; _coerce_context raises the same error.
        _coerce_context(request.context)
    response_text = _required(request.answer, "answer")
    raw = _grounding_canonical(
        trace=trace,
        query=query_arg,
        response_text=response_text,
        raw_context=raw_context,
        sdk_extra=sdk_extra,
    )
    return _build_grounding_response(request, raw, started, parse_info)


def _grounding_canonical(
    *,
    trace: Latence,
    query: str | None,
    response_text: str,
    raw_context: str,
    sdk_extra: dict[str, Any],
) -> dict[str, Any]:
    """Call grounding.rag via the SDK's HTTP transport but request the
    canonical (full Pydantic dump) response shape. Bypass the SDK's strict
    response model validation because the deployed runpod runtime can be a
    minor version ahead of / behind the typed model and we need the raw
    dict (especially nli_diagnostics.claims) more than typed access."""
    body: dict[str, Any] = {
        "response_text": response_text,
        "raw_context": raw_context,
        "scoring_mode": "rag",
    }
    if query is not None:
        body["query_text"] = query
    body.update(sdk_extra)
    method = "POST"
    path = "/v1/grounding"
    request_path = trace._base_url if trace._runpod else path
    request_json = (
        runpod_request_body(method, path, body, None) if trace._runpod else body
    )
    response = trace._client.request(
        "POST" if trace._runpod else method,
        request_path,
        json=request_json,
        headers=None,
    )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"TRACE grounding error {response.status_code}: {response.text[:500]}",
        )
    body_json = response.json()
    if trace._runpod:
        unwrapped, _request_id = unwrap_runpod_response(body_json)
        if isinstance(unwrapped, Mapping):
            return dict(unwrapped)
        return {"result": unwrapped} if unwrapped is not None else {}
    if isinstance(body_json, dict):
        result_inner = body_json.get("result")
        if isinstance(result_inner, dict):
            merged = dict(result_inner)
            for k in ("action", "request_id", "success", "version"):
                if k in body_json and k not in merged:
                    merged[k] = body_json[k]
            return merged
        return body_json
    return {"result": body_json}


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _build_grounding_response(
    request: DemoTraceRequest,
    raw: Mapping[str, Any],
    started: float,
    parse_info: DemoTraceParseInfo | None = None,
) -> DemoTraceResponse:
    """Map a canonical TRACE payload into our DemoTraceResponse contract.
    Reads risk_band, trace_score, runtime_decision, evidence (from
    runtime_decision.evidence with fallback to support_units) and surfaces
    the entire dict under `raw` so the frontend can pluck nli_diagnostics
    + heatmap directly without going through more bridge logic."""
    scores = raw.get("scores") if isinstance(raw.get("scores"), Mapping) else {}
    runtime_decision = (
        dict(raw.get("runtime_decision"))
        if isinstance(raw.get("runtime_decision"), Mapping)
        else None
    )
    risk_band = (
        scores.get("risk_band")
        or raw.get("band")
        or (runtime_decision or {}).get("band")
        or "unknown"
    )
    risk_band = str(risk_band) if risk_band else "unknown"
    score = (
        _num(scores.get("groundedness_v2"))
        or _num(raw.get("groundedness_v2"))
        or _num(raw.get("score"))
    )
    if score is None and runtime_decision:
        score = _num(runtime_decision.get("score"))
    evidence_payload: list[Mapping[str, Any]] = []
    if runtime_decision and isinstance(runtime_decision.get("evidence"), list):
        evidence_payload = [
            item for item in runtime_decision["evidence"] if isinstance(item, Mapping)
        ]
    if not evidence_payload and isinstance(raw.get("support_units"), list):
        evidence_payload = [
            unit for unit in raw["support_units"] if isinstance(unit, Mapping)
        ]
    return DemoTraceResponse(
        scenario=request.scenario,
        integration=request.integration,
        risk_band=risk_band,
        trace_score=score,
        runtime_decision=runtime_decision,
        request_id=str(raw.get("request_id")) if raw.get("request_id") else None,
        latency_ms=_elapsed_ms(started),
        evidence=evidence_payload,
        parse=parse_info,
        raw=dict(raw),
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


def _list_scenarios() -> list[dict[str, Any]]:
    if not SCENARIOS_DIR.exists():
        return []
    out: list[dict[str, Any]] = []
    for use_case_dir in sorted(SCENARIOS_DIR.iterdir()):
        if not use_case_dir.is_dir():
            continue
        for scenario_dir in sorted(use_case_dir.iterdir()):
            if not scenario_dir.is_dir():
                continue
            manifest_path = scenario_dir / "scenario.json"
            if not manifest_path.exists():
                continue
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            manifest.setdefault("id", scenario_dir.name)
            manifest.setdefault("use_case", use_case_dir.name)
            out.append(manifest)
    return out


def _load_scenario_bundle(use_case: str, scenario_id: str) -> dict[str, Any] | None:
    scenario_dir = _resolve_scenario_dir(use_case, scenario_id)
    if scenario_dir is None:
        return None
    manifest_path = scenario_dir / "scenario.json"
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.setdefault("id", scenario_id)
    manifest.setdefault("use_case", use_case)
    bundle: dict[str, Any] = {"manifest": manifest}
    for filename, key in (
        ("corpus.md", "corpus"),
        ("question.md", "question"),
        ("seed_answer.md", "seed_answer"),
        ("notes.md", "notes"),
    ):
        path = scenario_dir / filename
        bundle[key] = path.read_text(encoding="utf-8") if path.exists() else None
    bundle["chunks"] = _split_corpus_chunks(bundle["corpus"]) if bundle.get("corpus") else []
    return bundle


def _resolve_scenario_dir(use_case: str, scenario_id: str) -> Path | None:
    if not SAFE_ID_RE.match(use_case) or not SAFE_ID_RE.match(scenario_id):
        return None
    candidate = (SCENARIOS_DIR / use_case / scenario_id).resolve()
    try:
        candidate.relative_to(SCENARIOS_DIR)
    except ValueError:
        return None
    if not candidate.is_dir():
        return None
    return candidate


def _resolve_scenario_file(use_case: str, scenario_id: str, filename: str) -> Path | None:
    if not re.match(r"^[a-zA-Z0-9_.-]{1,80}$", filename):
        return None
    scenario_dir = _resolve_scenario_dir(use_case, scenario_id)
    if scenario_dir is None:
        return None
    candidate = (scenario_dir / filename).resolve()
    try:
        candidate.relative_to(scenario_dir)
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    return candidate


def _split_corpus_chunks(text: str) -> list[str]:
    """Split a corpus.md into logical chunks for the bridge `context` arg.
    Splits on Markdown H2 (`## `) headings; falls back to paragraph blocks."""
    if not text:
        return []
    parts = re.split(r"(?m)^(?=##\s)", text.strip())
    chunks = [chunk.strip() for chunk in parts if chunk.strip()]
    if len(chunks) > 1:
        return chunks
    paras = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
    return paras or [text.strip()]


# =============================================================================
# Parser: split chat-style user_input into (query, context) for TRACE.
# =============================================================================

# Marker syntax. Three accepted forms (case-insensitive):
#   <START_CONTEXT>...</END_CONTEXT>  (plan default — XML-style with slash on close)
#   <CTX>...</CTX>                    (short form)
#   [CONTEXT]...[/CONTEXT]            (alias for clients that strip angle brackets)
_MARKER_PATTERNS = (
    re.compile(
        r"<\s*START[_\s]*CONTEXT\s*>(.*?)<\s*/?\s*END[_\s]*CONTEXT\s*>",
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r"<\s*CTX\s*>(.*?)<\s*/\s*CTX\s*>",
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r"\[\s*CONTEXT\s*\](.*?)\[\s*/\s*CONTEXT\s*\]",
        re.IGNORECASE | re.DOTALL,
    ),
)
# Question detector. Anchored to common English / German question words OR a
# trailing question mark on a short paragraph. Used by the head/tail heuristic
# when no markers are present.
_QUESTION_LEAD_WORDS = re.compile(
    r"^\s*(was|wer|wie|warum|wann|wo|welche[rs]?|ist|sind|kann|"
    r"what|who|how|why|when|where|which|is|are|can|should|do|does|did)"
    r"\b",
    re.IGNORECASE,
)
_HEAD_TAIL_QUERY_MAX_CHARS = 200


def _looks_like_question(paragraph: str) -> bool:
    text = paragraph.strip()
    if not text or len(text) > _HEAD_TAIL_QUERY_MAX_CHARS:
        return False
    if text.rstrip().endswith("?"):
        return True
    return bool(_QUESTION_LEAD_WORDS.match(text))


@dataclass(frozen=True)
class _Parsed:
    mode: Literal["markers", "head", "tail", "none"]
    query: str
    context_chunks: list[str]
    marker_present: bool


def parse_user_input(text: str) -> _Parsed:
    """Split a chat-style user message into (query, context) for TRACE.

    Three modes, in order of preference:

    1. ``markers`` — explicit ``<START_CONTEXT>...</END_CONTEXT>`` (or the
       ``[CONTEXT]...[/CONTEXT]`` alias). Context = inside markers (joined
       on blank-line splits). Query = everything outside, trimmed; may be
       empty if the user only pasted context.
    2. ``head`` / ``tail`` — split on blank lines into paragraphs. If the
       first paragraph is a short question (German or English question
       words, or trailing ``?``, ≤200 chars), query = first, context =
       rest. Otherwise the same check on the last paragraph.
    3. ``none`` — no question detected. Context = full text, query = "".
       The bridge then drops query_text from the SDK call so triangular
       cannot accidentally engage on a non-question.
    """
    raw = text or ""
    if not raw.strip():
        return _Parsed(mode="none", query="", context_chunks=[], marker_present=False)

    for pattern in _MARKER_PATTERNS:
        match = pattern.search(raw)
        if not match:
            continue
        inside = match.group(1).strip()
        outside = (raw[: match.start()] + " " + raw[match.end() :]).strip()
        chunks = _split_corpus_chunks(inside) if inside else []
        return _Parsed(
            mode="markers",
            query=outside,
            context_chunks=chunks,
            marker_present=True,
        )

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", raw) if p.strip()]
    if len(paragraphs) >= 2:
        if _looks_like_question(paragraphs[0]):
            return _Parsed(
                mode="head",
                query=paragraphs[0],
                context_chunks=paragraphs[1:],
                marker_present=False,
            )
        if _looks_like_question(paragraphs[-1]):
            return _Parsed(
                mode="tail",
                query=paragraphs[-1],
                context_chunks=paragraphs[:-1],
                marker_present=False,
            )

    return _Parsed(
        mode="none",
        query="",
        context_chunks=paragraphs or [raw.strip()],
        marker_present=False,
    )


def _shape_request_with_parser(request: DemoTraceRequest) -> DemoTraceParseInfo:
    """Mutate ``request`` in place so downstream handlers see the parsed
    query/context. Returns parse info for the response envelope.

    Pre-parsed inputs (where ``question`` and ``context`` were supplied
    explicitly, e.g. from ``tools/run_scenario.py`` or unit tests) are
    honoured verbatim and tagged ``mode='preparsed'``.
    """
    if request.kind == "privacy":
        language_probe = request.text or ""
        language = _bridge_resolve_language(
            response_text=language_probe,
            query=None,
            raw_context=None,
        )
        return DemoTraceParseInfo(
            mode="none",
            language=language,
            language_source="auto",
        )
    if request.user_input is None or not str(request.user_input).strip():
        # Backwards-compat: legacy callers pass question/context directly.
        # Synthesize a parse block reflecting that they were preparsed.
        if request.question is not None or request.context is not None:
            ctx = _coerce_context(request.context)
            language = _bridge_resolve_language(
                response_text=request.answer or request.assistant_response,
                query=request.question,
                raw_context=ctx,
            )
            return DemoTraceParseInfo(
                mode="preparsed",
                query=(request.question or "").strip() or None,
                context_char_count=len(ctx),
                context_chunk_count=
                    len(request.context) if isinstance(request.context, list)
                    else (1 if request.context else 0),
                marker_present=False,
                language=language,
                language_source="auto",
            )
        return DemoTraceParseInfo(mode="none")

    parsed = parse_user_input(request.user_input)
    request.question = parsed.query or None
    request.context = parsed.context_chunks or None
    if request.assistant_response is not None and request.answer is None:
        request.answer = request.assistant_response
    if request.kind == "privacy" and not request.text:
        # Privacy scans the full surface (input + answer) when no explicit
        # ``text`` was supplied.
        parts = [request.user_input, request.assistant_response]
        request.text = "\n\n".join(p for p in parts if p)
    context_text = "\n\n".join(parsed.context_chunks)
    language = _bridge_resolve_language(
        response_text=request.answer or request.assistant_response,
        query=parsed.query or None,
        raw_context=context_text,
    )
    return DemoTraceParseInfo(
        mode=parsed.mode,
        query=parsed.query or None,
        context_char_count=len(context_text),
        context_chunk_count=len(parsed.context_chunks),
        marker_present=parsed.marker_present,
        language=language,
        language_source="auto",
    )


app = create_app()
