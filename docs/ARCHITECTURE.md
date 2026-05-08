# Compost Architecture

## Product identity

Compost is a **cross-system action ledger + metacognitive index** for a
single-user, local-first knowledge stack. It records what happened across
agents, shell, git, Obsidian, files, and web sources, then keeps enough
provenance to answer where the canonical knowledge lives. It is designed
for 10+ year continuous personalization and ships as a fork template:
there is no server, no account, and no shared instance.

Compost sits above knowledge-bearing tools. The sibling system,
[Engram](https://github.com/Bryanh9111/Engram), is the fast memory/action
layer; Obsidian remains the curated knowledge graph; git remains the code
history. Compost can synthesize with `compost ask` when the user asks, but
v4 freezes background wisdom production that would create a competing
source of truth.

Compost and Engram intentionally remain separate sibling repos while both
systems are still evolving. The current boundary baseline and static drift
check are documented in `docs/compost-engram-boundary.md`.

See `docs/CONCEPTS.md` for the L1-L6 self-evolution model and the
provenance chain, `docs/QUICKSTART.md` for a 5-minute hands-on.

## System overview

Compost is a provenance ledger plus metacognitive action timeline. Raw
observations flow through a single write pipeline (`observe -> drain ->
extract -> store`), while action-shaped events are also lifted into
`action_log` for cross-tool timeline queries.

## Data flow

### Write path (all adapters unified)

```
1. Source produces event (local file, web URL, Claude Code hook, Codex notify,
   zsh/git/Obsidian capture)
2. appendToOutbox(db, OutboxEvent) -> INSERT OR IGNORE observe_outbox
3. Daemon drain loop -> drainOne(db):
   a. Claim pending outbox row
   b. Auto-register source (INSERT OR IGNORE INTO source)
   c. Link source_context
   d. INSERT OR IGNORE INTO observations (L0 ledger)
   e. Enqueue into ingest_queue
   f. Ack outbox row
   g. Best-effort metacognitive lift into action_log
4. Worker claims from ingest_queue (lease protocol: 60s, heartbeat 30s)
5. Bun.spawn Python extractor (stdin JSON -> stdout JSON)
6. INSERT facts (L2) + chunks into SQLite
7. Generate embeddings via OllamaEmbeddingService
8. Write vectors to LanceDB
9. Update chunks.embedded_at
10. Mark derivation_run succeeded + complete queue item
```

Idempotency: adapters compute a stable `idempotency_key` from source identity
and event identity/content. Outbox UNIQUE + observations UNIQUE provide double
protection.

### Read path (hybrid retrieval)

```
1. query(db, q, opts, vectorStore)
2. Stage-0a: BM25 via FTS5 (SELECT fact_id WHERE MATCH q, ORDER BY rank, LIMIT 200)
3. Stage-0b: LanceDB ANN (search(q, 200), deduplicate chunks to fact_id)
4. RRF merge: 1/(k + rank_position) for each source, sum per fact_id
5. Populate temp table query_candidates with (fact_id, semantic_score, bm25_score, rrf_score, retrieval_score)
6. Stage-2: SQLite rerank with multi-factor formula:
   score = w1*retrieval_score + w2*temporal_decay + w3*access_frequency + w4*importance
7. Return QueryHit[] with ranking_components + provenance
8. Append access_log (telemetry)
9. Sample ranking_audit_log (if debug or env var)
```

`retrieval_score` preserves lexical BM25 relevance even when vectorStore is null, so BM25-only degraded mode still contributes to final ranking.

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
4. Contradiction arbitration: same subject+predicate, different object,
   restricted to explicit single-valued predicates
   -> confidence > recency tiebreak, loser gets superseded_by
5. Outbox prune: DELETE WHERE drained > 7d AND NOT quarantined
```

## Database schema (22 migrations)

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
| `action_log` | metacognitive | Processed action records lifted from raw observations |

### FK CASCADE chain (critical for reflect GC)

```
observations.observe_id CASCADE -> facts, chunks, ingest_queue, captured_item, derivation_run
observations.observe_id SET NULL -> observe_outbox, action_log
facts.fact_id CASCADE -> fact_context, access_log, ranking_audit_log
wiki_pages.path CASCADE -> wiki_page_observe
```

## Module map

### compost-core (pure library, no side effects)

```
src/
  schema/          22 SQL migrations + migrator.ts
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

| Table | Purpose | Write path | Status | Migration |
|-------|---------|-----------|--------|-----------|
| `ranking_audit_log` | **Read path only** -- per-query ranking attribution. One row per (query_id, fact_id). Disabled unless `debug_ranking=true`. | `query/search.ts` | ✅ live since Phase 2 | 0004 |
| `decision_audit` | **Cognitive write path only** -- four kinds: `contradiction_arbitration`, `wiki_rebuild`, `fact_excretion`, `profile_switch`. One row per high-cost decision. | `cognitive/reflect.ts`, `cognitive/wiki.ts`, future profile switcher | ✅ **P0-2 live (2026-04-15)** -- `contradiction_arbitration` + `wiki_rebuild` wired; `fact_excretion` + `profile_switch` reserved for Week 5+. Writes wrapped in try/catch so audit failures do NOT roll back business transactions (debate 009 Fix 3). | 0010 |

Never write the same event to both. If a decision involves ranking (e.g. profile
switch changes ranking weights), it goes to `decision_audit` -- the ranking
side-effects show up later in `ranking_audit_log` per query.

> **Audit honesty (debate 005, updated 2026-04-15)**: `decision_audit` is now
> live for `contradiction_arbitration` (reflect step 3, per-cluster with
> `loser_ids[]`) and `wiki_rebuild` (successful `synthesizePage`). Both call
> sites wrap `recordDecision` in try/catch so audit errors become
> `report.errors` entries (reflect) or `console.warn` log lines (wiki)
> rather than rolling back the underlying contradiction resolve or wiki
> write. `fact_excretion` and `profile_switch` remain reserved.

### `facts.archive_reason` enum (frozen for Phase 4)

Aligned with `decision_audit.kind` so each archival is auditable end-to-end.
Changes require a new migration -- this enum is **frozen**.

| Value | Semantic | Audit kind | Implementation status |
|-------|----------|------------|-----------------------|
| `stale` | Decay formula tombstoned (`reflect.ts` step 2). Bulk operation, no audit row per fact. | (none) | ✅ reflect.ts step 2 |
| `superseded` | Replaced by newer fact for same (subject, predicate). `replaced_by_fact_id` MUST be set. | `contradiction_arbitration` | ⏳ reserved (may fold into `contradicted`) |
| `contradicted` | Lost a contradiction arbitration. `replaced_by_fact_id` SHOULD be set. | `contradiction_arbitration` | ✅ reflect.ts step 3 (also writes `fact_links` `contradicts` edge) |
| `duplicate` | Same subject + similarity > 0.92 + lower confidence. `replaced_by_fact_id` MUST be set. | `fact_excretion` | ⏳ P1 compression 3-criteria |
| `low_access` | `access_log.count_30d == 0` AND `age > 60d`. No replacement. | `fact_excretion` | ⏳ P1 compression 3-criteria |
| `manual` | User-driven excretion. | `fact_excretion` | ⏳ future `compost forget` CLI |

`revival_at` is set when an archived fact is re-captured (idempotency hash match)
and unarchived.

### `decision_audit.confidence_floor` by kind (locked 2026-04-15)

Locked in debate 007 Pre-Week-3 Lock 3. Callers of `recordDecision` MUST pass
the tier listed here. `fact_excretion` is the only kind whose tier depends on
the sub-reason (heuristic vs user-driven).

| decision_audit.kind | confidence tier | floor | Rationale |
|---|---|---|---|
| `contradiction_arbitration` | instance | 0.85 | Explicit winner selected from a known single-valued same (subject, predicate) pair |
| `wiki_rebuild` | instance | 0.85 | Multi-fact synthesis; no single authoritative input |
| `fact_excretion` (reason = `duplicate` or `low_access`) | exploration | 0.75 | Heuristic (decay / similarity) |
| `fact_excretion` (reason = `manual`) | kernel | 0.90 | User-driven; highest trust |
| `profile_switch` | kernel | 0.90 | Operator config change |

> **reflect step 2 exception (debate 007 Lock 2)**: the `stale` archive path
> (decay-tombstone) is the `archive_reason` enum's `(none)` audit kind. It
> writes `facts.archive_reason = 'stale'` but NOT a `decision_audit` row.
> Tombstone count is already carried in `ReflectionReport.semanticFactsTombstoned`.
> Week 3 P0-2 implementers: do NOT add a recordDecision call to reflect step 2.

### `decision_audit.evidence_refs_json` shapes (locked 2026-04-15)

Locked in debate 007 Pre-Week-3 Lock 1. Each audit kind has a fixed payload
shape stored as `JSON.stringify`'d text in `evidence_refs_json`. See
`EvidenceRefs` union in `packages/compost-core/src/cognitive/audit.ts`.

| kind | payload shape |
|---|---|
| `contradiction_arbitration` | `{ winner_id, loser_ids[], subject, predicate }` |
| `wiki_rebuild` | `{ page_path, input_fact_ids[], input_fact_count }` |
| `fact_excretion` | `{ fact_ids[], reason: 'duplicate'\|'low_access'\|'manual', count }` |
| `profile_switch` (Week 5+) | `{ from_profile_id, to_profile_id, changed_fields[] }` |

> **Q5 revision (debate 008, 2026-04-15, 3/4 vote)**: `wiki_rebuild` stores
> `input_fact_ids[]` rather than `input_observe_ids[]`. Fact ids are the
> direct input to wiki synthesis; observation provenance is one FK JOIN
> away (`facts.observe_id`) and duplicating it here adds ~1.5× payload
> size without audit value.

### LLM call sites (inventory + fallback contract)

Every **TypeScript** LLM invocation MUST be wrapped by P0-6's circuit
breaker. The Python `compost-ingest` path is explicitly out-of-scope for the
TS breaker (row 5 below) -- it uses its own retry loop. Inventory at lock
time (5 sites; 4 TS + 1 Python):

| Site | Purpose | Failure mode | Fallback |
|------|---------|--------------|----------|
| `cognitive/wiki.ts synthesizePage` `llm.generate` (site key `wiki.synthesis`) | L3 wiki page synthesis | timeout / 5xx / ECONNREFUSED | mark wiki page `stale_at = now`, return cached version, surface `stale_wiki` triage signal |
| `query/ask.ts expandQuery` `llm.generate` (site key `ask.expand`) | Multi-query expansion for retrieval | timeout / 5xx | fall back to original query verbatim, log warning with err.name + message |
| `query/ask.ts ask` answer-synthesis `llm.generate` (site key `ask.answer`) | Final answer synthesis | timeout / 5xx | return BM25 top-N facts as plain text with `[LLM unavailable]` banner; if `hits.length === 0`, also tries slug-matching question against `wiki_pages.title` / `path` |
| `compost-daemon/src/main.ts` boot-time `new BreakerRegistry(new OllamaLLMService())` | **Single daemon-wide registry** (Week 4 Day 1 consolidation). Injected into both `startMcpServer(db, registry)` and `startReflectScheduler(db, { llm: registry, dataDir })`, so circuit state for `ask.*` and `wiki.synthesis` lives in one place. | first `generate()` call fails with network error; surfaces via circuit breaker (no ctor-time validation today) | return MCP error with hint; `compost doctor --check-llm` ships a manual probe that separates Ollama service liveness (`/api/tags`) from bounded model generation. A generation `AbortError` is reported as a warning by default and becomes fatal with `--strict-llm`. |
| `compost-ingest/.../llm_facts.py` (Python) | LLM-based fact extraction during ingest | already has Python-side retry; **out of scope for P0-6 TS wrapper** | (existing Python retry; surface `stuck_outbox` if queue grows) |

### CLI surface inventory (Week 4)

Enum-validated subcommands; all return exit 2 on invalid arg, exit 1 on
missing-target / runtime failure, exit 0 otherwise. JSON on stdout.

| Command | Purpose | Key options |
|---|---|---|
| `compost audit list` | Read `decision_audit` trail (P0-2) | `--kind` / `--since` / `--target` / `--decided-by` / `--limit` |
| `compost triage scan` | Run a triage pass: 5 scanners + aggregate, prints `TriageReport`; unresolved-contradiction scan only considers known single-valued predicates and ignores generic section-label subjects | (none) |
| `compost triage list` | Read `health_signals` | `--kind` / `--since` / `--include-resolved` / `--limit` |
| `compost triage resolve <id>` | Mark signal resolved (surface-only; does NOT fix the underlying cause) | `--by <user\|agent>`; exit 1 if id missing or already resolved |
| `compost doctor --check-llm` | Ollama `/api/tags` liveness probe plus bounded generation probe (default 3s, configurable with `--llm-timeout-ms`; model configurable with `--llm-model` / `COMPOST_LLM_MODEL`) | (none) |
| `compost doctor --reconcile` | Observations vs facts delta | (none) |
| `compost doctor --rebuild L1` | Atomic LanceDB rebuild from SQLite chunks | (none) |
| `compost backup` / `compost restore` | P0-7 backup/restore | see command `--help` |

**Self-Consumption guard** (Gemini insight, P0-6 sub-requirement): prevents
the LLM-generated wiki from feeding back into the fact extraction loop.

**Enforcement location (locked debate 007 Lock 5)**: `ledger/outbox.ts
drainOne` — the universal entry gate to L2. Checking only at
`pipeline/ingest.ts` / `web-ingest.ts` would miss future adapters and the
hook path. The guard quarantines the outbox row (not deletes) so an
operator can inspect.

**Rule**: quarantine any `observe_outbox` row whose `source_uri` matches
`file://<compost_data_dir>/wiki/*.md`. Regex scoped to Compost's own wiki
export directory — a user's personal `~/notes/wiki/` is NOT blocked.

> The earlier draft of this section referenced `source.kind == 'wiki-rebuild'`.
> That enum value does not exist in the `source.kind` CHECK constraint
> (local-file / local-dir / web / claude-code / host-adapter / sensory) and
> no caller would ever set it. Reference removed in debate 007 Lock 5 to
> avoid a phantom contract.

> **Status (2026-04-15)**: ✅ enforced in `ledger/outbox.ts`
> `isWikiSelfConsumption()` + `quarantineImmediately()` during `drainOne`.
> Regex matches Unix paths only — Windows `file:///C:/...` not covered
> (accepted risk; see ROADMAP known-risks table).

### Scheduler hook points + lock-window discipline

`compost-daemon/src/scheduler.ts` exposes named factories. New schedulers
that take a SQLite writer lock for > 1s MUST declare a time window:

| Scheduler | Period | Time window | Notes |
|-----------|--------|-------------|-------|
| `startDrainLoop` | 1s | continuous | brief writer lock per drain |
| `startIngestWorker` | 2s | continuous | drains own outbox first |
| `startReflectScheduler` | 6h | aligned 00:00/06:00/12:00/18:00 UTC | writer lock 1-5s. In v4, background wiki synthesis is frozen by default; legacy wiki hook behavior requires `WIKI_SYNTHESIS_ENABLED=true`. Wiki errors are logged + swallowed so one bad topic cannot stall the cadence. |
| `startFreshnessLoop` | 60s | continuous | read-only |
| `startBackupScheduler` (P0-7) | 24h | **03:00 UTC** (between reflect runs) | VACUUM INTO -- avoids reflect lock by time-window separation |
| `startGraphHealthScheduler` (P0-3) | 24h | **04:00 UTC** (after backup completes) | `takeSnapshot` runs Union-Find over active facts + fact_links; SQL writer lock ~100ms at 10K facts. Buffer hour after backup tolerates large-db VACUUM |
| `startReasoningScheduler` (Phase 7 L5, debate 026) | frozen in v4 | stopped health stub | Historical implementation is retained for manual access and schema compatibility, but the daemon no longer starts the background chain-generation loop by default. |

All schedulers implement `getHealth(): { name, last_tick_at, error_count, running }`. Daemon control socket aggregates the array under `status.schedulers` so an outwardly-alive daemon with a dead sub-loop is no longer invisible (dogfound 2026-04-27 — daemon ran 65h while no scheduler ticked because MCP read-path masked the failure). Process-layer supervision is documented with the macOS launchd template at `scripts/com.example.compost-daemon.plist` (KeepAlive=true, ThrottleInterval=60).
