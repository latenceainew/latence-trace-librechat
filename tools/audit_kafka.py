#!/usr/bin/env python3
"""
Audit script: read the de-kafka-rossmann SDK runs and print a metric-by-metric
verdict, comparing TRACE output to known semantic ground truth from the corpus.

We exclude privacy here per request; everything else is in scope.
"""
from __future__ import annotations

import json
from pathlib import Path
from textwrap import indent

RUNS = Path("docs/trace-catalogue/runs/de-kafka-rossmann")
SEED_TAG = "audit-seed"
ADV_TAG = "audit-adv"


def load(feature: str, tag: str) -> dict:
    matches = sorted(RUNS.glob(f"sdk-native-{feature}-{tag}-*.json"))
    if not matches:
        raise FileNotFoundError(f"No file for {feature} / {tag}")
    payload = json.loads(matches[-1].read_text())
    response = payload.get("response") or {}
    raw = response.get("raw") or {}
    return {
        "raw": raw,
        "response": response,
        "request": payload.get("request") or {},
    }


def fmt(v, p: int = 3) -> str:
    if v is None:
        return "None"
    if isinstance(v, float):
        return f"{v:.{p}f}"
    return str(v)


def section(title: str) -> None:
    print()
    print("=" * 78)
    print(f"  {title}")
    print("=" * 78)


def audit_groundedness() -> None:
    section("1) GROUNDEDNESS — score, band, NLI claims, atoms, unsupported_spans")

    seed_pkg = load("groundedness", SEED_TAG)
    adv_pkg = load("groundedness", ADV_TAG)

    for label, pkg in [("SEED (faithful)", seed_pkg), ("ADVERSARIAL (wrong)", adv_pkg)]:
        raw = pkg["raw"]
        resp = pkg["response"]
        print(f"\n--- {label} ---")
        scores = raw.get("scores") or {}
        rd = raw.get("runtime_decision") or {}
        nli = raw.get("nli_diagnostics") or {}
        comp = raw.get("composite") or {}

        print(f"  trace_score           : {fmt(raw.get('trace_score'))}")
        print(f"  groundedness_v2       : {fmt(scores.get('groundedness_v2'))}")
        print(f"  faithfulness          : {fmt(scores.get('faithfulness'))}")
        print(f"  context_relevance     : {fmt(scores.get('context_relevance'))}")
        print(f"  composite.calibrated_mean: {fmt(comp.get('calibrated_mean'))}")
        print(f"  runtime band          : {rd.get('band')}")
        print(f"  runtime decision      : {rd.get('decision')}")
        print(f"  unsupported_claim_frac: {fmt(rd.get('features', {}).get('unsupported_claim_fraction'))}")
        print(f"  unsupported_spans (n) : {len(rd.get('unsupported_spans') or [])}")
        if rd.get("unsupported_spans"):
            for s in rd["unsupported_spans"]:
                print(f"    -> token='{s.get('token')}' [{s.get('char_start')}:{s.get('char_end')}] "
                      f"heatmap={fmt(s.get('heatmap_score'))} nli={fmt(s.get('nli_score'))}")

        claims = (nli or {}).get("claims") or []
        print(f"  nli_diagnostics.claims: n={len(claims)}")
        for i, c in enumerate(claims):
            txt = (c.get("text") or "").strip().replace("\n", " ")
            if len(txt) > 110:
                txt = txt[:107] + "..."
            print(f"    [{i}] ent={fmt(c.get('entailment'))} neu={fmt(c.get('neutral'))} "
                  f"con={fmt(c.get('contradiction'))} score={fmt(c.get('score'))} "
                  f"chars=[{c.get('char_start')}:{c.get('char_end')}]")
            print(f"        {txt}")
            atoms = c.get("atoms") or []
            for j, a in enumerate(atoms):
                atxt = (a.get("text") or "").strip()
                if len(atxt) > 100:
                    atxt = atxt[:97] + "..."
                print(f"        atom[{j}] ent={fmt(a.get('entailment'))} con={fmt(a.get('contradiction'))} "
                      f"score={fmt(a.get('score'))} :: {atxt}")


