# EU AI Act procurement — expectations

Real fixture for Iter 1. Used to validate that TRACE produces realistic,
non-monochrome heatmaps and a defensible decision on a case where the law
is genuinely contested.

## Source provenance

- Sources 1–6 quote Regulation (EU) 2024/1689 (the AI Act) verbatim from the
  EUR-Lex consolidated text:
  https://eur-lex.europa.eu/eli/reg/2024/1689/oj
- Source 7 is Recital 53 of the same Regulation (interpretive guidance).
- Source 8 is a paraphrased summary of the AI Office FAQ on recruitment AI
  systems (May 2025). It is intentionally framed as a non-binding source so
  the model has to weigh it against the Articles.

## Planted ambiguities

1. **Article 6(3) vs Annex III(4)(a)**: Article 6(3)(a) lets a provider
   exempt a system from "high-risk" if it performs a narrow procedural task,
   while Annex III(4)(a) lists CV recruitment as high-risk. The vendor in
   the question explicitly invokes the derogation. The model has to
   recognise that scoring/ranking does not satisfy the derogation, while
   pure field extraction *might* (subject to the profiling carve-out).
2. **Article 27 scope creep**: Article 27 only obliges a fundamental rights
   impact assessment for public bodies, providers of public services, and
   deployers of Annex III(5)(b)/(c) systems. A naive answer would assert
   Article 27 applies to *every* high-risk deployer — that is wrong, and
   the model should hedge.
3. **Profiling carve-out**: The final subparagraph of Article 6(3) reverts
   any Annex III system to high-risk if it profiles natural persons. The
   question 3 hypothetical (field extraction only) only escapes high-risk
   if there is no profiling. Models that miss this line are confidently
   wrong.

## Expected qualitative TRACE traits

- **Heatmap**: at least three distinct band changes across the answer.
  - Tokens citing Annex III(4)(a) and Article 6(2) should land **green**.
  - Tokens stating that ranking is "not a narrow procedural task" should be
    **green** (supported by Source 8).
  - Tokens generalising Article 27 to all deployers without qualification
    should land **amber** or **red**.
  - Tokens about response timing or processing latency, or anything not in
    the corpus, should be **red** (unsupported).
- **Decision**: `runtime_decision.action ∈ {review, retry, block}`. A
  confident "pass" on a contested legal question would be a TRACE failure.
- **Drift**: not evaluated in this RAG cell. Drift belongs to the coding
  agent lane in TRACE and will be exercised in the coding-agent fixtures.
- **Privacy**: 0 entities (corpus and answer are abstract).
- **Dead weights**: Sources 6 and 9 of the corpus (Article 50 transparency
  for emotion recognition; Article 9 risk management) are *partially*
  off-topic and should appear as low-coverage / dead-weight tokens in the
  context utility view. Sources 1, 2, 5, 8 should dominate.
- **Compression**: `compression_ratio > 0.2`; preserved terms should
  include "Annex III", "Article 6(3)", "high-risk", "deployer", "procedural
  task".
- **Min evidence**: at least 2 distinct support units cited.
