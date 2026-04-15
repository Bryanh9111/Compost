# Compost Architecture

## System overview

Compost is a **4-layer knowledge base** with an append-only provenance ledger as the source of truth. All knowledge flows through a single write pipeline (`observe -> drain -> extract -> store`), regardless of whether the source is a local file, web URL, or Claude Code conversation.

## Data flow

### Write path (all adapters unified)

```
1. Source produces event
2. appendToOutbox(db, OutboxEvent) -> INSERT OR IGNORE observe_outbox
3. Daemon drain loop -> drainOne(db):
   a. Claim pending outbox row
   b. Auto-register source (INSERT OR IGNORE INTO source)
   c. Link source_context
   d. INSERT OR IGNORE INTO observations (L0 ledger)
   e. Enqueue into ingest_queue
   f. Ack outbox row
4. Worker claims from ingest_queue (lease protocol: 60s, heartbeat 30s)
5. Bun.spawn Python extractor (stdin JSON -> stdout JSON)
6. INSERT facts (L2) + chunks into SQLite
7. Generate embeddings via OllamaEmbeddingService
8. Write vectors to LanceDB
9. Update chunks.embedded_at
10. Mark derivation_run succeeded + complete queue item
```

Idempotency: `sha256(adapter + source_id + content)` as idempotency_key. Outbox UNIQUE + observations UNIQUE double protection.

### Read path (hybrid retrieval)

```
1. query(db, q, opts, vectorStore)
2. Stage-0a: BM25 via FTS5 (SELECT fact_id WHERE MATCH q, ORDER BY rank, LIMIT 200)
3. Stage-0b: LanceDB ANN (search(q, 200), deduplicate chunks to fact_id)
4. RRF merge: 1/(k + rank_position) for each source, sum per fact_id
5. Populate temp table query_candidates with (fact_id, semantic_score)
6. Stage-2: SQLite rerank with multi-factor formula:
   score = w1*semantic + w2*temporal_decay + w3*access_frequency + w4*importance
7. Return QueryHit[] with ranking_components + provenance
8. Append access_log (telemetry)
9. Sample ranking_audit_log (if debug or env var)
```

BM25 works independently when vectorStore is null (graceful degradation).

### Ask path (LLM synthesis)

```
1. ask(db, question, llm, opts, vectorStore)
2. Internally calls query() with budget=10
3. Gathers relevant wiki_pages by matching hit subjects
4. Reads wiki markdown from disk
5. Builds prompt: question + fact context + wiki context
6. Calls LLMService.generate()
7. Returns {answer, hits, wiki_pages_used}
```

### Reflect path (memory consolidation)

```
1. reflect(db)
2. Sensory hard-GC: DELETE observations WHERE source.kind='sensory' AND captured_at < -7d
   (FK CASCADE deletes facts, chunks, queue entries, captured_items)
3. Semantic soft-tombstone: SET archived_at WHERE importance*decay < 0.001 AND NOT pinned
4. Contradiction arbitration: same subject+predicate, different object
   -> confidence > recency tiebreak, loser gets superseded_by
5. Outbox prune: DELETE WHERE drained > 7d AND NOT quarantined
```

## Database schema (9 migrations, 20 tables)

### Core tables

| Table | Layer | Purpose |
|-------|-------|---------|
| `source` | meta | Registered data sources (file, web, claude-code) |
| `observations` | L0 | Immutable provenance ledger |
| `observe_outbox` | L0 | Crash-safe event buffer |
| `ingest_queue` | L0 | Extraction work queue with lease protocol |
| `facts` | L2 | Subject-predicate-object triples |
| `chunks` | L1 | Text segments with LanceDB vector mapping |
| `wiki_pages` | L3 | LLM-synthesized wiki page registry |
| `derivation_run` | meta | Tracks extraction runs per (observe_id, policy) |
| `ranking_profile` | meta | Configurable ranking weights (w1-w7) |
| `ranking_audit_log` | telemetry | Per-query per-fact scoring breakdown |
| `access_log` | telemetry | Fact access frequency for w3 ranking |
| `web_fetch_state` | L4 | ETag/Last-Modified/backoff for freshness loop |
| `facts_fts` | L1 | FTS5 virtual table for BM25 keyword search |
| `wiki_page_versions` | L3 | Wiki page snapshots before rewrite |

### FK CASCADE chain (critical for reflect GC)

```
observations.observe_id CASCADE -> facts, chunks, ingest_queue, captured_item, derivation_run
observations.observe_id SET NULL -> observe_outbox
facts.fact_id CASCADE -> fact_context, access_log, ranking_audit_log
wiki_pages.path CASCADE -> wiki_page_observe
```

## Module map

### compost-core (pure library, no side effects)

```
src/
  schema/          9 SQL migrations + migrator.ts
  policies/        transform_policy registry (tp-2026-04, tp-2026-04-02, tp-2026-04-03)
  ledger/          outbox.ts (append + drain), noteworthy.ts (5-gate dedup)
  queue/           lease.ts (claim, heartbeat, complete, fail)
  pipeline/        ingest.ts (file), web-ingest.ts (URL)
  embedding/       types.ts (interface), ollama.ts (adapter)
  storage/         lancedb.ts (VectorStore wrapper)
  ranking/         profile.ts (load ranking weights)
  query/           search.ts (hybrid BM25+ANN+rerank), ask.ts (LLM synthesis), feedback.ts
  cognitive/       reflect.ts (GC + tombstone), wiki.ts (L3 synthesis)
  llm/             types.ts (interface), ollama.ts (adapter)
```

### compost-daemon

