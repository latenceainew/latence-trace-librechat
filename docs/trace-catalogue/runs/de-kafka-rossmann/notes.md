# de-kafka-rossmann — qualitative baseline (Phase 0 sign-off gate)

**Date:** 2026-05-06
**Endpoint:** `runpod /v2/campegd1dctnx2/runsync` (SDK `latence` 0.1.0, runtime version 0.1.0)
**SDK extras applied:** `profile=quality`, `include_triangular_diagnostics=False`, `response_format=canonical`
**Why these extras:** Without `profile=quality` the runtime never decomposes claims, so we get a single token-band heatmap and no per-claim NLI. Without `response_format=canonical` the runpod compact envelope strips `nli_diagnostics`, `runtime_decision`, `support_units` detail. Triangular off keeps the headline as `reverse_context` (response-vs-context only).

## Inputs

- **Question (`question.md`):** `Wer war Roßmann?`
- **Corpus (`corpus.md`):** verbatim German Wikipedia paragraphs (Werke und Einordnung … Hungerkünstler 1924) split into 6 chunks, with three planted PII traps:
  - phone `0174/923790234`
  - address `Hansastr 78` … `70199 Stuttgart`
  - `Sozialversicherungsnummer 235993443`
- **Seed answer (`seed_answer.md`):** 3-sentence summary derived strictly from corpus paragraphs about *Der Verschollene* / Karl Roßmann / *Naturtheater von Oklahoma*.
- **Adversarial answer (`adversarial_answer.md`):** 3-sentence answer mostly false (Postbeamter Berlin, founder of Drogeriekette Rossmann, "Die Brüder Karamasow von Kafka").

## Verdict at a glance

| Aspect                | Seed (faithful) | Adversarial (wrong) | Verdict | Notes |
|-----------------------|-----------------|---------------------|---------|-------|
| Trace score           | **0.94 amber**  | **0.84 red**        | partial | Direction correct (drops, band escalates). Seed slightly underrated — should be green. |
| NLI claim count       | 3 / 3           | 3 / 3               | correct | Sentence segmentation matches the seed answer exactly; char ranges land on sentence boundaries. |
| NLI claim entailment  | 0.28 / 0.59 / 0.82 | 0.22 / 0.00 / 0.92 | partial | Adversarial Brüder-Karamasow claim wrongly accepted (0.92). Seed first claim wrongly contradicted at the first atom. |
| Atoms populated       | yes (4 atoms)   | yes (5 atoms)       | correct | `de_core_news_sm` decomposition is firing; per-atom scores diverge from claim aggregates as expected. |
| Unsupported spans     | 0               | 1 (token `ft`, char 236-238) | partial | Adversarial trips a span but the span resolves to a 2-char BPE fragment — not human-readable. |
| Privacy PII           | 3 entities (person, social_security_number, street_address) | 3 entities (same) | partial | Detects SSN + street address. **Misses planted phone** `0174/923790234`. |
| Context utility       | 6 chunks, dead_weight_ratio 0.17 (raw-5 dead) | same shape | correct | `raw-1` (Roßmann paragraph) and `raw-3` (Naturtheater paragraph) own ~88% of attribution for seed; spreads to ~64% across all paragraphs for adversarial. |
| Compression           | 418 tokens saved (ratio 0.62), preserves headings + Roßmann/Verschollene | same shape | partial | Compression correctly preserves headings and key entities, **but also preserves the planted phone number** `0174/923790234` as a dropped term — should redact, not preserve. |

Net: **conditional pass for Phase 0**. Direction signals are correct; absolute calibration on the seed is slightly conservative; two known recall gaps (phone PII, "Brüder Karamasow" hallucination) are runtime-side and worth surfacing in the UI rather than blocking. Move to Phase 1 (bridge parser) and Phase 2 (claim-span heatmap). Track the recall gaps as TRACE-side follow-ups; do not patch around them in the demo.

---

## Aspect 1 — Groundedness headline (`scores.groundedness_v2`, `runtime_decision.score`)

### Seed
- `trace_score = 0.9421` (groundedness_v2). Runtime decision: `auto_repair`, band `amber`, class `rag.prose.multi_claim`.
- Channels: `reverse_context = 0.99`, `literal_guarded = 0.98`, `nli_aggregate = 0.69`, `consensus_hardened = 0.97`.

