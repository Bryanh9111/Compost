# Debate 7 Final Synthesis: Compost Phase 1 Revised Plan

**Date**: 2026-04-12
**Participants**: Opus (host), Sonnet (agent), Gemini (CLI), Codex (CLI)
**Rounds**: 2 (opening + rebuttal)

---

## Consensus Items (4/4 agree)

### C1. BUG FIX: derivation_run.layer='L1' is wrong
- **File**: `packages/compost-core/src/pipeline/ingest.ts:132`
- **Fix**: Change `'L1'` to `'L2'` (Python extraction produces facts, which is L2)
- **Impact**: Affects `compost doctor --rebuild` scope decisions
- **Priority**: Must fix BEFORE any other Phase 1 work
- **Vote**: 4/4 (Codex found, Opus confirmed, all agree)

### C2. FTS5/BM25 index must be created in Phase 1
- **Impl**: Add `facts_fts` FTS5 virtual table in new migration `0006_fts5_index.sql`
- **Phase 1**: Maintain index on facts INSERT, but w_bm25 weight = 0.0
- **Phase 2**: Activate BM25 weight + hybrid candidate generation
- **Rationale**: Avoids 100K-fact full rebuild in Phase 2; FTS5 is zero-dependency (SQLite built-in)
- **Vote**: 4/4

### C3. is_noteworthy() gates 4+5 must be in Phase 1 scope
- **Gate 4**: Cosine similarity on raw chunk embeddings (NOT facts — timing constraint)
- **Gate 5**: Novel fact count (post-extraction check, separate from drain-time gate 4)
- **Dependency**: Gate 4 requires embedding service (Step 2) to be complete first
- **Vote**: 4/4

### C4. EmbeddingService interface (pluggable provider)
- **Impl**: `packages/compost-core/src/embedding/types.ts` — interface with `embed(texts: string[]): Promise<Float32Array[]>`
- **Phase 1 provider**: Ollama adapter (nomic-embed-text-v1.5)
- **ONNX fallback**: NOT Phase 1 (3/4 reject; Gemini lone dissent)
- **Error path**: Clear error message with setup instructions if Ollama unavailable
- **Vote**: 4/4 on interface; 3/4 on deferring ONNX

### C5. SLO performance benchmark required
- **Fixture**: 100K facts generator with mixed content (prose + code + dates + filenames + error strings)
- **Harness**: bun bench or manual timer, measure p50/p99 of query()
- **Gate**: p50 < 100ms, p99 < 500ms
- **Corpus**: Must include structured data, not just prose (Codex requirement)
- **Vote**: 4/4

### C6. compost.feedback scope: minimal
- **Impl**: `compost feedback <query_id> <fact_id>` sets `ranking_audit_log.result_selected = TRUE`
- **NOT**: RLHF-style feedback loop
- **Vote**: 4/4 (no objections raised)

---

## Majority Items (3/4 agree)

### M1. Temp table is the correct Stage-1→Stage-2 bridge design
- **For**: Codex (rebuttal), Opus (rebuttal), Gemini (agrees with Sonnet initially but...)
- **Against**: Sonnet (proposes json_each/IN)
- **Resolution**: **Keep temp table**. Codex's rebuttal is decisive: Stage-1 returns `(fact_id, semantic_score)` pairs, not just IDs. json_each only carries one dimension. Encoding two parallel arrays with implicit row-number JOIN is more fragile than a temp table.
- **Vote**: 3/4 (Codex, Opus, Gemini vs Sonnet)

### M2. proper-lockfile: defer to Phase 3
- **For**: Sonnet (YAGNI), Opus (wrong scope), Codex (implicit)
- **Against**: Gemini (wants it as part of single-writer enforcement)
- **Resolution**: **Defer**. Phase 1 has no concurrent LanceDB writers. LanceDB v0.27+ has atomic manifest writes. For `doctor --rebuild`, use an application-level flag (not file lock) to gate ingest during rebuild.
- **Vote**: 3/4