```
src/
  main.ts          startDaemon/stopDaemon, PID file, Unix socket
  mcp-server.ts    5 MCP tools: observe, query, ask, reflect, feedback
  scheduler.ts     drain loop (1s) + ingest worker (2s) + reflect (6h) + freshness (60s)
```

### compost-ingest (Python)

```
compost_ingest/
  cli.py           stdin JSON -> stdout JSON dispatch
  schema.py        input/output JSON schemas
  extractors/
    markdown.py    paragraph chunking + heading-based fact extraction
    web.py         trafilatura HTML boilerplate removal
```

## Key design principles

1. **kb-core is a pure library** -- no side effects on import, no background threads
2. **Single write pipeline** -- all sources converge to observe_outbox -> drain -> extract
3. **Stateless decay** -- computed at query time via SQL, no background decay jobs
4. **Transform policies are immutable** -- new behavior = new policy key, never mutation
5. **Python extraction boundary** -- ML/NLP lives in a subprocess, Bun never imports Python
6. **Graceful degradation** -- BM25 works without LanceDB, query works without LLM

---

## Phase 4 Pre-P0 contracts (locked 2026-04-14)

> Source: `debates/003-p0-readiness/synthesis.md`. These contracts must be honored
> by all P0 implementations to avoid the schema/ordering bugs the readiness
> debate uncovered.

### Audit log responsibilities (two tables, no overlap)

| Table | Purpose | Write path | Migration |
|-------|---------|-----------|-----------|
| `ranking_audit_log` | **Read path only** -- per-query ranking attribution. One row per (query_id, fact_id). Disabled unless `debug_ranking=true`. | `query/search.ts` | 0004 |
| `decision_audit` | **Cognitive write path only** -- four kinds: `contradiction_arbitration`, `wiki_rebuild`, `fact_excretion`, `profile_switch`. One row per high-cost decision. Always on. | `cognitive/reflect.ts`, `cognitive/wiki.ts`, future profile switcher | 0010 |

Never write the same event to both. If a decision involves ranking (e.g. profile
switch changes ranking weights), it goes to `decision_audit` -- the ranking
side-effects show up later in `ranking_audit_log` per query.

### `facts.archive_reason` enum (frozen for Phase 4)

Aligned with `decision_audit.kind` so each archival is auditable end-to-end.
Changes require a new migration -- this enum is **frozen**.

| Value | Semantic | Audit kind |
|-------|----------|------------|
| `stale` | Decay formula tombstoned (`reflect.ts` step 2). Bulk operation, no audit row per fact. | (none) |
| `superseded` | Replaced by newer fact for same (subject, predicate). `replaced_by_fact_id` MUST be set. | `contradiction_arbitration` |
| `contradicted` | Lost a contradiction arbitration. `replaced_by_fact_id` SHOULD be set. | `contradiction_arbitration` |
| `duplicate` | Same subject + similarity > 0.92 + lower confidence. `replaced_by_fact_id` MUST be set. | `fact_excretion` |
| `low_access` | `access_log.count_30d == 0` AND `age > 60d`. No replacement. | `fact_excretion` |
| `manual` | User-driven excretion. | `fact_excretion` |

`revival_at` is set when an archived fact is re-captured (idempotency hash match)
and unarchived.

### LLM call sites (inventory + fallback contract)

Every LLM invocation MUST be wrapped by P0-6's circuit breaker. Inventory at
lock time (5 sites; 4 TS + 1 Python):

| Site | Purpose | Failure mode | Fallback |
|------|---------|--------------|----------|
| `cognitive/wiki.ts:86` `llm.generate` | L3 wiki page synthesis | timeout / 5xx / ECONNREFUSED | mark wiki page `stale_at = now`, return cached version, surface `stale_wiki` triage signal |
| `query/ask.ts:35` `llm.generate` | Multi-query expansion for retrieval | timeout / 5xx | fall back to original query verbatim, log `expansion_skipped` |
| `query/ask.ts:152` `llm.generate` | Final answer synthesis | timeout / 5xx | return BM25 top-N facts as plain text with `[LLM unavailable]` banner |
| `compost-daemon/src/mcp-server.ts:201` `new OllamaLLMService()` | Service instantiation for `ask` MCP tool | constructor throws on missing config | return MCP error with hint (`compost doctor --check-llm`) |
| `compost-ingest/.../llm_facts.py` (Python) | LLM-based fact extraction during ingest | already has Python-side retry; **out of scope for P0-6 TS wrapper** | (existing Python retry; surface `stuck_outbox` if queue grows) |

**Self-Consumption guard** (Gemini insight, P0-6 sub-requirement): the
extractor MUST refuse to re-ingest content whose source path matches `wiki/**`
or whose upstream `source.kind == 'wiki-rebuild'`. Prevents the LLM-generated
wiki from feeding back into the fact extraction loop.

### Scheduler hook points + lock-window discipline

`compost-daemon/src/scheduler.ts` exposes named factories. New schedulers
that take a SQLite writer lock for > 1s MUST declare a time window:

| Scheduler | Period | Time window | Notes |
|-----------|--------|-------------|-------|
| `startDrainLoop` | 1s | continuous | brief writer lock per drain |
| `startIngestWorker` | 2s | continuous | drains own outbox first |
| `startReflectScheduler` | 6h | aligned 00:00/06:00/12:00/18:00 UTC | writer lock 1-5s |
| `startFreshnessLoop` | 60s | continuous | read-only |
| `startBackupScheduler` (P0-7) | 24h | **03:00 UTC** (between reflect runs) | VACUUM INTO -- avoids reflect lock by time-window separation |
