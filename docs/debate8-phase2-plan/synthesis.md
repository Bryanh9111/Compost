# Debate 8 Final Synthesis: Compost Phase 2 Revised Plan

**Date**: 2026-04-12
**Participants**: Opus (host), Sonnet (agent), Gemini (CLI), Codex (CLI)
**Rounds**: 2 (opening + rebuttal)

---

## Consensus Items (4/4 agree)

### C1. FTS5 backfill required before BM25 activation
- **Bug**: Phase 1 FTS5 triggers only sync new writes. Pre-existing facts are missing from FTS5.
- **Fix**: Migration 0007 includes `INSERT INTO facts_fts(facts_fts) VALUES('rebuild')` for full-text index reconstruction.
- **Vote**: 4/4 (Codex found, all agree)

### C2. RRF for BM25+ANN candidate merge
- **Strategy**: Reciprocal Rank Fusion (rank-based, score-agnostic)
- **k parameter**: Must be benchmarked, not defaulted to k=60
- **Architecture**: BM25 is a parallel retriever (Stage-0a), NOT a ranking weight in ranking_profile
- **Vote**: 4/4

### C3. BM25 must work as independent fallback
- **Bug**: Current `query()` returns empty if vectorStore absent — BM25 can never fire alone
- **Fix**: Refactor query() control flow so BM25 is first-class, not gated behind LanceDB
- **Vote**: 4/4

### C4. New transform_policy for web content
- **ID**: `tp-2026-04-02`
- **Rationale**: Current tp-2026-04 tuned for markdown/file. Web needs trafilatura normalization.
- **Vote**: 4/4

### C5. compost.ask = query() + LLM synthesis (NOT independent retrieval)
- **Architecture**: `ask` calls `query()` internally, adds wiki context, sends to LLM
- **Returns**: `{answer: string, hits: QueryHit[], wiki_pages_used: string[]}`
- **Vote**: 4/4

### C6. LLMService interface (parallel to EmbeddingService)
- **Default**: Local Ollama (zero API cost)
- **Optional**: API providers (Anthropic, OpenAI) via config
- **kb-core**: Only interface, no SDK imports
- **Vote**: 4/4

### C7. web_fetch_state table required
- **Columns**: source_id, etag, last_modified, last_fetched_at, next_check_at, consecutive_failures, backoff_until
- **Location**: Migration 0007
- **Vote**: 4/4 (Codex proposed, Opus agreed, Sonnet/Gemini conceded)

### C8. Active freshness loop (NOT lazy TTL)
- **Rationale**: Freshness is a core product promise. Lazy TTL = query-time cache invalidation, not proactive freshness.
- **Implementation**: `startFreshnessLoop()` in scheduler.ts, polls web_fetch_state.next_check_at
- **Vote**: 3/4 (Codex, Opus, Sonnet agree; Gemini prefers lazy but concedes)

---

## Critical Pre-Requisite (from Codex)

### P0. Fix chunk→fact mapping before hybrid retrieval
- **Bug**: `ingest.ts:256` uses round-robin mapping; overflow chunks collapse onto last fact
- **Impact**: RRF quality depends on accurate chunk→fact linkage
- **Fix**: Python extractor outputs `chunk_id → fact_ids[]` mapping. New `chunk_facts` join table or explicit association during ingest.
- **Timing**: Must land BEFORE BM25 hybrid (Step 2)
- **Vote**: 4/4 (Codex raised, all agree in rebuttal)

---

## Execution Order (strict dependency chain)

```
Step 0:  Fix chunk→fact mapping in Python extractor + ingest.ts
Step 1:  Migration 0007 — FTS5 backfill + web_fetch_state + rp-phase2-default profile
Step 2:  w2_temporal activation (profile switch, no code change)
Step 3:  BM25 hybrid retrieval — Stage-0a (FTS5) + Stage-0b (ANN) → RRF merge → Stage-2 rerank
         + query() refactor so BM25 works without vectorStore
Step 4:  tp-2026-04-02 + web.py extractor (trafilatura) + web URL adapter
Step 5:  Freshness loop in scheduler.ts + web_fetch_state lifecycle
Step 6:  LLMService interface + Ollama adapter
Step 7:  L3 wiki synthesizer (triggered by reflect scheduler)
Step 8:  compost.ask (query + wiki + LLM synthesis)
Step 9:  Tests + RRF k-parameter benchmark + SLO verification
```

### Batch groupings (for PR/deploy cadence)
- **Batch A** (Steps 0-3): Search quality — no new runtime deps, pure algorithm
- **Batch B** (Steps 4-5): Web ingest — new I/O path, Python dep (trafilatura)
- **Batch C** (Steps 6-8): LLM layer — new runtime dep (Ollama for generation)
- **Step 9**: Cross-cutting validation

---

## Definition of Done

### Batch A (Search Quality)
- [ ] chunk→fact mapping is explicit, not round-robin
- [ ] FTS5 returns results for pre-existing facts after migration
- [ ] Temporal decay: older facts rank lower than newer (time-travel test)
- [ ] BM25-only query returns results when vectorStore=null
- [ ] Hybrid query: keyword-exact matches appear in results (e.g., filenames, error strings)
- [ ] RRF k parameter benchmarked on mixed corpus
- [ ] SLO: p50<100ms p99<500ms maintained

### Batch B (Web Ingest)
- [ ] `compost add <url>` ingests web page via trafilatura
- [ ] web_fetch_state tracks ETag/Last-Modified/next_check_at
- [ ] Freshness loop re-fetches due sources, skips 304 responses
- [ ] Failure backoff: consecutive_failures increments, backoff_until delays retry
- [ ] tp-2026-04-02 registered and used for web sources

### Batch C (LLM Layer)
- [ ] LLMService interface defined in compost-core
- [ ] Ollama adapter works with local model (qwen3.5 or similar)
- [ ] Wiki synthesis produces markdown from facts, stored in wiki_pages + disk
- [ ] compost.ask returns {answer, hits, wiki_pages_used}
- [ ] ask uses same query() path (no independent retrieval)
- [ ] LLM calls have timeout + error handling

---

## Tech Debt for Phase 3+
- RRF k auto-tuning from ranking_audit_log feedback
- BM25 on chunks (Gemini's proposal — currently fact-level only)
- Wiki staleness detection (L3 vs L2 freshness comparison)
- Contradiction arbitration when web sources conflict with local sources
- w3_access + w4_importance activation
- ONNX embedding fallback