### M3. Step 4 should be explicitly ordered sub-steps
- **For**: Opus (4a/4b/4c), Codex (agrees reordering needed)
- **Against**: Sonnet (lightweight over-engineering, prefers comments)
- **Resolution**: **Accept Opus's sub-steps** but as implementation guidance, not rigid spec. Order: facts INSERT → embedding generation → LanceDB write.
- **Vote**: 3/4 (Opus, Codex, Gemini vs Sonnet)

---

## Disputed Item (2/4 split)

### D1. Chunk table / L1 manifest
- **Codex + Opus**: Need persistent (observe_id, transform_policy, chunk_id) → LanceDB row mapping for rebuild/reconcile
- **Sonnet**: Agrees gap exists but proposes minimal: add to derivation_run + small chunks table
- **Gemini**: Claims atomic rebuild solves this by design
- **Resolution**: **Add chunks table** (Sonnet's minimal proposal). New migration `0006` includes:
  ```sql
  CREATE TABLE chunks (
    chunk_id TEXT PRIMARY KEY,
    observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
    derivation_id TEXT NOT NULL REFERENCES derivation_run(derivation_id),
    chunk_index INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    char_start INTEGER NOT NULL,
    char_end INTEGER NOT NULL,
    transform_policy TEXT NOT NULL,
    embedded_at TEXT,  -- NULL until embedding written to LanceDB
    UNIQUE(observe_id, chunk_index, transform_policy)
  );
  ```
  This gives rebuild the source of truth without over-engineering a separate manifest layer.

---

## Revised Phase 1 Plan (12 steps)

```
Step 0:  BUG FIX — ingest.ts:132 layer='L1' → 'L2' + add derivation for L1 embedding
Step 1:  Migration 0006 — chunks table + facts_fts FTS5 virtual table
Step 2:  packages/compost-core/src/embedding/ — EmbeddingService interface + Ollama adapter
Step 3:  ollama pull nomic-embed-text:v1.5
Step 4a: Ingest pipeline — write facts[] to facts table + maintain FTS5 index
Step 4b: Ingest pipeline — generate embeddings for chunks via EmbeddingService
Step 4c: Ingest pipeline — write embeddings to LanceDB + update chunks.embedded_at
Step 5:  packages/compost-core/src/storage/ — LanceDB wrapper (no proper-lockfile)
Step 6:  is_noteworthy gates 4+5 — gate 4: cosine on raw chunks; gate 5: post-extraction novel fact count
Step 7:  packages/compost-core/src/ranking/ — ranking_profile loader
Step 8:  query/ upgrade — Stage-1 (LanceDB ANN) → Stage-2 (SQLite rerank via temp table, w1 only)
         + access_log append + ranking_audit_log sampling + failure path audit
Step 9:  compost doctor --rebuild L1 — atomic build-then-swap using chunks table
Step 10: compost.feedback CLI + MCP tool (result_selected only)
Step 11: Full test suite + SLO benchmark (100K mixed-content fixture, p50/p99 gate)
```

### Key changes from original plan:
1. **Added Step 0**: Bug fix for layer tag (was not in original plan)
2. **Added Step 1**: New migration for chunks table + FTS5 (was not in original plan)
3. **Reordered**: Embedding interface (Step 2) before ollama pull (Step 3)
4. **Split Step 4**: Into 4a/4b/4c with explicit ordering
5. **Added Step 5**: LanceDB wrapper moved after ingest (was Step 3 originally — now depends on embedding)
6. **Added Step 6**: is_noteworthy gates 4+5 (was missing from original plan)
7. **Removed**: proper-lockfile (deferred to Phase 3)
8. **Enhanced Step 8**: Added failure path audit logging
9. **Enhanced Step 11**: Added SLO benchmark with mixed-content corpus

### Tech debt acknowledged for Phase 2+:
- ONNX/in-process embedding fallback (Gemini's concern — Phase 3)
- BM25 hybrid candidate generation (FTS5 index ready but weight=0 in Phase 1)
- proper-lockfile or advisory lock for concurrent writes (Phase 3 daemon)
- w2-w7 ranking factors activation
- Comprehensive is_noteworthy gate 5 with fact-level semantic dedup