def audit_context_util() -> None:
    section("2) CONTEXT UTILITY — file_attribution, owner_share, dead_weight_ratio")

    for label, tag in [("SEED", SEED_TAG), ("ADVERSARIAL", ADV_TAG)]:
        print(f"\n--- {label} ---")
        pkg = load("context-util", tag)
        raw = pkg["raw"]
        resp = pkg["response"]
        fa = raw.get("file_attribution") or {}
        per_file = fa.get("per_file") or []
        per_file_sorted = sorted(per_file, key=lambda x: x.get("owner_share", 0), reverse=True)
        print(f"  dead_weight_ratio       : {fmt(fa.get('dead_weight_ratio'))}")
        print(f"  context_coverage_ratio  : {fmt(raw.get('context_coverage_ratio'))}")
        print(f"  context_unused_ratio    : {fmt(raw.get('context_unused_ratio'))}")
        print(f"  per_file (top by owner_share):")
        for pf in per_file_sorted[:6]:
            cid = pf.get("file_id") or pf.get("path") or "?"
            print(f"    {cid:18s}  owner_share={fmt(pf.get('owner_share'))}  "
                  f"contribution={fmt(pf.get('contribution_score'))}  "
                  f"dead_weight={fmt(pf.get('dead_weight_ratio'))}")


def audit_memory() -> None:
    section("3) MEMORY — actions and hot context")

    for label, tag in [("SEED", SEED_TAG), ("ADVERSARIAL", ADV_TAG)]:
        print(f"\n--- {label} ---")
        pkg = load("memory", tag)
        raw = pkg["raw"]
        resp = pkg["response"]
        actions = raw.get("actions") or []
        next_state = raw.get("next_memory_state") or raw.get("memory_state") or {}
        print(f"  trace_score           : {fmt(raw.get('trace_score'))}")
        print(f"  actions (n)           : {len(actions)}")
        for a in actions[:8]:
            kind = a.get("type") or a.get("kind") or "?"
            preview = (a.get("text") or a.get("payload") or "")
            if isinstance(preview, dict):
                preview = json.dumps(preview, ensure_ascii=False)[:80]
            else:
                preview = str(preview)[:80]
            print(f"    - {kind:14s} :: {preview}")
        if isinstance(next_state, dict):
            keys = list(next_state.keys())
            print(f"  next_memory_state keys: {keys}")
            slots = next_state.get("slots") or next_state.get("hot_context") or {}
            if isinstance(slots, dict):
                for k, v in list(slots.items())[:5]:
                    sv = json.dumps(v, ensure_ascii=False)[:90] if not isinstance(v, str) else v[:90]
                    print(f"    slot[{k}] :: {sv}")


def audit_compression() -> None:
    section("4) COMPRESSION — preserved/dropped terms and ratio")

    for label, tag in [("SEED", SEED_TAG), ("ADVERSARIAL", ADV_TAG)]:
        print(f"\n--- {label} ---")
        pkg = load("compression", tag)
        raw = pkg["raw"]
        resp = pkg["response"]
        report = raw.get("report") or {}
        print(f"  ratio                 : {fmt(raw.get('ratio'))}")
        print(f"  tokens_in / tokens_out: {raw.get('tokens_in')} / {raw.get('tokens_out')}")
        print(f"  tokens_saved          : {raw.get('tokens_saved')}")
        compressed = raw.get("compressed_text") or raw.get("text") or ""
        if compressed:
            preview = compressed.strip().replace("\n", " ")[:240]
            print(f"  compressed_text preview:")
            print(indent(preview, "    "))
        preserved = report.get("preserved_terms") or raw.get("preserved_terms") or []
        dropped = report.get("dropped_terms") or raw.get("dropped_terms") or []
        print(f"  preserved_terms (n={len(preserved)}): {preserved[:20]}")
        print(f"  dropped_terms   (n={len(dropped)}): {dropped[:20]}")


if __name__ == "__main__":
    audit_groundedness()
    audit_context_util()
    audit_memory()
    audit_compression()
