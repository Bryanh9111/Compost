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

**Daemon ingest worker** (2026-04-13)
- startIngestWorker in scheduler.ts (claims ingest_queue -> Python extract -> embed -> facts/chunks)
- Daemon initializes OllamaEmbeddingService + VectorStore at startup
- drainOne tolerates hook payloads missing occurred_at/mime_type (auto-derives from appended_at)
- Passive capture pipeline now end-to-end: hook -> outbox -> drain -> ingest -> embed

### Phase 3: Consolidation (2026-04-13)

**Batch 0: Phase 2 debt fix**
- Wire rp-phase2-default as default ranking profile (search.ts hardcode fix)

**Batch A: Extraction quality**
- Improved heading-based fact extraction: 14 inferred predicates replace "discusses"
- Object extraction: 2-3 sentences instead of truncated first sentence
- LLM-based fact extraction: local Ollama (gemma3:4b) extracts SPO triples from chunks
- New transform policy tp-2026-04-03

**Batch B: Search quality**
- rp-phase3-default ranking profile: w4_importance=0.1 activated
- Migration 0008: new ranking profile
- Multi-query expansion in compost.ask: LLM generates 2-3 query variants, fan-out search, dedup

**Batch C: Cognitive loop**
- Contradiction detection + resolution in reflect (heuristic: confidence > recency)
- superseded_by + conflict_group tracking
- Wiki rebuild trigger fix: watches archived_at changes (Opus debate 9 bug find)
- Wiki page versioning: wiki_page_versions table, auto-snapshot before rewrite
- Migration 0009: wiki_page_versions + contradiction indexes

**Deferred to Phase 4** (debate 9 consensus: 4/4 agree)
- Episodic memory materialization (no extractor consumer)
- Fact-to-fact links graph (no caller in query/wiki/reflect)
- Semantic chunking / Savitzky-Golay (heading-based adequate for markdown)

Debate 9: 4-way (Opus/Sonnet/Gemini/Codex) plan review, revised to 4 batches

---

## Planned

### Phase 4: Active Learning (weeks 9-12)
- Episodic memory materialization (deferred from Phase 3, needs extractor consumer)
- Fact-to-fact links graph + recursive CTE traversal (deferred from Phase 3, needs caller)
- Semantic chunking / Savitzky-Golay (deferred from Phase 3, evaluate on real corpus)
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
| Self-maintaining knowledge | 3 | **Done** -- contradiction arbitration, wiki rebuild, LLM extraction |
| Self-evolving | 4 | Three ingest paths live (push + sniff + crawl) |
| Portable | 5 | Clone to new machine, knowledge survives |
| Ecosystem | 6 | Multiple host adapters + source types |
