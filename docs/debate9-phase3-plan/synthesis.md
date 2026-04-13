# Debate 9 Synthesis: Compost Phase 3 Execution Plan

## Participants
- **Opus** (deep architecture) — read source code, identified LLM-fact-extraction as missing item
- **Sonnet** (product strategy) — read source code, identified rp-phase1-default bug and data quality bottleneck
- **Gemini** (pragmatic engineering) — challenged GBrain ports as research-masquerading-as-engineering
- **Codex** (systems reliability) — flagged identity drift, missing backfill strategy, single-writer hazards

## Unanimous Consensus (4/4)

### 1. `rp-phase1-default` hardcode is a Phase 2 bug — fix before Phase 3
All four participants independently identified that `search.ts:144` hardcodes `"rp-phase1-default"`, making Phase 2's w2_temporal dead weight. One-line fix. Must ship first.

### 2. Fact extraction quality is THE bottleneck
All four agree: heading-based extraction producing `predicate: "discusses"` with truncated objects makes downstream features (contradiction, graph, wiki) meaningless. **This is the biggest missing item in the original plan.**

### 3. Item 2 (w3/w4 activation) is correctly scoped and immediately valuable
Profile row update + default wiring. Half a day. No disagreement.

### 4. Items 1 (episodic) and 6 (fact links) should be deferred
- Episodic: no extractor emits episodic_metadata, no consumer exists (Opus)
- Fact links: no write path defined, no caller in query/wiki/reflect (Opus, Gemini, Codex)

### 5. Items 3 and 4 must merge and depend on better extraction
Contradiction arbitration is meaningless when all predicates are "discusses" — you'll never find two facts with the same subject from different sources. Hard ordering dependency.

## Strong Consensus (3/4)

### 6. Item 8 (semantic chunking) needs rescoping
- **Opus**: Chunking fixes L1 but not L2 — need LLM-based fact extraction alongside it
- **Sonnet**: Highest-leverage item, should be Sprint 1
- **Gemini**: Over-engineered — fix `extract_facts` in markdown.py instead (30-line change)
- **Codex**: Necessary but requires new transform policy + recompute path

**Resolution**: Do BOTH. Quick fix to `extract_facts` predicates (Gemini's 30-line change) PLUS semantic chunking as a new policy. The quick fix is immediate; chunking is Sprint 1.

### 7. Item 7 (multi-query expansion) has latency concerns
- Opus: 8-12s latency, needs parallel LLM or lighter model
- Gemini: 3-5x latency cost, unproven benefit, defer pending A/B
- Sonnet: Valuable for compost.ask, small effort
- Codex: Near-duplicate flooding in RRF

**Resolution**: Implement for `compost.ask` only (not `compost.query`), use lighter model for expansion, measure before making default.

## Key Missing Items Identified

| Missing Item | Identified By | Priority |
|-------------|-------------|----------|
| **LLM-based fact extraction** (replace heading heuristic) | Opus, Gemini | CRITICAL — prerequisite to items 3/4/5/6 |
| **Backfill/migration strategy** for re-chunking | Opus, Codex | HIGH — embedding drift when chunk boundaries change |
| **Evaluation harness** (retrieval regression checks) | Codex | HIGH — no way to measure if changes improve quality |
| **LLMService batch/parallel** support | Opus | MEDIUM — needed by expansion + LLM fact extraction |
| **FTS5 UPDATE trigger** verification | Opus | LOW — may already work, needs verification |

## Revised Phase 3 Plan

### Batch 0: Phase 2 Debt (1 day)
- Wire `rp-phase2-default` as default in search.ts
- Verify w2/w3/w4 are non-zero in query results

### Batch A: Extraction Quality (1 week)
- Fix `extract_facts` predicate/object quality in markdown.py (quick win, 30-line change)
- NEW: LLM-based fact extraction for richer triples (new transform policy `tp-2026-04-03`)
- Semantic chunking (Savitzky-Golay or simpler paragraph-embedding approach)
- Vector migration strategy: new policy key, old+new coexist, `compost doctor --rebuild L1` for migration

### Batch B: Search Quality (3 days)
- Item 2: w3_access + w4_importance activation (profile row + default)
- Item 7: Multi-query expansion (compost.ask only, lighter model, measure latency)

### Batch C: Cognitive Loop (1 week)
- Items 3+4 merged: Contradiction detection + resolution in reflect
- Item 5: Wiki rebuild trigger (watch both created_at AND archived_at per Opus's bug find)
- Item 9: Wiki page versioning (cheap, ship alongside wiki rebuild)

### Deferred
- Item 1 (episodic memory): Until extractor emits episodic_metadata
- Item 6 (fact links graph): Until a consumer (query/wiki/reflect) needs it
- Evaluation harness: Should be built but not blocking — use manual dogfooding

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| SQLite single-writer + LLM in reflect | Arbitration is heuristic-only (no LLM), release lock between operations |
| Embedding drift on re-chunking | New transform policy, old vectors coexist, explicit rebuild command |
| Wiki churn from freshness loop | Change detection threshold: only rebuild when >10% of facts changed |
| "Newer erases historically true" | Contradiction log (don't delete loser, archive with superseded_by) |
| FTS5 UPDATE coherence | Verify triggers handle UPDATE, add test |

## Vote Tally

| Item | Opus | Sonnet | Gemini | Codex | Verdict |
|------|------|--------|--------|-------|---------|
| Batch 0: rp-phase2-default | YES | YES | YES | YES | **SHIP** |
| Batch A: Better extraction | YES | YES | YES | YES | **SHIP** |
| Batch A: Semantic chunking | YES (with LLM extraction) | YES | NO (fix predicates instead) | YES (with policy versioning) | **SHIP (both approaches)** |
| Batch B: w3/w4 activation | YES | YES | YES | YES | **SHIP** |
| Batch B: Multi-query expansion | YES (with parallel) | YES | DEFER | CAUTION | **SHIP (ask only)** |
| Batch C: Contradiction + reflect | YES (after better extraction) | YES (after better extraction) | YES (after better extraction) | YES (after better extraction) | **SHIP (after Batch A)** |
| Batch C: Wiki rebuild | YES | YES | YES | YES | **SHIP** |
| Batch C: Wiki versioning | YES | DEFER | YES | YES | **SHIP** |
| Item 1: Episodic memory | DEFER | DEFER | DEFER | DEFER | **DEFER** |
| Item 6: Fact links graph | DEFER | DEFER | DEFER | DEFER | **DEFER** |
