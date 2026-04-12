# Compost Roadmap

## Completed

### Phase 0: Encoding + Storage (2026-04-11)
- SQLite WAL provenance ledger (L0) with 5 initial migrations
- Observe outbox with crash-safe drain transaction
- Ingest queue with lease protocol (60s lease, heartbeat, poison-pill quarantine)
- Python extraction subprocess (markdown chunking + heading-based facts)
- is_noteworthy 3-gate dedup (raw hash, norm hash, MinHash jaccard)
- Reflect: sensory hard-GC (7d TTL) + semantic soft-tombstone
- Claude Code hook shim (p95 < 30ms cold start)
- CLI: daemon, add, query (stub), doctor, hook, reflect, drain
- MCP server: compost.observe, compost.query (stub), compost.reflect
- 6 architecture debates (Opus/Sonnet/Gemini/Codex), 3 surveys

### Phase 1: Semantic Retrieval (2026-04-12)
- EmbeddingService interface + Ollama adapter (nomic-embed-text-v1.5, 768d)
- VectorStore (LanceDB) with search/add/delete/rebuild
- End-to-end ingest: outbox -> drain -> Python extract -> facts INSERT -> chunk embedding -> LanceDB
- Migration 0006: chunks table (L1 manifest) + FTS5 virtual table + triggers
- Query: LanceDB ANN Stage-1 -> SQLite rerank Stage-2 (w1_semantic only)
- ranking_profile loader + access_log + ranking_audit_log telemetry
- is_noteworthy gates 4+5 (cosine dedup + novel fact count)
- compost doctor --rebuild L1 (atomic build-then-swap)
- compost.feedback (result_selected marking)
- Bug fix: derivation_run.layer='L1' -> 'L2'
- Debate 7: 4-way plan review, 12-step revised plan

### Phase 2: Hybrid Search + Web + LLM (2026-04-12)
**Batch A (Search Quality)**
- Fix chunk->fact round-robin mapping (explicit source_chunk_ids)
- Migration 0007: FTS5 backfill + web_fetch_state table + rp-phase2-default
- BM25 hybrid retrieval: FTS5 Stage-0a + LanceDB Stage-0b + RRF merge
- BM25 works as independent fallback when LanceDB unavailable
- w2_temporal + w3_access activation in rp-phase2-default
- FTS5 query preprocessing (OR-join words for recall)

**Batch B (Web Ingest)**
- tp-2026-04-02 transform policy for web content
- trafilatura HTML extractor (Python) with fallback
- Web URL ingest pipeline with ETag/Last-Modified conditional requests
- compost add <url> CLI support
- Active freshness loop in daemon scheduler (60s poll)
- web_fetch_state lifecycle (304 skip, failure backoff)

**Batch C (LLM Layer)**
- LLMService interface + Ollama adapter
- L3 wiki synthesizer: facts -> markdown via LLM
- compost.ask: hybrid query + wiki context + LLM synthesis
- compost.ask MCP tool

**Dogfood fixes**
- BM25 multi-word query (FTS5 MATCH implicit AND -> OR)
- Web ingest FK constraint (source not yet registered)
- CLI add/query embedding connection

Debate 8: 4-way Phase 2 plan review, 10-step revised plan

---

## In Progress

### Phase 3: Consolidation (estimated weeks 6-8)

**Episodic memory**
- memory_episodic link table (fact_id -> episode metadata)
- Extractor outputs episodic_metadata (event_type, participants, occurred_at)

**Ranking factors**
- w4_importance activation
- w5_emotional (Phase 4)
- w6_repetition_penalty (Phase 4)
- w7_context_mismatch (Phase 4)

**Contradiction arbitration**
- Detect conflicting facts (same subject+predicate, different object)
- Arbitration rules: newer > higher-confidence > multi-source > conflict flag
- superseded_by + conflict_group activation

**Reflect completion**
- Contradiction resolution in reflect cycle
- Wiki rebuild trigger (L3 vs L2 freshness comparison)
- Fact consolidation

**Tech debt**
- ONNX embedding fallback (local, no Ollama dependency)
- proper-lockfile for concurrent LanceDB access
- RRF k parameter benchmarking on real corpus
- BM25 on chunks (currently fact-level only)

---

## Planned

### Phase 4: Active Learning (weeks 9-12)
- Curiosity agent: detect knowledge gaps, generate SearchPlan
- Gap tracker: from query failure signals -> "what you don't know"
- Autonomous crawl with is_noteworthy semantic gates
- memory_procedural standalone table (skills, never forgotten)

### Phase 5: Multi-Host (later)
- Cross-machine sync protocol (explicit export/import)
- HTTP transport for remote MCP clients
- compost export / compost import
- Multi-host concurrency coordination

### Phase 6: Ecosystem (later)
- More adapters: compost-adapter-openclaw, hermes, airi
- More source types: PDF (docling), code repos, video transcripts
- compost relearn (re-subscribe sources on new machine)
- Prometheus/OpenTelemetry metrics export

---

## Milestones

| Milestone | Phase | What it means |
|-----------|-------|---------------|
| Queryable with manual maintenance | 2 | **Done** -- add/query/ask all work |
| Self-evolving | 4 | Three ingest paths live (push + sniff + crawl) |
| Portable | 5 | Clone to new machine, knowledge survives |
| Ecosystem | 6 | Multiple host adapters + source types |
