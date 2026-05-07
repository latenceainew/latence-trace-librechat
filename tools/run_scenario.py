#!/usr/bin/env python3
"""SDK driver for the Latence TRACE catalogue.

Usage:
    python tools/run_scenario.py \
        --scenario en-placeholder-scaffolding \
        --integration native \
        --bridge-url http://127.0.0.1:8788

Reads a scenario fixture from ``docs/trace-catalogue/scenarios/<use_case>/<id>/``
and POSTs one ``/api/trace/run`` per relevant TRACE feature, mirroring the
in-chat fan-out (``fanoutTraceForTurn`` in
``client/src/components/TraceDemo/TraceDemoShell.tsx``). Each raw response is
written to ``docs/trace-catalogue/runs/<scenario_id>/sdk-<integration>-<iso>.json``.

Why this script exists: the LibreChat shell will run these same fixtures
through the same bridge endpoints. Side-by-side dumps in ``runs/`` make the
parity diff trivial and ensure every "qualitative analysis" can be traced
back to a captured artifact.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOGUE_ROOT = REPO_ROOT / "docs" / "trace-catalogue"
SCENARIOS_DIR = CATALOGUE_ROOT / "scenarios"
RUNS_DIR = CATALOGUE_ROOT / "runs"

# Aligned with client/src/components/TraceDemo/traceDemoState.ts
RAG_FEATURES = ["groundedness", "context-util", "memory", "privacy", "compression"]
CODING_FEATURES = ["groundedness", "context-util", "drift", "memory", "privacy", "compression"]
FEATURE_TO_KIND = {
    "groundedness": "rag",
    "context-util": "rag",
    "drift": "rollup",
    "memory": "memory",
    "privacy": "privacy",
    "compression": "compression",
}
INTEGRATION_LABEL = {
    "native": "sdk-librechat",
    "langchain": "langchain-rag",
    "langgraph": "langgraph-code",
    "llamaindex": "llamaindex-rag",
    "n8n": "n8n",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a TRACE catalogue scenario through the SDK bridge.")
    parser.add_argument("--scenario", required=True, help="scenario id (folder name under scenarios/<use_case>/).")
    parser.add_argument(
        "--integration",
        choices=["native", "langchain", "langgraph", "llamaindex", "n8n"],
        default="native",
    )
    parser.add_argument(
        "--bridge-url",
        default="http://127.0.0.1:8788",
        help="Base URL of the demo bridge.",
    )
    parser.add_argument(
        "--features",
        default="auto",
        help="Comma-separated feature list, or 'auto' to use the use-case default.",
    )
    parser.add_argument(
        "--seed-answer",
        action="store_true",
        help="Use seed_answer.md as the assistant answer (skips the LLM call).",
    )
    parser.add_argument(
        "--answer",
        default=None,
        help="Override the assistant answer with literal text (or @path/to/file).",
    )
    parser.add_argument("--timeout", type=float, default=600.0)
    parser.add_argument("--out-dir", default=None, help="Override the runs/ output directory.")
    parser.add_argument(
        "--profile",
        default="quality",
        choices=["standard", "quality"],
        help="TRACE runtime profile passed via metadata.trace_extra (default quality).",
    )
    parser.add_argument(
        "--triangular",
        action="store_true",
        help="Enable include_triangular_diagnostics (default off so reverse_context drives the headline).",
    )
    parser.add_argument(
        "--variant",
        default=None,
        help="Optional tag appended to the run filenames (e.g. 'seed', 'adversarial').",
    )
    args = parser.parse_args()

    scenario = _load_scenario(args.scenario)
    if scenario is None:
        print(f"error: scenario '{args.scenario}' not found under {SCENARIOS_DIR}", file=sys.stderr)
        return 2

    use_case = scenario["manifest"]["use_case"]
    features = _resolve_features(args.features, use_case)
    answer = _resolve_answer(args, scenario)
    question = (scenario.get("question") or "").strip()
    chunks = scenario.get("chunks") or []

    if not question:
        print("error: scenario.question.md is empty", file=sys.stderr)
        return 2
    if not answer:
        print(
            "error: no answer available — pass --seed-answer or --answer to provide one",
            file=sys.stderr,
        )
        return 2

    out_dir = Path(args.out_dir) if args.out_dir else (RUNS_DIR / scenario["manifest"]["id"])
    out_dir.mkdir(parents=True, exist_ok=True)

    iso = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    summary: dict[str, Any] = {
        "scenario_id": scenario["manifest"]["id"],
        "use_case": use_case,
        "integration": args.integration,
        "integration_label": INTEGRATION_LABEL.get(args.integration, args.integration),
        "bridge_url": args.bridge_url,
        "iso": iso,
        "features": features,
        "results": {},
    }

    print(
        f"Running scenario '{scenario['manifest']['id']}' through {args.integration} bridge "
        f"({len(features)} features)..."
    )

    trace_extra = {
        "profile": args.profile,
        "include_triangular_diagnostics": bool(args.triangular),
    }
    for feature in features:
        kind = _kind_for_feature(feature, use_case)
        request_body = _build_request(
            scenario=scenario,
            feature=feature,
            kind=kind,
            integration=args.integration,
            question=question,
            answer=answer,
            chunks=chunks,
            trace_extra=trace_extra,
        )
        started = time.perf_counter()
        try:
            response = _post_json(
                f"{args.bridge_url.rstrip('/')}/api/trace/run", request_body, timeout=args.timeout
            )
            status = "ok"
            error = None
        except (HTTPError, URLError, TimeoutError) as exc:
            response = None
            status = "error"
            error = str(exc)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)

        record = {
            "feature": feature,
            "kind": kind,
            "request": request_body,
            "response": response,
            "status": status,
            "error": error,
            "elapsed_ms": elapsed_ms,
        }
        summary["results"][feature] = {
            "status": status,
            "error": error,
            "elapsed_ms": elapsed_ms,
            "risk_band": (response or {}).get("risk_band") if isinstance(response, dict) else None,
        }
        variant_tag = f"-{args.variant}" if args.variant else ""
        feature_path = out_dir / f"sdk-{args.integration}-{feature}{variant_tag}-{iso}.json"
        feature_path.write_text(json.dumps(record, indent=2, sort_keys=True), encoding="utf-8")
        flag = "ok " if status == "ok" else "ERR"
        band = summary["results"][feature]["risk_band"] or "-"
        print(f"  [{flag}] {feature:<14} band={band:<7} {elapsed_ms:>7.0f}ms -> {feature_path.name}")

    variant_tag = f"-{args.variant}" if args.variant else ""
    summary["trace_extra"] = trace_extra
    summary_path = out_dir / f"sdk-{args.integration}-summary{variant_tag}-{iso}.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    print(f"summary: {summary_path}")
    return 0


def _load_scenario(scenario_id: str) -> dict[str, Any] | None:
    if not re.match(r"^[a-z0-9][a-z0-9_-]{0,80}$", scenario_id):
        return None
    if not SCENARIOS_DIR.exists():
        return None
    for use_case_dir in SCENARIOS_DIR.iterdir():
        candidate = use_case_dir / scenario_id
        if not candidate.is_dir():
            continue
        manifest_path = candidate / "scenario.json"
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.setdefault("id", scenario_id)
        manifest.setdefault("use_case", use_case_dir.name)
        bundle: dict[str, Any] = {"manifest": manifest, "scenario_dir": str(candidate)}
        for filename, key in (
            ("corpus.md", "corpus"),
            ("question.md", "question"),
            ("seed_answer.md", "seed_answer"),
            ("notes.md", "notes"),
        ):
            path = candidate / filename
            bundle[key] = path.read_text(encoding="utf-8") if path.exists() else None
        bundle["chunks"] = _split_corpus_chunks(bundle["corpus"]) if bundle.get("corpus") else []
        return bundle
    return None


def _split_corpus_chunks(text: str) -> list[str]:
    if not text:
        return []
    parts = re.split(r"(?m)^(?=##\s)", text.strip())
    chunks = [chunk.strip() for chunk in parts if chunk.strip()]
    if len(chunks) > 1:
        return chunks
    paras = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
    return paras or [text.strip()]


def _resolve_features(value: str, use_case: str) -> list[str]:
    if value == "auto":
        return CODING_FEATURES if use_case == "coding-agent" else RAG_FEATURES
    return [item.strip() for item in value.split(",") if item.strip()]


def _kind_for_feature(feature: str, use_case: str) -> str:
    if feature in {"groundedness", "context-util"}:
        return "code" if use_case == "coding-agent" else "rag"
    return FEATURE_TO_KIND[feature]


def _resolve_answer(args: argparse.Namespace, scenario: dict[str, Any]) -> str:
    if args.answer:
        if args.answer.startswith("@"):
            return Path(args.answer[1:]).read_text(encoding="utf-8").strip()
        return args.answer.strip()
    if args.seed_answer and scenario.get("seed_answer"):
        return scenario["seed_answer"].strip()
    if scenario.get("seed_answer"):
        return scenario["seed_answer"].strip()
    return ""


def _build_request(
    *,
    scenario: dict[str, Any],
    feature: str,
    kind: str,
    integration: str,
    question: str,
    answer: str,
    chunks: list[str],
    trace_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scenario_id = scenario["manifest"]["id"]
    use_case = scenario["manifest"]["use_case"]
    name = f"trace_{use_case}_{feature}_{INTEGRATION_LABEL.get(integration, integration)}".replace("-", "_")
    metadata: dict[str, Any] = {
        "scenario_id": scenario_id,
        "use_case": use_case,
        "feature": feature,
        "integration": INTEGRATION_LABEL.get(integration, integration),
        "source": "tools.run_scenario",
    }
    if trace_extra:
        metadata["trace_extra"] = dict(trace_extra)
    if kind == "privacy":
        # Privacy scans the *full* turn surface: user input (question +
        # context) and the assistant answer. In the chat path the user
        # often pastes context inline, so the planted PII (phone,
        # address, social_security_number) lives in the corpus, not the
        # short question text.
        scan_text = "\n\n".join(
            part for part in [question, "\n\n".join(chunks), answer] if part
        )
        return {
            "scenario": name,
            "integration": integration,
            "kind": kind,
            "text": scan_text,
            "metadata": metadata,
        }
    if kind == "memory":
        return {
            "scenario": name,
            "integration": integration,
            "kind": kind,
            "text": answer,
            "question": question,
            "context": chunks,
            "metadata": metadata,
        }
    if kind == "compression":
        return {
            "scenario": name,
            "integration": integration,
            "kind": kind,
            "question": question,
            "answer": answer,
            "context": chunks,
            "text": f"{chr(10).join(chunks)}\n\nQuestion: {question}\nAnswer: {answer}",
            "metadata": metadata,
        }
    if kind == "rollup":
        return {
            "scenario": name,
            "integration": integration,
            "kind": kind,
            "turns": [
                {"role": "user", "text": question},
                {"role": "assistant", "text": answer},
            ],
            "question": question,
            "answer": answer,
            "context": chunks,
            "metadata": metadata,
        }
    return {
        "scenario": name,
        "integration": integration,
        "kind": kind,
        "question": question,
        "answer": answer,
        "context": chunks,
        "metadata": metadata,
    }


def _post_json(url: str, body: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    payload = json.dumps(body).encode("utf-8")
    req = urlrequest.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


if __name__ == "__main__":
    raise SystemExit(main())
