# Latence TRACE Catalogue

Source of truth for the structured proof matrix described in the methodology
plan. Every fixture lives here and is consumed by:

1. `tools/run_scenario.py` — SDK driver that POSTs to the demo bridge
   (matching the in-chat fan-out exactly).
2. The LibreChat frontend — same files served at `/trace-scenarios/<use_case>/<id>/`
   via a Vite static copy step (see `client/vite.config.ts`).

This guarantees byte-level parity between the SDK baseline and what the user
sees in the chat shell.

## Layout

```
docs/trace-catalogue/
  README.md                       <- this file
  scenarios/
    rag/
      <slug>/
        scenario.json             <- id, title, lang, use_case, source_url, expected_traits
        corpus.md                 <- the long fixture (verbatim from the public source)
        question.md               <- the hard question
        seed_answer.md            <- optional reference / starter answer for parity replays
        notes.md                  <- planted ambiguities, expected heatmap traits
    coding-agent/
      <slug>/
        ... same layout ...
  runs/
    <scenario_id>/
      sdk-<integration>-<iso>.json        <- raw bridge response from runner
      librechat-<integration>-<iso>.json  <- raw bridge response captured from chat
      analysis.md                          <- qualitative checks + parity diff summary
```

## Scenario id convention

```
<lang>-<topic-slug>
```

Examples: `en-eu-ai-act-procurement`, `de-bafin-mar-anomaly`, `en-cpython-bugfix`.

## scenario.json schema

```jsonc
{
  "id": "en-placeholder-scaffolding",
  "title": "Placeholder scenario for scaffolding smoke tests",
  "lang": "en",                              // "en" | "de"
  "use_case": "rag",                         // "rag" | "coding-agent"
  "shape": null,                             // for coding-agent: "bug-fix" | "pr-review" | "feature-impl"
  "source_url": "",                          // public URL of the underlying material
  "model_hint": "google/gemma-4-26b-a4b-it:free",
  "expected_traits": {
    "heatmap_bands": ["green", "amber"],     // expected qualitative band coverage
    "decision_action_in": ["pass", "review"],
    "drift_band_in": ["green", "amber"],
    "min_evidence": 1
  },
  "corpus_chunks": 3,                        // count of chunks corpus.md will be split into
  "tags": ["scaffold", "placeholder"]
}
```

## How to run a scenario through the SDK runner

```bash
python tools/run_scenario.py \
  --scenario en-placeholder-scaffolding \
  --integration native \
  --bridge-url http://127.0.0.1:8788
```

The runner writes one JSON per feature into
`docs/trace-catalogue/runs/<scenario_id>/sdk-<integration>-<iso>.json`.