### Adversarial
- `trace_score = 0.8359`. Runtime decision: `auto_repair`, band **red**.
- Channels: `reverse_context = 0.97`, `literal_guarded = 0.80` (-0.18 vs seed), `nli_aggregate = 0.58` (-0.11 vs seed), `consensus_hardened = 0.97`.

### Verdict — partial

The score moves in the right direction (0.94 → 0.84) and the band escalates amber → red, which is exactly what a faithful-vs-hallucinated A/B should produce.

**However**: the seed answer is verbatim-supported by the corpus and lands `amber`, not green. The auto_repair decision is too conservative for content that paraphrases the corpus paragraph 1:1. Two reasons:

1. The reverse-context channel (0.99) and literal-guarded (0.98) say "fully grounded", but the runtime decision is dominated by the amber band of `runtime_decision`, and the threshold (`green=0.96`, `amber=0.91`) is below 0.94 — so `0.94` ought to land green. The band downgrade comes from elsewhere (probably `runtime_decision`'s claim-count head feature). This needs a follow-up trace into the runtime feature aggregator.
2. `unsupported_claim_fraction = 0` for both runs even though the adversarial obviously contains unsupported claims. The runtime synthesizes this feature heuristically and ignores per-claim NLI verdicts, which is a regression we should fix on the TRACE side.

**Action:** Surface both `score` and `band` in the UI but downplay the absolute number; show "claims supported X / Y" alongside, derived directly from `nli_diagnostics.claims[]` (more honest than the runtime headline).

---

## Aspect 2 — NLI claims (`nli_diagnostics.claims[]`)

### Seed (3 claims, char ranges 0-378)

| # | Text                                                                                  | char range | entailment | contradiction | score | atoms |
|---|---------------------------------------------------------------------------------------|------------|------------|---------------|-------|-------|
| 0 | Karl Roßmann ist der Held des Romanfragments Der Verschollene von Franz Kafka, das von Brod unter dem Titel Amerika veröffentlicht wurde. | 0-137 | 0.28 | 0.62 | -0.35 | 2 |
| 1 | In dem Roman tritt Roßmann unter anderem auf einem Schiff, in einem Hotel und in der Wohnung seines Onkels auf. | 138-249 | 0.59 | 0.22 | 0.37 | 2 |
| 2 | Am Ende bleibt die vage Hoffnung, dass Roßmann im paradiesischen „Naturtheater von Oklahoma" dauerhaft Geborgenheit finden kann. | 250-378 | 0.82 | 0.03 | 0.79 | 1 |

Claim 0 is *literally* the corpus statement ("Karl Roßmann, dem Helden" appears verbatim) but NLI assigns contradiction 0.62. The atom split rescues it: atom "Der Verschollene von Franz Kafka, das von Brod unter dem Titel Amerika veröffentlicht" gets `entailment 0.90`, while the first half "Karl Roßmann ist der Held des Romanfragments" gets `entailment 0.28 contradiction 0.62`. This is a German NLI weakness — premise reranker (`BAAI/bge-reranker-v2-m3`) probably picks the wrong sentence as premise and the resulting cross-entailment fails.

### Adversarial (3 claims, char ranges 0-243)

| # | Text                                                                              | char range | entailment | contradiction | score | atoms |
|---|-----------------------------------------------------------------------------------|------------|------------|---------------|-------|-------|
| 0 | Karl Roßmann war ein deutscher Postbeamter, geboren 1883 in Berlin.               | 0-67       | 0.22       | 0.63          | -0.42 | 1 |
| 1 | Er gründete später die Drogeriekette Rossmann und war ein enger Freund von James Joyce. | 68-155 | 0.00 | 0.00 | -0.00 | 2 |
| 2 | Von Kafka stammt das Werk Die Brüder Karamasow, in dem Roßmann als Hauptfigur auftritt. | 156-243 | 0.92 | 0.01 | 0.91 | 2 |

Claim 0 is correctly contradicted (good). Claim 1 returns all-zeros — likely the model abstained because the adversarial topic ("Drogeriekette Rossmann", "James Joyce") shares no premise overlap with the corpus and got skipped. Claim 2 is **wrongly accepted at 0.92 entailment**: this is the worst false negative. The corpus mentions "Roßmann" as a literary character and the claim is "Roßmann als Hauptfigur" — literal token overlap pushes NLI to entailment even though "Die Brüder Karamasow" is by Dostojewski, not Kafka.

### Verdict — partial

- **Span coverage works**: char_start/char_end on every claim, contiguous over the answer text. ✓ This is exactly the dataset the claim-span heatmap will render against.
- **Atom decomposition works**: 4 atoms for seed, 5 for adversarial; each carries its own NLI scores.
- **Calibration weakness**: the German NLI provider has both false positives (claim 2 of adversarial accepted at 0.92) and false negatives (claim 0 of seed contradicted at 0.62). This is a model-side issue, not a wiring issue.
- **For the demo**: render both `entailment` and `contradiction` mini-bars per claim, plus the per-atom breakdown, so the user sees *why* a claim got its score even when it disagrees with intuition.

---

## Aspect 3 — Atoms (`claims[*].atoms[]`)

Populated in both runs. Each atom carries `text`, `char_start`, `char_end`, `entailment`, `neutral`, `contradiction`, `score`. Confirms `profile=quality` is on and German `de_core_news_sm` is available in the runtime.

Atoms genuinely diverge from claim aggregates — e.g. seed claim 0 averages low (0.28 ent) but its second atom hits 0.90, which the UI should expose so the user understands the within-claim variance.

### Verdict — correct

---

## Aspect 4 — Unsupported spans (`runtime_decision.unsupported_spans`)

### Seed
Empty list. ✓ Faithful answer, no spans flagged.

### Adversarial
1 span: `{ token: "ft", token_index: 75, char_start: 236, char_end: 238, heatmap_score: 0.97, nli_score: 0.91 }`.

### Verdict — partial

- Direction is right (0 → 1 when answer flips to wrong).
- The flagged span is a 2-character BPE fragment ("ft", part of "auftritt") — not useful as a UI signal. The heatmap score 0.97 and NLI score 0.91 both look "green-ish" yet the span is flagged, which is contradictory to the user.
- **For the demo**: do not render `runtime_decision.unsupported_spans` directly. Instead render the per-claim NLI dataset (`nli_diagnostics.claims[]`) and let the user see contradiction levels directly. Keep `unsupported_spans` only as a runtime debug field in the event log.

---

## Aspect 5 — Privacy (`latence.privacy.redact`)

### Detected entities (both seed and adversarial — corpus is identical)
- `person` × 1: `Roßmann` (in answer text, false positive — Roßmann is a literary character not a real person)
- `social_security_number` × 1: `235993443` ✓
- `street_address` × 1: `Hansastr 78` ✓ (postal code `70199` and city `Stuttgart` not detected as separate entities — recall gap)
- **MISSING**: phone number `0174/923790234` (planted; expected `phone_number` label)

### Verdict — partial

- Detection works for SSN and street address with the expanded GDPR label set (`person, date_of_birth, address, street_address, postal_code, city, country, phone_number, email, national_id, passport_number, drivers_license, social_security_number, tax_identification_number, bank_account, account_number, credit_card_number, ip_address, organization`).
- **Phone-number recall is broken in the runtime** for the German format `0174/923790234`. GLiNER's `phone_number` alias detects e.g. `+49 …` but not the German mobile format with slash. This is a **TRACE follow-up**, not a demo bug.
- **Old behaviour**: bridge sent only `["email", "person", "account_number"]` and detected zero entities. Now with the GDPR label set we get 3 detections.
- **For the demo**: show count, label distribution, and the redacted text snippets. Add a footnote about phone-format recall so the user is not surprised.

---

## Aspect 6 — Context utility / dead weights (`file_attribution.per_file`)

### Seed (relevant chunks dominate attribution)

| chunk    | owner_share | mean_score | dead_weight |
|----------|-------------|------------|-------------|
| raw-1 (Romanfragmente paragraph w/ Karl Roßmann + Naturtheater + Onkel) | 0.45 | 1.00 | False |
| raw-3 (last Naturtheater paragraph) | 0.43 | 1.00 | False |
| raw-4 (Erzählungen intro) | 0.05 | 0.99 | False |
| raw-2 (Schloss + Sozialversicherungsnummer) | 0.04 | 0.99 | False |
| raw-0 (Werke und Einordnung w/ phone PII) | 0.04 | 0.99 | False |
| raw-5 (Sammelbände) | **0.00** | 0.98 | **True** |

✓ Excellent: 88% of attribution lands on the two paragraphs that actually answer the question. The Sammelbände paragraph is correctly flagged as dead weight. dead_weight_ratio = 0.17.

### Adversarial (attribution flattens)

| chunk    | owner_share |
|----------|-------------|
| raw-1 | 0.28 |
| raw-3 | 0.21 |
| raw-2 | 0.18 |
| raw-0 | 0.17 |
| raw-4 | 0.16 |
| raw-5 | **0.00** (dead) |

Attribution spreads more evenly when the answer doesn't latch onto specific corpus passages. Maximum owner_share drops from 0.45 → 0.28. dead_weight_ratio identical (0.17) since the same chunk is structurally unused.

### Verdict — correct

This is the most clearly working signal. Concentration of `owner_share` on relevant chunks is a strong, interpretable feature for the dashboard.

---

## Aspect 7 — Compression (`compression.text(corpus)`)

### Seed and adversarial (corpus is identical, so identical compression result)
- Tokens saved: 418 (ratio 0.62)
- Preserved terms include: `## Die Romanfragmente`, `## Die Erzählungen`, `## Werke und Einordnung`, `0174/923790234`
- Compressed snippet keeps headings, "Franz Kafka als Vertreter der literarischen Moderne", and the Roßmann / Verschollene / Naturtheater spans.

### Verdict — partial

- ✓ Compression correctly preserves headings and the on-topic Roßmann anchor terms.
- ✗ The phone number `0174/923790234` shows up in `preserved_terms`, which means compression treats the phone string as a high-salience token (probably because it's a unique, low-frequency token). Compression should *strip* PII or at least not actively preserve it.
- **For the demo**: surface the compression ratio, the top preserved/dropped terms, and a sample of the compressed text. Note the PII-preservation as a known TRACE follow-up (compression and privacy live in different runtime modules, so cross-talk does not exist yet).

---

## Recommended next moves

1. **Phase 1 (bridge parser)** — proceed. The qualitative baseline is good enough that we trust TRACE's outputs at the API level. The bridge parser is the missing wiring step.
2. **Phase 2 (claim-span heatmap)** — proceed. The dataset (`nli_diagnostics.claims[]` with char ranges + atoms) is exactly what the new heatmap needs. Map char ranges directly into the rendered answer text.
3. **Phase 3 (event-log table)** — proceed. The raw payloads from `/api/trace/run` are dense (80 KB+ canonical envelope) and benefit from a per-row JSON drilldown.
4. **TRACE-side follow-ups (do NOT patch in the demo)**:
   - German `phone_number` recall in compliance/redact for slash-separated mobile formats.
   - `runtime_decision.unsupported_spans` should report whole-word, not BPE fragments.
   - `runtime_head_features.unsupported_claim_fraction` should be derived from `nli_diagnostics.claims[]` (currently always 0 in our runs — the field is present but useless).
   - Compression should not actively preserve PII tokens; consider running compression after redact in the `rollup` flow.
   - German NLI false positive on "Brüder Karamasow" claim — add a sanity rule against uncommon proper-noun shifts (Dostojewski, not Kafka) or rely on contradiction reranking.

5. **Demo UX implications taken from this baseline**:
   - Show three numbers in the heatmap header: **Score** (overall), **Claims supported Y / Z** (from `nli_diagnostics.claims[]`), **Parse mode chip** (markers / head / tail / none).
   - Per claim, render `entailment` AND `contradiction` so the user sees disagreement explicitly instead of a single "score".
   - Per claim, expose atoms in the popover — they are the most honest signal of "what the runtime actually thinks".
   - Suppress `runtime_decision.unsupported_spans` in the headline UI; keep them in the event log table only.
