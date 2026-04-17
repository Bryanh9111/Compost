# Compost v2 — Executable Specification

**Status**: canonical Phase 0 plan, replaces `phase0-spec.md` (preserved as `phase0-spec.md` with superseded banner for audit trail)
**Version**: v2.2 (2026-04-11, debate #5 R2 + debate #6 fix pass)
**Source of decisions**: 6 debates (`docs/debate/synthesis.md`, `docs/debate2/synthesis.md`, `docs/debate3/synthesis.md`, `docs/debate4/synthesis.md`, `docs/debate5/`, `docs/debate6/`)
**Target**: buildable in ~2 weeks solo
**Outcome**: a running `compost-daemon` that ingests local markdown + Claude Code hook events, writes to L0 (observations ledger) and Phase 0 subset of L1/L2 (semantic facts with decay + partial ranking), exposes `compost.query` and `compost.reflect` via stdio MCP, and ships with the cognitive schema shape needed to support the long-term brain-like vision.

---

## What changed from v1

v2 integrates 4 additional architectural decisions on top of v1 + debate #3:

| From debate | Decision | v2 impact |
|---|---|---|
| #4 A | Stateless query-time decay | `half_life_seconds` + `last_reinforced_at_unix_sec` + `access_log` table. No background decay jobs. |
| #4 B | Probabilistic multi-factor ranking (staged) | `ranking_profile` + `ranking_audit_log` tables. `QueryHit.ranking_components` API locked from Phase 0. Phase 1 activates w1 only. |
| #4 C | Vertical partitioning for cognitive tiers | `facts` stays as semantic base; future `memory_episodic` + `memory_procedural` are link tables (Phase 3+). |
| #4 D | Hook contract for Claude Code | `compost hook <event>` CLI subcommand with sync outbox append, replacing the long-running `compost-adapter-claude-code` process. MCP notification path preserved for other hosts. |

v2 also carries forward all `debate3/synthesis.md` fixes (derivation_run, policies table, context entity, queue lease, Step 13b rebuild test).

## What changed in v2.1 (debate #5 R1 fix pass)

Debate #5 ran a fresh-eyes review with 3 independent reviewers. 2/3 said SHIP WITH REQUIRED CHANGES, 1/3 said HOLD, all converging on the same concrete gaps. v2.1 addresses:

**Blockers (6)**: (1) FK cascade for `reflect()` sensory GC, (2) canonical `observe_outbox` DDL + drain transaction inlined, (3) LanceDB↔SQLite Stage-1/Stage-2 bridge via temp table, (4) `fact_context` join in query SQL (fixes `QueryHit.contexts`), (5) `transform_policy` FK decision documented, (6) `ObserveEvent.adapter` + hook `adapter_sequence` source.

**High (9)**: `compost.feedback` Phase alignment, `ranking_audit_log` write condition, cross-process LanceDB file lock, Python subprocess error handling, `~/.compost/` permissions (chmod 700), `compost-daemon` process supervision, hook cold-start measurement methodology, queue lease claim SQL + recovery, poison pill dead-letter threshold.

**Medium (4)**: reference-survey files in §0 layout, `compost crawl`/`compost relearn` deferred markers, ghost `derivations` table migration text, 5-tier cognitive ↔ L-layer mapping table.

All fixes are `compost-v2-spec.md`-local — no schema changes beyond what debate #3/#4 already committed, only missing DDL/SQL/text made explicit.

## What changed in v2.2 (debate #5 R2 + debate #6 fix pass)

Debate #5 R2 (second fresh-eyes review after v2.1) produced 3/4 HOLD-or-required-changes. Codex flagged an **architectural-level blocker**: the canonical outbox drain transaction in §1.6 couldn't work as a single SQLite transaction because `observe_outbox` lived in a separate file from `observations` and `ingest_queue`. Debate #6 resolved this 3B/1A in favor of **Option B — merge outbox into ledger.db** (Gemini + Codex + Opus; Sonnet dissented on WAL contention grounds, conceded to the measurement-gate fallback).

**Architectural changes**:
- `observe_outbox` is now a table inside `~/.compost/ledger.db` (was per-adapter `.db` files). New §1.6 has the canonical DDL, §1.6.1 has the single-DB hook write path, §1.6.2 has the drain transaction.
- `compost hook` writes directly to `ledger.db`, not to `adapters/<name>/outbox.db`. The per-adapter outbox isolation invariant from debate #1 is formally retired.
- Drain transaction gains explicit steps for `source` auto-registration, `source_context` link creation, and `drain_attempts`/`drain_quarantined_at` handling.

**Schema / SQL fixes (14 items from debate #5 R2 reviewers)**:
1. `wiki_page_observe.observe_id` missing `ON DELETE CASCADE` (Sonnet + Gemini + Opus)
2. `ranking_audit_log.fact_id` missing `ON DELETE CASCADE` (Gemini)
3. `observe_outbox.source_kind` column added (Gemini — drain step required it but column didn't exist)
4. Drain transaction never incremented `drain_attempts` or excluded quarantined rows (Codex)
5. Hook source auto-registration step added to drain (Gemini — `source(id)` FK was blocking hook drains)
6. `source_context` auto-link step added to drain (Gemini — `ObserveEvent.contexts` was being silently dropped)
7. §5.1 named/positional parameter mix in `.all(...)` (Sonnet + Gemini + Codex) — fixed with `query_context_filter` temp table
8. §3.1 legacy adapter pattern contradicted §1.6 new protocol (Codex + Opus) — §3.1 rewritten
9. §3.2 forward reference to `phase0-spec.md §3` (Codex) — removed
10. `compost.observe` notification vs `Promise<ObserveResult>` (Gemini) — §5 clarified, notification = void wire, API = Promise with optional result
11. Temp table semantics described as "transaction-scoped" (Codex) — corrected to connection-scoped, DROP TABLE at end
12. `transform_policy.extraction_timeout_sec` ghost field (Sonnet) — added to §2 policy definition
13. Two conflicting retry state machines (Codex) — unified: `drain_quarantined_at` for outbox, `extraction_quarantined_at` for queue, separate thresholds (5 and 3 respectively) documented
14. `§10.1 daemon status` missing `degraded_flags` field (Codex) — added

**New guardrail (Sonnet debate #6 concession)**: writer budget — any `ledger.db` write > 50ms logged via pino and raised in `compost daemon status --degraded`. Measurement tripwire for WAL contention.

**Open NOT fixed, documented as known Phase 0 risk**:
- Temp table semantics in §5.1 are now correctly described as connection-scoped; code uses explicit `DELETE FROM query_candidates` at start of each query. No spec bug, no runtime bug, just a correctness note.
- Sonnet's WAL contention concern is a measurement risk managed by §11 DoD p95 gate. No spec change; the fallback (native Go/Rust hook binary) is already in §3b.5.

---

## 0. Naming and project layout

Package name: `compost`. CLI binary: `compost`. Data directory: `~/.compost/`. MCP server id: `compost`.

```
Compost/
├── packages/
│   ├── compost-core/              # Node, pure library (no side effects on import)
│   │   ├── src/
│   │   │   ├── schema/            # SQL migrations (numbered)
│   │   │   │   ├── 0001_init.sql
│   │   │   │   ├── 0002_debate3_fixes.sql     # derivation_run, policies, context, wiki_page_observe, queue lease
│   │   │   │   ├── 0003_stateless_decay.sql    # half_life, last_reinforced_at, access_log
│   │   │   │   └── 0004_probabilistic_ranking.sql  # ranking_profile, ranking_audit_log
│   │   │   ├── ledger/             # observations + facts + access_log + noteworthy
│   │   │   ├── storage/            # LanceDB wrapper + fact graph
│   │   │   ├── queue/              # ingest queue with lease claim
│   │   │   ├── query/              # query synthesis with decay + ranking formula
│   │   │   ├── policies/           # transform_policy registry + DB upsert
│   │   │   ├── ranking/            # ranking_profile registry + audit log writer
│   │   │   ├── cognitive/          # reflect() loop, sensory-tier hard-GC
│   │   │   ├── api.ts              # public entry point
│   │   │   └── index.ts
│   │   ├── test/
│   │   │   └── fixtures/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── compost-daemon/            # Node, thin wrapper: Core + MCP server + L4 scheduler
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── mcp-server.ts
│   │   │   └── scheduler.ts       # Phase 0 runs reflect() sensory-GC on a timer
│   │   └── package.json
│   │
│   ├── compost-embedded/          # Node, re-export of compost-core
│   │   └── src/index.ts
│   │
│   ├── compost-adapter-sdk/       # Node, base class for adapters — direct ledger.db append (v2.2)
│   │   ├── src/{adapter.ts, mcp-client.ts}  # outbox.ts removed; observe_outbox is in ledger.db
│   │   └── package.json
│   │
│   ├── compost-hook-shim/         # Node, pre-bundled CJS shim for `compost hook` (fast cold start)
│   │   ├── src/index.cjs          # esbuild --bundle --platform=node --target=node20 --format=cjs
│   │   └── package.json
│   │
│   ├── compost-cli/               # Node, user-facing CLI with subcommands (daemon, add, query, doctor, hook, reflect)
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── commands/
│   │   │   │   ├── daemon.ts
│   │   │   │   ├── add.ts
│   │   │   │   ├── query.ts
│   │   │   │   ├── doctor.ts
│   │   │   │   ├── hook.ts        # dispatches to compost-hook-shim for fast cold start
│   │   │   │   └── reflect.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── compost-ingest/            # Python, extraction subprocess (separate runtime)
│       ├── compost_ingest/
│       │   ├── __init__.py
│       │   ├── cli.py
│       │   ├── extractors/
│       │   └── schema.py
│       ├── tests/
│       ├── pyproject.toml
│       └── uv.lock
│
├── scripts/
│   ├── install.sh                 # one-command setup (bun + uv)
│   └── compost-doctor.ts          # thin shim to `compost doctor --reconcile`
├── docs/
│   ├── compost-v2-spec.md         # THIS FILE (canonical)
│   ├── phase0-spec.md              # superseded (v1), kept for audit
│   ├── phase0-checklist.md         # superseded (updated in §12 to match v2.1)
│   ├── architecture.md             # trimmed from debate syntheses (author during Phase 0)
│   ├── coverage-slo.md             # Auditable Coverage spec
│   ├── cognitive-model.md          # 5-tier cognitive ↔ L-layer mapping reference
│   ├── reference-survey-memory-projects.md  # survey of 14 memory projects (input to debate #4)
│   ├── reference-survey-airi.md             # survey of airi codebase (input to debate #4)
│   ├── reference-survey-claude-code-source.md  # survey of Claude Code CLI (§3b.2 hook envelope source of truth)
│   └── debate/{,2,3,4,5}/                  # debate history (5 debates so far)
├── .gitignore
├── bun.lockb
└── package.json                   # workspace root
```

**Key Node dependencies** (Phase 0): `better-sqlite3`, `@modelcontextprotocol/sdk`, `proper-lockfile` (for cross-process LanceDB and reflect locks), `@commander-js/extra-typings`, `pino`, `zod` (for settings validation), `uuid` (for v7 IDs), `ajv` (for extractor output schema validation).

**Build tooling**: `bun` for workspace management and running scripts. `esbuild` for the compost-hook-shim bundle (fast cold start). TypeScript compiler for type checking but not bundling (Bun runs TS directly).

**Runtime boundary**: `packages/compost-ingest/` is Python-owned (uv-managed). Everything else is Node/Bun (bun-managed). This is the full hybrid split from debate #2.

**CLI binary**: `compost` is exposed via `packages/compost-cli/`. Subcommands (Phase 0 unless noted):
- `compost daemon <start|stop|status|reload>` — manage the long-running daemon process (supervision spec in §10)
- `compost add <file>` — ingest a local file (embedded mode, no MCP hop)
- `compost query "<text>"` — local query against the ledger (Phase 0 stub returns []; Phase 1 real results)
- `compost doctor --reconcile` — L0 vs LanceDB drift check + policy audit (verifies no orphaned `transform_policy` tags)
- `compost doctor --measure-hook` — measure cold-start latency of the hook shim (§11 DoD ship gate)
- `compost doctor --rebuild L1 --policy tp-YYYY-MM` — Step 13b rebuild verification (from debate #3)
- `compost doctor --drain-retry` — release quarantined poison-pill outbox rows for retry
- `compost hook <event-name>` — delegates to `compost-hook-shim` for fast cold start (Claude Code hook integration)
- `compost reflect` — manual trigger for reflection loop (sensory hard-GC, tombstone sweep, prune drained outbox)
- `compost drain [--adapter <name>]` — force drain of one or all adapter outboxes (diagnostic)
- `compost feedback <query-id> <fact-id>` — **Phase 1**: record `result_selected` for ranking calibration (not shipped in Phase 0)

---

## 1. L0 Schema (SQLite ledger)

File: `~/.compost/ledger.db` (single SQLite database in WAL mode).

### 1.1 Migration 0001_init.sql (from phase0-spec.md + debate #3 preserved)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- Source registry
CREATE TABLE source (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('local-file','local-dir','web','claude-code','host-adapter','sensory')),
  refresh_sec INTEGER,
  coverage_target REAL DEFAULT 0.0,
  trust_tier TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_tier IN ('user','first_party','web')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paused_at TEXT
);

-- Observations: immutable append-only ledger (the rebuild anchor)
CREATE TABLE observations (
  observe_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id),
  source_uri TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  raw_bytes BLOB,
  blob_ref TEXT,
  mime_type TEXT NOT NULL,
  adapter TEXT NOT NULL,
  adapter_sequence INTEGER NOT NULL,
  trust_tier TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  transform_policy TEXT NOT NULL,
  metadata JSON,
  UNIQUE(adapter, source_id, idempotency_key)
);

CREATE INDEX idx_obs_source ON observations(source_id, captured_at);
CREATE INDEX idx_obs_content_hash ON observations(content_hash);

-- Ingest queue (lease columns added in 0002)
-- NOTE: ON DELETE CASCADE on observe_id so that `compost reflect` sensory GC
-- can hard-delete observations without RESTRICT-blocking on pending queue rows.
-- Sensory observations that still have pending queue rows are GC-eligible:
-- the queue row is dropped as a side effect of the observation being aged out.
CREATE TABLE ingest_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  priority INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX idx_queue_pending ON ingest_queue(priority, enqueued_at)
  WHERE completed_at IS NULL;

-- Coverage SLO tracking
CREATE TABLE expected_item (
  source_id TEXT NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  expected_at TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id)
);

-- captured_item: ON DELETE CASCADE on observe_id so reflect() can GC sensory rows.
-- Losing captured_item rows for aged sensory observations is acceptable — SLO tracking
-- does not survive past the sensory TTL window anyway.
CREATE TABLE captured_item (
  source_id TEXT NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, external_id, captured_at)
);

-- L2 facts (semantic tier base; debate #3 removed contexts TEXT[] in favor of fact_context join)
-- NOTE: ON DELETE CASCADE on observe_id. Facts derived from sensory observations (which
-- expire after 7 days) are cascade-deleted. Facts derived from non-sensory observations
-- are never deleted by reflect() — only the sensory-kind source_id cohort is GC targeted.
CREATE TABLE facts (
  fact_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  importance REAL NOT NULL DEFAULT 0.5,
  importance_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by TEXT REFERENCES facts(fact_id),
  conflict_group INTEGER,
  archived_at TEXT  -- soft tombstone (Phase 0 sensory-GC / reflection sweep)
);

CREATE INDEX idx_facts_spo ON facts(subject, predicate);
CREATE INDEX idx_facts_observe ON facts(observe_id);
CREATE INDEX idx_facts_active ON facts(created_at) WHERE archived_at IS NULL;

-- L3 wiki page registry (actual markdown on disk; debate #3 replaced contributing_observes TEXT with wiki_page_observe)
CREATE TABLE wiki_pages (
  path TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  last_synthesis_at TEXT NOT NULL,
  last_synthesis_model TEXT NOT NULL
);
```

### 1.2 Migration 0002_debate3_fixes.sql (from debate #3)

```sql
-- Replace derivations with derivation_run (fixes PK bug for policy-only reruns)
CREATE TABLE derivation_run (
  derivation_id TEXT PRIMARY KEY,                 -- uuid v7
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  context_scope_id TEXT,
  extraction_profile TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','superseded')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  artifact_ref TEXT,
  supersedes_derivation_id TEXT REFERENCES derivation_run(derivation_id),
  error TEXT,
  content_hash TEXT GENERATED ALWAYS AS (
    observe_id || ':' || layer || ':' || transform_policy || ':' ||
    coalesce(model_id,'') || ':' || coalesce(context_scope_id,'') || ':' ||
    coalesce(extraction_profile,'')
  ) STORED
);

CREATE UNIQUE INDEX idx_derivation_run_active
  ON derivation_run(observe_id, layer, transform_policy, model_id,
                    coalesce(context_scope_id,''), coalesce(extraction_profile,''))
  WHERE status IN ('pending','running','succeeded');

CREATE UNIQUE INDEX idx_derivation_run_hash
  ON derivation_run(content_hash) WHERE status = 'succeeded';

-- transform_policy table (populated from TypeScript registry at daemon startup)
CREATE TABLE policies (
  policy_id TEXT PRIMARY KEY,
  supersedes TEXT REFERENCES policies(policy_id),
  effective_from TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  migration_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Context as first-class entity (flat, hierarchical-path-safe IDs)
CREATE TABLE context (
  id TEXT PRIMARY KEY,               -- e.g. 'work', 'work/project-zylo'
  display_name TEXT NOT NULL,
  isolation_level TEXT NOT NULL DEFAULT 'shared'
    CHECK(isolation_level IN ('shared','isolated')),
  trust_floor TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_floor IN ('user','first_party','web')),
  freshness_ttl_sec INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- Replace facts.contexts TEXT[] with join table
CREATE TABLE fact_context (
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  freshness TEXT NOT NULL DEFAULT 'fresh'
    CHECK(freshness IN ('fresh','stale','expired')),
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fact_id, context_id)
);
CREATE INDEX idx_fc_context ON fact_context(context_id);

-- source context join (replaces source.contexts TEXT[])
CREATE TABLE source_context (
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, context_id)
);

-- Replace wiki_pages.contributing_observes TEXT with join
-- NOTE (v2.1): ON DELETE CASCADE on BOTH FKs. Sensory GC needs observe_id cascade;
-- wiki page deletion needs page_path cascade.
CREATE TABLE wiki_page_observe (
  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_path, observe_id)
);
CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);

-- ingest_queue lease columns
ALTER TABLE ingest_queue ADD COLUMN lease_owner TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_token TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_expires_at TEXT;

CREATE INDEX idx_queue_claim
  ON ingest_queue(priority, enqueued_at, lease_expires_at)
  WHERE completed_at IS NULL;

CREATE UNIQUE INDEX idx_queue_active_lease
  ON ingest_queue(lease_token)
  WHERE completed_at IS NULL AND lease_token IS NOT NULL;
```

### 1.3 Migration 0003_stateless_decay.sql (from debate #4 A)

```sql
-- Decay anchor on facts (separate from created_at which is rebuild identity)
ALTER TABLE facts ADD COLUMN last_reinforced_at_unix_sec INTEGER NOT NULL DEFAULT (unixepoch());
ALTER TABLE facts ADD COLUMN half_life_seconds INTEGER NOT NULL DEFAULT 2592000;  -- 30 days

-- Append-only access log (batched, no inline writes)
CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  accessed_at_unix_sec INTEGER NOT NULL DEFAULT (unixepoch()),
  query_id TEXT,
  ranking_profile_id TEXT
);
CREATE INDEX idx_access_log_fact ON access_log(fact_id);
CREATE INDEX idx_access_log_time ON access_log(accessed_at_unix_sec);
```

### 1.4 Migration 0004_probabilistic_ranking.sql (from debate #4 B)

```sql
CREATE TABLE ranking_profile (
  profile_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  w1_semantic REAL NOT NULL DEFAULT 1.2,
  w2_temporal REAL NOT NULL DEFAULT 0.0,
  w3_access REAL NOT NULL DEFAULT 0.0,
  w4_importance REAL NOT NULL DEFAULT 0.0,
  w5_emotional REAL NOT NULL DEFAULT 0.0,
  w6_repetition_penalty REAL NOT NULL DEFAULT 0.0,
  w7_context_mismatch REAL NOT NULL DEFAULT 0.0,
  access_saturation INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by TEXT REFERENCES ranking_profile(profile_id)
);

-- Seed with Phase 1 default (only w1 active):
INSERT INTO ranking_profile (profile_id, name, w1_semantic)
VALUES ('rp-phase1-default', 'Phase 1 semantic only', 1.2);

CREATE TABLE ranking_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES ranking_profile(profile_id),
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,  -- v2.2: cascade so sensory GC can proceed
  queried_at_unix_sec INTEGER NOT NULL,
  rank_position INTEGER NOT NULL,
  w1_semantic REAL,
  w2_temporal REAL,
  w3_access REAL,
  w4_importance REAL,
  w5_emotional REAL,
  w6_repetition_penalty REAL,
  w7_context_mismatch REAL,
  final_score REAL NOT NULL,
  result_selected BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_audit_query ON ranking_audit_log(query_id);
CREATE INDEX idx_audit_fact ON ranking_audit_log(fact_id);
```

### 1.5 Non-negotiable schema requirements

From debate #1:
1. `observations.raw_bytes` / `blob_ref` enables rebuild from raw content
2. `observations.transform_policy` tags each row with the policy active at capture
3. `derivation_run` (`derivations` never shipped in v1; v2 creates `derivation_run` directly) solves embedding trap + wiki rot + rebuild drift + policy-only reruns
4. Ingest queue decouples write pipeline; `compost.observe` writes to `observations` + enqueue only

From debate #3:
5. `context` as first-class entity, no more `TEXT[]` JSON columns
6. `wiki_page_observe` normalized join replacing JSON array
7. `ingest_queue` lease columns (`lease_owner`, `lease_token`, `lease_expires_at`) for multi-writer safety
8. `policies` SQL table populated from TypeScript registry at daemon startup

From debate #4:
9. `facts.last_reinforced_at_unix_sec` and `facts.half_life_seconds` — decay anchor separate from rebuild identity
10. `access_log` append-only, no inline writes on `facts` during retrieval
11. `ranking_profile` versioning weights; `ranking_audit_log` with `result_selected` telemetry
12. Hard-GC policy for sensory tier via `compost reflect`; semantic tier soft-tombstone via `facts.archived_at`

From debate #5 v2.1 fix pass:
13. `ON DELETE CASCADE` on `facts.observe_id`, `ingest_queue.observe_id`, `captured_item.observe_id` so sensory-GC can hard-delete observations without FK RESTRICT blocking
14. `observe_outbox` DDL canonical in §1.6 (not forward-referenced to superseded v1)
15. LanceDB Stage-1 → SQLite Stage-2 bridge via temp table (§5.1)
16. `transform_policy` is intentionally NOT a SQL FK — see §2 for rationale

### 1.6 `observe_outbox` schema (merged into ledger.db — v2.2)

**Architecture decision (debate #6, 3B/1A)**: `observe_outbox` lives as a table inside `~/.compost/ledger.db`, NOT as per-adapter `adapters/<name>/outbox.db` files. The `adapter` column partitions the table by adapter. This keeps the outbox → observations → ingest_queue drain inside a single SQLite transaction, eliminates the `SQLITE_MAX_ATTACHED = 10` landmine, and collapses the entire reflect/drain race surface to one lock domain.

**Debate #6 was triggered** by Codex's v2.1 finding: the prior per-adapter-outbox-file design could not compose a single atomic drain transaction across two SQLite files without explicit `ATTACH DATABASE` semantics, which were never specified.

**Migration 0005_merged_outbox.sql** (applied alongside 0001–0004 in the same migration run):

```sql
CREATE TABLE observe_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- monotonic, global; feeds observations.adapter_sequence per-adapter via window
  adapter TEXT NOT NULL,                  -- e.g. 'compost-adapter-claude-code'
  source_id TEXT NOT NULL,                -- e.g. 'claude-code:018f:<repo>'
  source_kind TEXT NOT NULL               -- denormalized from source.kind so drain can skip a JOIN
    CHECK(source_kind IN ('local-file','local-dir','web','claude-code','host-adapter','sensory')),
  source_uri TEXT NOT NULL,               -- e.g. 'file:///Users/.../notes.md' — registers source row if missing
  idempotency_key TEXT NOT NULL,          -- sha256(adapter||source_id||stable(envelope))
  trust_tier TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_tier IN ('user','first_party','web')),
  transform_policy TEXT NOT NULL,         -- must exist in policies table at drain time
  payload TEXT NOT NULL,                  -- JSON ObserveEvent envelope (content, mime, metadata, contexts, ...)
  appended_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Drain state (set by daemon only, never by writers):
  drained_at TEXT,
  drain_error TEXT,                       -- last drain attempt error (retained for diagnosis)
  drain_attempts INTEGER NOT NULL DEFAULT 0,
  drain_quarantined_at TEXT,              -- set when drain_attempts > 5; blocks future claims until --drain-retry
  observe_id TEXT REFERENCES observations(observe_id) ON DELETE SET NULL
);

-- Pending rows for drain loop (partial index excludes quarantined)
CREATE INDEX idx_outbox_pending
  ON observe_outbox(adapter, seq)
  WHERE drained_at IS NULL AND drain_quarantined_at IS NULL;

-- Idempotency: same (adapter, source_id, idempotency_key) → single row
CREATE UNIQUE INDEX idx_outbox_idempotency
  ON observe_outbox(adapter, source_id, idempotency_key);

-- Drained rows older than retention window are pruned by compost reflect
CREATE INDEX idx_outbox_drained_time
  ON observe_outbox(drained_at)
  WHERE drained_at IS NOT NULL;
```

**Why merged not per-adapter**:
- **Single transaction boundary** — drain operates entirely inside `ledger.db`, no `ATTACH` semantics required, no cross-file crash windows
- **No ATTACH limit** — adapter count unbounded (SQLite row limit, not file-attach limit)
- **Single lock domain** — reflect GC + drain loop + hook shim append all share one WAL lock, eliminating the race surface Codex flagged
- **Single-file portability** — backup `ledger.db` captures an atomic snapshot including in-flight pending events

**Trade-off**: SQLite write lock is now shared across the hook shim (Claude Code PreToolUse/PostToolUse etc.) and the daemon drain loop. Sonnet's concern in debate #6 that WAL contention could push hook latency over the 5s Claude Code timeout is a **measurement risk managed by §11 DoD**: if `compost doctor --measure-hook` reports p95 > 30ms on reference hardware, Phase 1 commits to a native Go/Rust hook binary. Do NOT regress to ATTACH architecture.

**Writer budget guardrail (§10.3 expanded)**: any write on `ledger.db` that exceeds 50ms is logged via pino and surfaces in `compost daemon status --degraded`. This is an observability tripwire for Sonnet's concern, not an enforcement gate.

### 1.6.1 Hook shim write path (canonical)

```
compost hook <event-name> < stdin.json

1. Parse envelope, compute idempotency_key = sha256(adapter || source_id || stable(envelope))
2. Open ~/.compost/ledger.db (WAL mode, busy_timeout 500ms)
3. BEGIN IMMEDIATE
4. INSERT OR IGNORE INTO observe_outbox (
     adapter, source_id, source_kind, source_uri, idempotency_key,
     trust_tier, transform_policy, payload
   ) VALUES (...)
5. COMMIT
6. Exit 0

Total budget: ≤ 20ms cold, ≤ 5ms warm (WAL append).
```

**No separate outbox.db** — `compost hook` directly targets the one and only `ledger.db`. The shim loads `better-sqlite3` (~8ms cold) + opens ledger.db (~2ms) + single INSERT OR IGNORE (~5ms) + COMMIT.

### 1.6.2 Drain transaction (canonical, single-DB)

The daemon runs this transaction in a tight loop. Each iteration claims at most one row. Parallelization is intentionally deferred — single-threaded drain is simpler and the throughput ceiling (~5K rows/sec on modern Mac) is orders of magnitude above realistic hook event rates.

```sql
BEGIN IMMEDIATE;

-- STEP 1: Claim next drainable row (skips quarantined rows automatically via partial index).
--   Parameters are bound by the application layer AFTER reading this SELECT result.
--   If no row returned: COMMIT (releases lock) and sleep until next file-watch event or 1s poll.
SELECT
  seq, adapter, source_id, source_kind, source_uri, idempotency_key,
  trust_tier, transform_policy, payload, appended_at
FROM observe_outbox
WHERE drained_at IS NULL AND drain_quarantined_at IS NULL
ORDER BY seq
LIMIT 1;

-- STEP 2: Auto-register source if missing (Gemini debate #5 R2 fix).
-- Hook-generated source_ids like 'claude-code:018f:<user-home>/...' are dynamic; they
-- do not exist in `source` until first use. INSERT OR IGNORE handles both cases.
INSERT OR IGNORE INTO source (id, uri, kind, trust_tier, refresh_sec)
VALUES (:source_id, :source_uri, :source_kind, :trust_tier, NULL);

-- STEP 3: Auto-link source_context (Gemini debate #5 R2 fix).
-- payload JSON may contain a `contexts` array (e.g., ["work", "project-zylo"]).
-- Application layer parses payload, then runs one INSERT OR IGNORE per context_id.
-- (Shown here as a single representative line; actual code loops.)
INSERT OR IGNORE INTO source_context (source_id, context_id)
VALUES (:source_id, :context_id);

-- STEP 4: INSERT the observation. Generate a fresh UUID v7 for observe_id.
-- INSERT OR IGNORE handles the crash-between-steps-4-and-6 retry case: if a prior drain
-- attempt already inserted this (adapter, source_id, idempotency_key), the UNIQUE
-- constraint on observations silently IGNOREs this row. Step 5 fetches the real observe_id.
INSERT OR IGNORE INTO observations (
  observe_id, source_id, source_uri, occurred_at, captured_at,
  content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
  adapter, adapter_sequence, trust_tier, idempotency_key, transform_policy, metadata
) VALUES (
  :observe_id, :source_id, :source_uri, :occurred_at, :captured_at,
  :content_hash, :raw_hash, :raw_bytes, :blob_ref, :mime_type,
  :adapter, :seq, :trust_tier, :idempotency_key, :transform_policy, :metadata
);

-- STEP 5: Resolve the canonical observe_id (may be this INSERT's or a prior drain's).
SELECT observe_id FROM observations
WHERE adapter = :adapter AND source_id = :source_id AND idempotency_key = :idempotency_key;

-- STEP 6: Enqueue for derivation pipeline, guarded by duplicate check.
-- The guard allows multiple legitimate re-extractions under different transform_policy
-- (e.g., rebuild flows) while preventing accidental double-processing.
INSERT INTO ingest_queue (observe_id, source_kind, priority)
SELECT :observe_id, :source_kind, :priority
WHERE NOT EXISTS (
  SELECT 1 FROM ingest_queue
  WHERE observe_id = :observe_id AND completed_at IS NULL
);

-- STEP 7: Mark outbox row drained.
UPDATE observe_outbox
SET drained_at = datetime('now'), observe_id = :observe_id, drain_error = NULL
WHERE seq = :seq;

COMMIT;
```

**Failure handling (Codex debate #5 R2 gap — now fixed)**:

```sql
-- If any step in the transaction throws, ROLLBACK, then run this outside the transaction:
UPDATE observe_outbox
SET drain_attempts = drain_attempts + 1,
    drain_error = :error_message,
    drain_quarantined_at = CASE
      WHEN drain_attempts + 1 > 5 THEN datetime('now')
      ELSE drain_quarantined_at
    END
WHERE seq = :seq;
```

**Quarantine release**: `compost doctor --drain-retry [--seq N]` clears `drain_quarantined_at` and `drain_error` for one or all quarantined rows. Reset `drain_attempts = 0` so the quarantine threshold applies from scratch.

**Crash semantics** (what survives each crash point):

| Crash point | Outbox state | Next drain behavior |
|---|---|---|
| Before BEGIN | No change | Row stays pending, retried |
| Between BEGIN and STEP 7 | Rollback (atomic) | Row stays `drained_at IS NULL`, retried |
| Between COMMIT and application-layer log | Fully durable | No-op (idempotent: SELECT finds `drained_at IS NOT NULL`) |
| During failure-handler UPDATE | `drain_attempts` may not increment | Worst case: retries beyond 5 before quarantine triggers. Not correctness issue. |

**Drain polling**:
- Daemon runs ONE drain loop (not per-adapter) — the `adapter` column in `observe_outbox` ORDER BY preserves per-adapter fairness
- Triggered by file-watch on `ledger.db-wal` (detects writes without re-reading the DB) with fallback 1s poll
- Quarantined rows do NOT trigger the watch — the partial index excludes them

**Retention of drained rows**:
- Drained rows (`drained_at IS NOT NULL`) are pruned by `compost reflect` after 7 days for audit
- Quarantined rows (`drain_quarantined_at IS NOT NULL`) are NEVER auto-pruned — operator must resolve via `compost doctor --drain-retry` or `compost doctor --drain-purge <seq>`

---

## 2. `transform_policy` versioning (from debate #2 + #3)

Format: `tp-YYYY-MM[-NN]` where `NN` is an in-month revision counter.

Examples: `tp-2026-04`, `tp-2026-04-02`, `tp-2026-05`.

Each policy is a versioned record in `packages/compost-core/src/policies/registry.ts`, authored in TypeScript, and upserted into the SQL `policies` table at daemon startup:

```typescript
export const policies = {
  'tp-2026-04': {
    id: 'tp-2026-04',
    supersedes: null,
    effective_from: '2026-04-01',
    chunk: { size: 800, overlap: 100 },
    embedding: { model: 'nomic-embed-text-v1.5', dim: 768 },
    factExtraction: { prompt: 'fact-extract-v1', model: 'claude-opus-4-6' },
    wikiSynthesis: { prompt: 'wiki-synth-v1', model: 'claude-opus-4-6' },
    dedup: { minhashJaccard: 0.98, embeddingCosine: 0.985 },
    normalize: { stripBoilerplate: true, collapseWhitespace: true },
    factDecay: { halfLifeSeconds: 2592000 },  // 30 days (debate #4 A)
    extraction: {                             // v2.2: Python subprocess behavior knobs
      timeoutSec: 120,                        // SIGTERM after N sec (referenced by §4.5)
      maxRetries: 3,                          // extraction attempts before quarantine (unified with §10.2)
      extractorMinVersion: 'compost-ingest@0.1.0',
    },
    migration_notes: 'Initial Phase 0 policy.',
  },
} as const;
```

**Rules**:
- Existing policies are immutable once active
- A new policy requires a new `tp-*` key + `supersedes: <prior>` + updated `migration_notes`
- At startup, `compost-daemon` upserts every registry entry into the SQL `policies` table **before** opening the MCP server or starting any drain loop. No observation is ever written with a policy id that is not in the `policies` table.
- Ingested observations reference a specific policy and always use that policy on replay
- Each `derivation_run` row carries `transform_policy` as a logical reference to `policies(policy_id)`

**`transform_policy` FK decision (v2.1 fix pass)**: `observations.transform_policy` and `derivation_run.transform_policy` are intentionally declared as `TEXT NOT NULL` **without** a SQL `FOREIGN KEY` constraint on `policies(policy_id)`. Rationale:

1. **Startup order**: the TypeScript registry is the authoring source of truth; the SQL `policies` table is its shadow. The daemon upserts the registry at startup before any writer (hook shim, adapter, CLI) can execute. Hook-shim cold-start path does NOT upsert policies — it assumes the daemon has already done so. A hard SQL FK would couple the hook shim startup to the daemon's lifecycle order and break sync-append-before-daemon-boot scenarios.
2. **Runtime validation**: `compost-core` enforces referential integrity at the application layer. Every writer calls `validatePolicyExists(tp_id)` before insert. This throws with a clear error ("transform_policy `tp-2026-99` is not registered — add it to `packages/compost-core/src/policies/registry.ts` and restart the daemon") instead of SQLite's opaque `FOREIGN KEY constraint failed`.
3. **Doctor audit**: `compost doctor --reconcile` includes a policy audit pass that SELECTs distinct `transform_policy` values from `observations` and `derivation_run` and reports any that are missing from `policies`. This catches drift in scenarios where someone edits the ledger externally.

**Why date-stamp over semver**: the `derivation_run` table encodes rebuild scope directly via `(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)`. Code never needs to parse policy IDs to decide rebuild scope — SQL answers that. Semver would mislead operators into assuming backward compatibility. Date-stamp is honest: "this is a different configuration snapshot, active in a time window."

---

## 3. Write path A — Direct outbox append (all adapters, v2.2)

**v2.2 simplification**: the distinction between "write path A (MCP + long-running adapter)" and "write path B (Claude Code hook)" collapses because `observe_outbox` is now a single table in `ledger.db`. **All adapters — long-running processes AND transient hooks — append directly to `ledger.db.observe_outbox` using the same shim.** The MCP `compost.observe` notification path (debate #1) is retained as a fallback for adapters that cannot open SQLite directly (e.g., remote network clients), but it is not the primary write path anymore.

The canonical schema + drain transaction is §1.6. This section covers the adapter-side code interface.

### 3.1 Adapter SDK interface

File: `packages/compost-adapter-sdk/src/adapter.ts`

```typescript
export interface ObserveEvent {
  adapter: string;           // e.g. 'compost-adapter-airi@0.1.0' — populates observations.adapter
  source_id: string;         // e.g. 'airi:discord:channel:general' — registered in source table on first write
  source_uri: string;        // e.g. 'discord://server/channel/message/id'
  source_kind:               // must match source.kind CHECK constraint
    | 'local-file' | 'local-dir' | 'web' | 'claude-code' | 'host-adapter' | 'sensory';
  occurred_at: string;       // RFC3339
  content: string | Uint8Array;
  mime_type: string;
  trust_tier: 'user' | 'first_party' | 'web';
  idempotency_key: string;   // sha256(adapter||source_id||stableSerialize(content+metadata))
  transform_policy: string;  // e.g. 'tp-2026-04' — must exist in policies table
  metadata?: Record<string, unknown>;
  contexts?: string[];       // optional context_id list for source_context link (applied at drain)
}

// Note: `adapter_sequence` is NOT in ObserveEvent. It is assigned at drain time
// from `observe_outbox.seq`. Writers never set it.

export interface AdapterConfig {
  adapterName: string;
  adapterVersion: string;
  ledgerDbPath: string;      // e.g. path.join(os.homedir(), '.compost/ledger.db')
}

export abstract class HostAdapter {
  protected db: Database.Database;   // better-sqlite3 handle on ledger.db

  constructor(protected config: AdapterConfig) {
    this.db = new Database(config.ledgerDbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 500');  // 500ms busy retry before throwing
  }

  /**
   * Append a single observation to observe_outbox. Idempotent: same idempotency_key
   * produces exactly one row thanks to idx_outbox_idempotency UNIQUE.
   * Synchronous durability: returns only after WAL commit.
   */
  protected observe(event: ObserveEvent): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO observe_outbox (
        adapter, source_id, source_kind, source_uri, idempotency_key,
        trust_tier, transform_policy, payload
      ) VALUES (
        @adapter, @source_id, @source_kind, @source_uri, @idempotency_key,
        @trust_tier, @transform_policy, @payload
      )
    `);
    stmt.run({
      adapter: event.adapter,
      source_id: event.source_id,
      source_kind: event.source_kind,
      source_uri: event.source_uri,
      idempotency_key: event.idempotency_key,
      trust_tier: event.trust_tier,
      transform_policy: event.transform_policy,
      payload: JSON.stringify(event),
    });
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}
```

**Why direct append, not MCP notification**:
- Single transaction boundary — no "adapter-local outbox + MCP send + daemon receive" protocol, just INSERT INTO
- No long-running daemon connection required — adapter can be an ephemeral process (Claude Code hook) or a long-lived one (airi bot); same code path
- Adapter durability is SQLite's WAL commit, not "outbox append + replay on reconnect"
- The `OR IGNORE` clause on `idx_outbox_idempotency` handles all retry cases

### 3.2 MCP notification fallback (remote adapters only)

For adapters that cannot open `ledger.db` directly (e.g., a web-based observer running on a different machine), the `compost.observe` MCP notification is retained. The daemon receives the notification and performs the same `INSERT OR IGNORE` into `observe_outbox` on the adapter's behalf. Semantically identical to direct append.

**Phase 0 DoD requires this to work** for at least the test adapter (§11). Production hosts (Claude Code, airi, openclaw) use direct append because they run on the same machine as the daemon.

### 3.3 Idempotency

`idempotency_key` in `ObserveEvent` MUST be deterministic. Adapter computes:

```typescript
idempotency_key = sha256(adapter_name || source_id || stableSerialize(content + metadata))
```

Both the outbox `idx_outbox_idempotency` UNIQUE and the `observations.UNIQUE(adapter, source_id, idempotency_key)` constraints protect against duplicates. The outbox index catches them at append time; the observations constraint catches them during drain (in case the outbox row was drained but the outbox ack crashed — see §1.6.2 crash matrix).

---

## 3b. Write path B — Hook contract (Claude Code, v2.2)

For Claude Code integration: `compost hook <event>` is a CLI subcommand that appends directly to the shared `~/.compost/ledger.db.observe_outbox` table. This is the same target as §3 direct append; the only difference is that the subcommand is invoked per-event by Claude Code's hook dispatcher rather than running as a long-lived process.

### 3b.1 Why hooks for Claude Code specifically

Claude Code has a native hook dispatch system (`utils/hooks.ts` in claude-code source). Each hook event (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, etc.) spawns a subprocess with JSON on stdin and expects JSON on stdout with exit code semantics. Running a long-lived compost-adapter-claude-code process would duplicate infrastructure Claude Code already provides. The hook contract is strictly cleaner.

**All other hosts** (airi, openclaw, generic MCP clients) use the direct append pattern from §3.1 — either via the SDK subclass or via the `compost.observe` MCP notification fallback (§3.2). There is no separate "write path B protocol" — debate #6 merged all adapters into the same outbox.

### 3b.2 Hook contract semantics

```
compost hook <event-name> < stdin.json
```

1. **Parse stdin JSON envelope** — Claude Code hook payload envelope (see §3b.2a)
2. **Derive `source_id`** — `claude-code:{hook_envelope.session_id}:{hook_envelope.cwd}`. Session+cwd is the smallest stable grouping; `session_id` alone loses project context, `cwd` alone merges sessions.
3. **Derive `source_kind`** — always `'claude-code'` (matches §1.1 CHECK constraint)
4. **Derive `source_uri`** — `claude-code://{session_id}/{urlencode(cwd)}` (informational, not a real URI)
5. **Compute `idempotency_key`** — `sha256("compost-adapter-claude-code" || source_id || stableSerialize(envelope))`. Deterministic across Claude Code retries.
6. **Open `~/.compost/ledger.db`** (WAL mode, busy_timeout 500ms)
7. **`INSERT OR IGNORE` into `observe_outbox`** — single row with all columns populated directly from the envelope. The `seq` column (AUTOINCREMENT) provides ordering; the daemon assigns `observations.adapter_sequence` from it at drain time.
8. **Wait for WAL commit** — SQLite's transaction commit is the durability barrier. Parent process blocks until commit returns.
9. **Print JSON response** to stdout: `{"continue": true}` (no-op to Claude Code)
10. **Exit 0** only after step 8 durability confirmed

**Any failure in steps 1-8 exits non-zero with stderr error message**. Claude Code's retry semantics handle the retry loop; deterministic `idempotency_key` + `INSERT OR IGNORE` ensures duplicate retries produce exactly one outbox row.

**Why no separate `compost-adapter-claude-code` package**: the hook shim IS the adapter. It has the fixed `adapter = 'compost-adapter-claude-code'` constant, writes directly to the shared outbox, and doesn't need an SDK base class. Total code: ~80 lines of TypeScript in `packages/compost-hook-shim/src/index.ts`.

### 3b.2a Hook envelope minimum JSON contract

The hook shim must accept a JSON object on stdin with at least these fields. Fields beyond this minimum are preserved in `metadata` but are not parsed by Compost:

```json
{
  "hook_event_name": "PreToolUse",          // SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Stop
  "session_id": "018f3c-...",               // Claude Code session uuid, stable for session lifetime
  "cwd": "<repo>",  // working directory at time of event
  "timestamp": "2026-04-11T06:33:00Z",      // RFC3339
  "payload": { /* event-specific fields, passed through as metadata.payload */ }
}
```

Source of truth for the full envelope format: `docs/reference-survey-claude-code-source.md` §Hook System Deep Dive. If Claude Code changes its hook contract in a future release, this spec section must be updated before upgrading the hook shim.

**Exit code semantics** (match Claude Code's hook dispatch protocol):
- 0: success, hook completed, event durably persisted
- 2: blocking error, action halted
- other: non-blocking warning

### 3b.3 Cold-start mitigation

`compost hook` cannot afford Node's full startup cost (~100-200ms). Phase 0 uses a pre-bundled CJS shim:

File: `packages/compost-hook-shim/src/index.cjs`

Built via:
```bash
esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs \
  --external:better-sqlite3 --outfile=dist/index.cjs
```

The shim loads **only** `better-sqlite3` at runtime. No TypeScript runtime bootstrap, no workspace dep resolution, no other compost-core imports. Target cold start: **≤ 20ms** (8ms library load + 5ms SQLite append + 7ms overhead).

Phase 0 DoD requires: `compost doctor --measure-hook` reports p50 and p95 cold-start. If p95 > 30ms on reference hardware (Apple M1/M2/M4 Mac or equivalent), Phase 1 commits to rewriting `compost hook` as a native Go binary. This is the measurement gate, not guesswork.

### 3b.5 Hook cold-start measurement methodology (v2.1)

`compost doctor --measure-hook` must implement this exact protocol so numbers are comparable across machines and CI runs:

```
1. Ensure the hook shim binary exists at packages/compost-hook-shim/dist/index.cjs.
   If not, fail with "build compost-hook-shim first".

2. Warm the filesystem cache:
   - `cat packages/compost-hook-shim/dist/index.cjs > /dev/null` (3 times)
   - `cat $(node -e "console.log(require.resolve('better-sqlite3'))") > /dev/null`

3. Discard warmup samples:
   - Run `compost hook measurement-warmup` with a synthetic envelope 5 times
   - Discard all timings (Node VM cache, SQLite page cache warm)

4. Measurement samples (n = 100):
   - For each sample:
     a. Construct synthetic envelope: {"hook_event_name":"SessionStart", "session_id":"<uuid>", "cwd":"/tmp", "timestamp":"<now>", "payload":{}}
     b. Record monotonic clock t0
     c. Spawn `compost hook session-start` as a child process, pipe envelope to stdin
     d. Wait for exit
     e. Record monotonic clock t1
     f. Sample = (t1 - t0) in milliseconds
   - 50ms sleep between samples (let SQLite flush WAL)

5. Compute statistics:
   - Discard top 2% and bottom 2% (trim outliers from fs/Node jitter)
   - Report p50, p90, p95, p99, max

6. Persist results to ~/.compost/logs/hook-measurement-YYYY-MM-DD.jsonl

7. Exit codes:
   - 0: p95 <= 30ms (ship gate passed)
   - 1: p95 > 30ms (ship gate failed — operator should either fix the shim or commit to native binary path)
   - 2: measurement error (binary missing, permission, etc.)
```

**Reference hardware for ship gate**: Apple M1/M2/M3/M4 Mac with macOS 14+. Linux x86_64 is a secondary target but the gate is enforced only on macOS for Phase 0 (which is the primary dev platform). Phase 1 expands to Linux gate.

**Why 100 samples**: enough to get a stable p95 without making the measurement itself slow. A 100-sample run takes about 10 seconds total (100 × ~50ms hook + 100 × 50ms sleep).

**Why trim 4% of samples**: Node cold-start on laptops has tail latency from macOS power management, Spotlight indexing, fs events backlog. Trimming catches the "worst case realistic" without being dominated by external noise. The raw distribution is logged to the JSONL file for post-hoc analysis.

### 3b.4 Claude Code settings.json snippet

User adds this to `~/.claude/settings.json` (one-time setup):

```json
{
  "hooks": [
    { "event": "SessionStart",     "command": "compost hook session-start",     "timeout": 5000 },
    { "event": "UserPromptSubmit", "command": "compost hook user-prompt-submit", "timeout": 5000 },
    { "event": "PreToolUse",       "command": "compost hook pre-tool-use",       "timeout": 5000 },
    { "event": "PostToolUse",      "command": "compost hook post-tool-use",      "timeout": 5000 },
    { "event": "Stop",             "command": "compost hook stop",               "timeout": 5000 }
  ]
}
```

Zero user-side setup beyond pasting this block. No long-running adapter process. Each hook invocation appends to `~/.compost/ledger.db.observe_outbox` directly (v2.2 merged outbox); `compost-daemon` drains on its own schedule.

---

## 4. Python `compost_ingest` CLI contract

Unchanged boundary from phase0-spec.md §4 + debate #3: hybrid boundary, subprocess CLI with JSON stdin/stdout, no DB access from Python, no imports from Node.

### 4.1 Invocation

```
python -m compost_ingest extract [--mime <type>] [--policy <tp-id>] < stdin > stdout
```

### 4.2 Input schema (updated for debate #3 Q4 + debate #4 C)

```json
{
  "observe_id": "018f3c...",
  "source_uri": "file://$NOTES/foo.md",
  "mime_type": "text/markdown",
  "content_ref": "inline",
  "content": "<base64 or raw utf-8>",
  "transform_policy": "tp-2026-04",
  "context_scope_id": "work",              // optional, from derivation_run.context_scope_id
  "extraction_profile": "default"          // optional, from derivation_run.extraction_profile
}
```

### 4.3 Output schema

```json
{
  "observe_id": "018f3c...",
  "extractor_version": "compost-ingest@0.1.0",
  "extractor_stack": ["docling@1.2.0", "unstructured@0.13.0"],
  "transform_policy": "tp-2026-04",
  "context_scope_id": "work",
  "extraction_profile": "default",
  "chunks": [
    {
      "chunk_id": "c0",
      "text": "...",
      "metadata": { "heading_path": ["h1 Title", "h2 Section"], "page": 1 }
    }
  ],
  "facts": [
    {
      "subject": "Next.js 16",
      "predicate": "introduces",
      "object": "Cache Components",
      "confidence": 0.9,
      "importance": 0.7,
      "episodic_metadata": null
    }
  ],
  "entities": [ ... ],
  "normalized_content": "...",
  "content_hash_raw": "sha256:...",
  "content_hash_normalized": "sha256:...",
  "warnings": []
}
```

**Optional `facts[].episodic_metadata`** (Phase 3+ consumer, Phase 0 ignores):
```json
{
  "event_type": "deployment",
  "participants": ["zion"],
  "location": null,
  "occurred_at": "2026-04-11T06:33:00Z"
}
```

When this field is present, Phase 3+ writes an additional `memory_episodic` row referencing the `fact_id`. Phase 0 accepts the field for forward compatibility but does not materialize episodic records.

### 4.4 Schema contract test (mandatory from debate #1)

File: `packages/compost-ingest/tests/test_schema_contract.py`

Fixtures in `tests/fixtures/` — minimum 3 markdown files with known expected chunk/fact output. Contract test asserts JSON schema validation + structural equivalence. Blocks any Python dep bump that changes extractor output shape.

### 4.5 Python subprocess failure handling (v2.1)

The ingest worker that calls `python -m compost_ingest extract` must handle these failure modes explicitly. Every case has a defined outcome — no "TBD" or "depends on implementation."

| Failure | Detection | Response |
|---|---|---|
| **Subprocess timeout** | 120s default, per-policy override via `transform_policy.extraction_timeout_sec` | Kill process group (SIGTERM then SIGKILL after 5s), record `ingest_queue.last_error = 'timeout after Ns'`, decrement `lease_expires_at` so another worker can retry on next claim cycle, leave `completed_at` NULL |
| **Non-zero exit code** | `child.exitCode != 0` | Capture stderr, store in `last_error`, increment `attempts`, release lease |
| **Malformed JSON on stdout** | JSON.parse throws | Same as above with `last_error = 'malformed JSON: <first 200 chars>'` |
| **JSON doesn't match §4.3 schema** | `ajv.validate(OUTPUT_SCHEMA, parsed) === false` | Same as above with `last_error = 'schema violation: <ajv error summary>'` |
| **`extractor_version` mismatch** | output.extractor_version < minimum in transform_policy | `last_error = 'extractor_version X below required Y, upgrade compost_ingest'`, DO NOT retry this policy |
| **OOM / SIGKILL** | `child.signalCode === 'SIGKILL'` with no exit code | `last_error = 'killed (likely OOM)'`, reduce next-attempt input size via policy chunking hint, retry |
| **uv not found / venv broken** | spawn fails with ENOENT | Fatal: log, flag daemon as degraded, do NOT silently drop events. Next `compost daemon status` reports degraded state. |

**Retry and DLQ policy (v2.2: unified state machine)**:

Extraction quarantine uses the `ingest_queue.attempts` column (already in DDL) and is enforced by the claim SQL in §10.2:

```sql
-- In the §10.2 claim SQL, the WHERE clause must include:
WHERE completed_at IS NULL
  AND attempts < :max_extraction_retries     -- from transform_policy.extraction.maxRetries (default 3)
  AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))
```

- `attempts < transform_policy.extraction.maxRetries` (default 3): released to queue, retried after lease expiry
- `attempts >= maxRetries`: row is never claimed again. `compost daemon status` surfaces it in `quarantined_queue_count`. Operator runs `compost doctor --extract-retry <id>` to clear `attempts = 0` for re-try after fixing the extractor.
- **No fake timestamp markers**: v2.1's `started_at = '1970-01-01'` quarantine hack is replaced by the proper `attempts >= maxRetries` predicate in the claim SQL. Clean, single state machine, no implicit side-channel.

**Outbox drain quarantine** (§1.6.2): uses `drain_quarantined_at` column, threshold 5. **Extraction quarantine** (this section): uses `attempts >= maxRetries` predicate, threshold per-policy (default 3). The two are independent state machines on independent tables (`observe_outbox` and `ingest_queue`), each with its own doctor subcommand.

**Poison pill asymmetry**: outbox drain failures are almost always daemon bugs (fixable by restart, hence higher threshold 5); extraction failures are more often content issues (unfixable without operator review, hence lower threshold 3 with per-policy override).

---

## 5. Core API

File: `packages/compost-core/src/api.ts`

Pure functions. No hidden side effects on import. Contract shared by Daemon mode and Embedded mode.

```typescript
export interface CompostContext {
  dataDir: string;          // default: ~/.compost
  transformPolicy: string;  // default: current
  rankingProfile?: string;  // default: 'rp-phase1-default'
}

export interface ObserveEvent {
  adapter: string;          // e.g. 'compost-adapter-airi@0.1.0'
  source_id: string;
  source_uri: string;
  occurred_at: string;
  content: string | Uint8Array;
  mime_type: string;
  adapter_sequence: number; // assigned by outbox.seq at drain time; 0 means "auto-assign"
  trust_tier: 'user' | 'first_party' | 'web';
  idempotency_key: string;
  transform_policy: string; // must exist in policies table; validated by compost-core
  metadata?: Record<string, unknown>;
  contexts?: string[];      // context_id list for source_context link
}

export interface ObserveResult {
  observe_id: string;
  stored: boolean;
  duplicate_of?: string;
}

export interface QueryOptions {
  contexts?: string[];
  budget?: number;
  ranking_profile_id?: string;
  as_of_unix_sec?: number;  // if omitted, uses current clock
  debug_ranking?: boolean;  // writes to ranking_audit_log if true
}

export interface QueryHit {
  fact: { subject: string; predicate: string; object: string };
  fact_id: string;
  confidence: number;
  provenance: {
    source_uri: string;
    captured_at: string;
    adapter: string;
    transform_policy: string;
  };
  contexts: string[];
  ranking_components: Record<string, number>;  // e.g. { w1_semantic: 0.87, decay: 0.42 }
  final_score: number;
}

export interface Compost {
  // v2.2 clarification: `observe()` is the EMBEDDED-mode TypeScript API.
  // It appends synchronously to observe_outbox and returns the outbox row's seq + idempotency_key
  // in ObserveResult. It is NOT the same as the `compost.observe` MCP notification,
  // which is a one-way fire-and-forget wire protocol (void return) — see §6.
  observe(event: ObserveEvent, ctx?: CompostContext): Promise<ObserveResult>;
  query(q: string, opts?: QueryOptions, ctx?: CompostContext): Promise<QueryHit[]>;
  ask(q: string, opts?: QueryOptions, ctx?: CompostContext): Promise<{ answer: string; hits: QueryHit[] }>;
  describeCoverage(topic: string, ctx?: CompostContext): Promise<CoverageReport>;
  reportGap(q: string, consumerId: string, ctx?: CompostContext): Promise<void>;
  reflect(ctx?: CompostContext): Promise<ReflectionReport>;
  feedback(queryId: string, factId: string, selected: boolean, ctx?: CompostContext): Promise<void>;
}

export function createCompost(ctx: CompostContext): Compost {
  // Returns a Compost instance with functions bound to the ctx dataDir.
  // Creates DB handles lazily; does NOT start any timers or background work.
}
```

### 5.1 Query execution (Phase 1+ with stateless decay + ranking)

The Stage-1 → Stage-2 bridge uses a **connection-scoped temporary table** to carry LanceDB's per-candidate cosine scores into the SQLite rerank. SQLite parameterized queries cannot bind an array to `IN (...)` so we stage candidates as rows, not as bind parameters.

**v2.2 correction**: `CREATE TEMP TABLE` is connection-scoped, NOT transaction-scoped. The table persists across commits until the connection closes or `DROP TABLE` is called. The code below uses `CREATE TEMP TABLE IF NOT EXISTS` + `DELETE FROM query_candidates` on every query to reset state. This is correct under the actual SQLite semantics.

**Phase 0 only exposes the Phase 1-3 factors in the rerank SQL** (w1_semantic, w2_temporal, w3_access, w4_importance). Phase 4 factors (w5_emotional, w6_repetition_penalty, w7_context_mismatch) are added in later migrations and follow the same pattern. `ranking_components` API always returns all active factors as a `Record<string, number>`, never a fixed tuple.

```typescript
async function query(q: string, opts: QueryOptions = {}, ctx: CompostContext): Promise<QueryHit[]> {
  const asOf = opts.as_of_unix_sec ?? Math.floor(Date.now() / 1000);
  const profileId = opts.ranking_profile_id ?? 'rp-phase1-default';
  const profile = await loadRankingProfile(profileId);
  const queryId = uuidv7();

  // Stage 1: LanceDB ANN narrows to top-K candidates with cosine scores
  // (Phase 0 stub: returns [] — no embeddings yet. Phase 1 wires LanceDB.)
  const candidates: Array<{ fact_id: string; cosine: number }> =
    await lancedb.searchWithScores(q, { topK: 200 });

  if (candidates.length === 0) {
    return [];  // Phase 0 path: no embeddings → empty result with correct shape
  }

  // Stage 2: SQLite rerank. Use a transaction + temp table to carry Stage-1 scores.
  return db.transaction(tx => {
    // Create the bridge table. TEMP schema is per-connection and dies at commit.
    tx.exec(`
      CREATE TEMP TABLE IF NOT EXISTS query_candidates (
        fact_id TEXT PRIMARY KEY,
        semantic_score REAL NOT NULL
      );
      DELETE FROM query_candidates;
    `);

    // Populate candidate bridge table (parameterized insert, one row per candidate)
    const insertCandidate = tx.prepare('INSERT INTO query_candidates (fact_id, semantic_score) VALUES (?, ?)');
    for (const c of candidates) {
      insertCandidate.run(c.fact_id, c.cosine);
    }

    // Context filter bridge table. Same pattern as query_candidates so we don't have to
    // mix positional and named parameters in the main prepared statement.
    // When opts.contexts is empty, this table is empty and the EXISTS clause is skipped
    // via a branch in the SQL below.
    tx.exec(`
      CREATE TEMP TABLE IF NOT EXISTS query_context_filter (
        context_id TEXT PRIMARY KEY
      );
      DELETE FROM query_context_filter;
    `);
    const hasContextFilter = opts.contexts && opts.contexts.length > 0;
    if (hasContextFilter) {
      const insertCtx = tx.prepare('INSERT INTO query_context_filter (context_id) VALUES (?)');
      for (const ctxId of opts.contexts!) insertCtx.run(ctxId);
    }

    // Main rerank query. Fully named parameters, no positional mixing.
    // The context filter uses `:has_context_filter` + EXISTS against the bridge table
    // so there is no need for dynamic SQL composition based on opts.contexts length.
    const reranked = tx.prepare(`
      SELECT
        f.fact_id, f.subject, f.predicate, f.object, f.confidence,
        f.importance, f.half_life_seconds, f.last_reinforced_at_unix_sec,
        o.source_uri, o.captured_at, o.adapter, o.transform_policy,
        qc.semantic_score,
        COALESCE(al.cnt, 0) AS access_count,
        -- Per-factor contributions (for both final_score AND ranking_components return)
        (:w1_semantic * COALESCE(qc.semantic_score, 0.0)) AS w1_semantic,
        (:w2_temporal * POW(0.5, (:as_of - f.last_reinforced_at_unix_sec) * 1.0 / f.half_life_seconds)) AS w2_temporal,
        (:w3_access * MIN(1.0, LN(1 + COALESCE(al.cnt, 0)) * 1.0 / LN(1 + :access_sat))) AS w3_access,
        (:w4_importance * COALESCE(f.importance, 0.0)) AS w4_importance,
        -- Context list aggregated into JSON array for QueryHit.contexts
        (SELECT json_group_array(fc2.context_id) FROM fact_context fc2 WHERE fc2.fact_id = f.fact_id) AS contexts_json,
        -- Final score
        (
          (:w1_semantic * COALESCE(qc.semantic_score, 0.0))
          + (:w2_temporal * POW(0.5, (:as_of - f.last_reinforced_at_unix_sec) * 1.0 / f.half_life_seconds))
          + (:w3_access * MIN(1.0, LN(1 + COALESCE(al.cnt, 0)) * 1.0 / LN(1 + :access_sat)))
          + (:w4_importance * COALESCE(f.importance, 0.0))
        ) AS final_score
      FROM facts f
      JOIN query_candidates qc ON qc.fact_id = f.fact_id
      JOIN observations o ON o.observe_id = f.observe_id
      LEFT JOIN (
        -- Scoped aggregate: only count access_log rows for the candidate set,
        -- so the index on access_log(fact_id) is used instead of a full-log scan.
        SELECT al_inner.fact_id, COUNT(*) AS cnt
        FROM access_log al_inner
        WHERE al_inner.fact_id IN (SELECT fact_id FROM query_candidates)
        GROUP BY al_inner.fact_id
      ) al USING (fact_id)
      WHERE f.archived_at IS NULL
        AND (
          :has_context_filter = 0
          OR EXISTS (
            SELECT 1 FROM fact_context fc
            JOIN query_context_filter qcf ON qcf.context_id = fc.context_id
            WHERE fc.fact_id = f.fact_id
          )
        )
      ORDER BY final_score DESC
      LIMIT :budget
    `).all({
      w1_semantic: profile.w1_semantic,
      w2_temporal: profile.w2_temporal,
      w3_access: profile.w3_access,
      w4_importance: profile.w4_importance,
      as_of: asOf,
      access_sat: profile.access_saturation,
      budget: opts.budget ?? 20,
      has_context_filter: hasContextFilter ? 1 : 0,
    });

    // Telemetry: batch append access_log (append-only, fire-and-forget).
    // This is a WRITE but it's off the critical retrieval path — the return value
    // above doesn't wait for the append to commit. The batched insert amortizes
    // the write across all reranked candidates.
    queueMicrotask(() => appendAccessLog(reranked.map(r => r.fact_id), queryId, profileId));

    // ranking_audit_log: written when debug_ranking=true OR when any wN > 0 beyond w1.
    // Phase 1 (w1 only): write rate governed by env COMPOST_RANKING_SAMPLE_RATE
    // (default 0 in prod, 1.0 in dev). Phase 2+ (multi-factor active): always write.
    const shouldWriteAudit =
      opts.debug_ranking === true
      || profile.w2_temporal > 0
      || profile.w3_access > 0
      || profile.w4_importance > 0
      || Math.random() < Number(process.env.COMPOST_RANKING_SAMPLE_RATE ?? 0);

    if (shouldWriteAudit) {
      queueMicrotask(() => writeAuditLog(reranked, queryId, profileId, asOf));
    }

    return reranked.map(r => ({
      fact: { subject: r.subject, predicate: r.predicate, object: r.object },
      fact_id: r.fact_id,
      confidence: r.confidence,
      provenance: {
        source_uri: r.source_uri,
        captured_at: r.captured_at,
        adapter: r.adapter,
        transform_policy: r.transform_policy,
      },
      contexts: JSON.parse(r.contexts_json ?? '[]'),
      ranking_components: {
        w1_semantic: r.w1_semantic,
        w2_temporal: r.w2_temporal,
        w3_access: r.w3_access,
        w4_importance: r.w4_importance,
      },
      final_score: r.final_score,
    }));
  });  // end of db.transaction
}
```

**Why a temp table instead of CTE or JSON**: (a) CTE with VALUES would require constructing a giant SQL string at runtime — injection risk + cache miss. (b) JSON blob + `json_each` works but prevents the query planner from using the index on `facts.fact_id`. (c) Temp table gives the planner a real PK to join on, works with parameterized inserts, and is automatically cleaned up at transaction end.

**Why the transaction wraps everything**: SQLite's `TEMP` schema is per-connection. A `CREATE TEMP TABLE` + `SELECT` sequence without a transaction can interleave with other connection work. Wrapping ensures the temp table is fully populated before the rerank runs and cleared at end.

**Access log write path**: `queueMicrotask(() => appendAccessLog(...))` deliberately runs AFTER the `return` is scheduled, so the write happens after the caller has the result. Phase 3+ may tighten this to a batched per-second flush if the per-query microtask becomes a bottleneck.

**Phase 0 scope**: `query` returns `[]` with correct schema (no facts yet). `ranking_components` shape is committed but empty.
**Phase 1 scope**: semantic search active (w1 only); LanceDB Stage 1 wired up.
**Phase 2 scope**: w2 temporal decay activated; SLO enforcement.
**Phase 3 scope**: w3 access_count + w4 importance.
**Phase 4 scope**: w5-w7 + calibration from `ranking_audit_log` feedback.

---

## 6. MCP server tools

Exposed by `compost-daemon`:

| Tool | MCP type | Return | Phase | Description |
|---|---|---|---|---|
| `compost.observe` | **notification** | void (one-way) | 0 | Write-path fallback for remote adapters that can't open ledger.db directly. Daemon receives, runs same `INSERT OR IGNORE` into `observe_outbox` as direct append. |
| `compost.query` | tool | `QueryHit[]` | 0 (stub) / 1 (active) | Returns ranked facts with provenance + ranking_components |
| `compost.ask` | tool | `{answer, hits}` | 2 | LLM-synthesized answer using L3 wiki + L2 facts, shares ranking contract with query |
| `compost.describe_coverage` | tool | `CoverageReport` | 3 | Coverage SLO report for a topic or source |
| `compost.report_gap` | tool | void | 3 | Consumer reports "you could not answer this" → gaps table |
| `compost.reflect` | tool | `ReflectionReport` | 0 (sensory-GC only) / 3+ (full loop) | Manual trigger for reflection |
| `compost.feedback` | tool | void | 1 | Record `result_selected` for a fact_id / query_id pair — activates when `ranking_audit_log` starts being written |

**v2.2 clarification on `compost.observe`**: the MCP wire protocol is a **notification** — one-way, void return, no `observe_id` feedback to the caller. The caller trusts the daemon's `INSERT OR IGNORE` + its own deterministic `idempotency_key` for at-least-once semantics. Remote callers that NEED an acknowledgement should use the embedded-mode `Compost.observe()` API over a local MCP tool wrapper (returns `Promise<ObserveResult>`), not the notification.

**Phase 0 tool set** (ship with daemon v0.1): `compost.observe`, `compost.query` (empty-result stub, correct shape), `compost.reflect` (sensory-tier hard-GC + tombstone sweep). Not shipped in Phase 0: `compost.ask`, `compost.describe_coverage`, `compost.report_gap`, `compost.feedback`.

**`compost.feedback` phase rule (authoritative)**: the TOOL ships in Phase 1 together with real `compost.query` results, because feedback without results is meaningless. The `ranking_audit_log` table (§1.4) is created in Phase 0 migration so it's ready when Phase 1 starts populating it. The `compost feedback` CLI subcommand in §0 lists is ALSO Phase 1, not Phase 0 — corrected here as the authoritative phase assignment.

---

## 7. `is_noteworthy()` — from debate #1

Unchanged from phase0-spec.md §7. Phase 0 implements the first three gates (raw hash, normalized hash, MinHash jaccard). Fixture tests (6 cases) required before commit.

---

## 8. Cognitive architecture layer (NEW — from debate #4)

This section is what makes Compost v2 "brain-like" vs v1's "RAG cache." The schema above implements the mechanisms; this section describes the cognitive model they serve.

### 8.1 The 5-tier mental model

| Tier | Mapping | Physical table | Lifecycle |
|---|---|---|---|
| **Sensory buffer** | Recent observations before derivation | `observations` where `adapter` in `source.kind='sensory'`, filtered by `captured_at > now - 7d` | Hard-GC by `compost reflect` after TTL |
| **Working memory** | Recently accessed facts in session scope | `facts` filtered by `last_reinforced_at_unix_sec > now - 2h` via decay formula (no physical filter) | Stateless ranking surface |
| **Episodic memory** | Event records with time + participants | Phase 3: `memory_episodic` linked to `facts` via `fact_id` | Append-only, link pattern |
| **Semantic memory** | Extracted facts with decay + importance | `facts` table | Soft tombstone via `archived_at`, decay via formula |
| **Procedural memory** | Skills and procedures | Phase 4: `memory_procedural` standalone schema | Never forgotten, success/failure tracked |

**Key principle**: tiers are conceptual, not physical. A single logical surface (`memories` via views or direct `facts` query) serves the retrieval API. Tier is discriminated by `kind` metadata on source + extracted claims, not by which table stores the row.

**5-tier cognitive ↔ L-layer mapping** (v2.1 clarification):

| Cognitive tier | L-layer(s) | Derivation layer in `derivation_run.layer` | Physical table(s) |
|---|---|---|---|
| Sensory buffer | L0 raw ledger filtered by `source.kind='sensory'` | N/A (no derivation) | `observations` |
| Working memory | L2 filtered by decay formula (not a persistent column) | L2 | `facts` |
| Episodic memory | L2 with explicit temporal+participant metadata | L2 | `facts` + Phase 3 `memory_episodic` link |
| Semantic memory | L2 general facts | L2 | `facts` |
| Procedural memory | L2 with `kind='procedure'` marker | L2 | `facts` + Phase 4 `memory_procedural` standalone |

The `derivation_run.layer CHECK(IN ('L1','L2','L3'))` column identifies **where the derivation landed** (L1=chunks/vectors, L2=facts, L3=wiki pages). The cognitive tier identifies **what kind of memory a fact represents**. These are orthogonal — a procedural memory and a semantic memory both live under `derivation_run.layer='L2'` but have different `kind` values on their source metadata.

This decoupling lets the rebuild path (§Step 13b) query by L-layer ("rebuild all L1 chunks under policy tp-X") while the retrieval path queries by cognitive kind ("give me procedural memories about compiling Rust").

### 8.2 Stateless query-time decay

Decay is **computed at SELECT time**, never written by a background job. The formula:

```
decayed_score(fact) = importance * POW(0.5, (as_of - last_reinforced_at) / half_life_seconds)
```

Arguments:
- `as_of`: request-scoped `:as_of_unix_sec` bind parameter (cursor stability)
- `last_reinforced_at`: explicit column, separate from `created_at` (ranking state ≠ rebuild identity)
- `half_life_seconds`: per-fact column set by `transform_policy` at insertion time

**Access reinforcement** (Phase 3+):
- Retrieval writes to `access_log` append-only table (batched, no fact-row lock)
- Reinforcement signal `MIN(1.0, LN(1 + access_count) / LN(1 + access_saturation))` joined in decay query
- Saturation prevents a 10K-access row from dominating all other signals

**Forgetting** (Phase 0):
- Sensory-tier: hard DELETE after 7-day TTL via `compost reflect`
- Semantic-tier: soft tombstone (`archived_at` set) when `decayed_score < 0.001` and `importance_pinned = FALSE`
- Procedural-tier: never forgotten

### 8.3 Probabilistic multi-factor ranking

Formula (fully populated, Phase 4 state):
```
rank = w1*semantic_similarity          (0..1, cosine from LanceDB)
     + w2*temporal_relevance            (0..1, stateless decay)
     + w3*reinforcement_score           (0..1, bounded saturation)
     + w4*importance                    (0..1, per-fact)
     + w5*emotional_intensity           (0..1, abs(valence) * arousal, Phase 4+)
     - w6*repetition_penalty            (0..1, if served in last N queries)
     - w7*context_mismatch              (0..1, if context filter active)
```

**Staging schedule**:
| Phase | Active factors | Notes |
|---|---|---|
| Phase 1 | w1 | Semantic search only; audit log collects ground truth |
| Phase 2 | w1 + w2 | Temporal decay activated; SLO enforcement |
| Phase 3 | w1 + w2 + w3 + w4 | Reinforcement + importance |
| Phase 4 | all 7 | Emotional + penalties |

**Non-negotiable**:
- `ranking_components` API contract committed from Phase 0 (even when only w1 active)
- `COALESCE(..., 0.0)` on every term for NULL safety
- Bounded reinforcement `MIN(1.0, LN(1+n)/LN(1+sat))`, never raw `sqrt`
- `ranking_audit_log` write rule (v2.1 clarification): **always write** when any ranking factor beyond w1 is active (profile has non-zero w2..w7), OR when `opts.debug_ranking = true`, OR when sampled at `COMPOST_RANKING_SAMPLE_RATE` (env var, default 0.0 prod, 1.0 dev). Phase 1 collects ground truth via env sampling; Phase 2+ logs every query because w2+ is always active.
- `compost.ask` and `compost.query` share ranking contract (one formula, multiple call sites)
- SLO: p50 < 100ms, p99 < 500ms on 100K-fact database. If violated → drop factors, not scale hardware.

### 8.4 Reflection loop

`compost reflect` is the active forgetting and consolidation mechanism. Phase 0 scope is minimal but has to respect FK cascade order, transaction atomicity, and surface GC blockers back to the caller.

```typescript
interface ReflectionReport {
  sensoryObservationsDeleted: number;      // rows removed from observations
  sensoryFactsCascaded: number;            // child rows cascade-deleted via facts.observe_id
  semanticFactsTombstoned: number;         // facts.archived_at updated
  outboxRowsPruned: number;                // drained outbox rows older than retention window
  skippedDueToFkViolation: number;         // should be 0 after v2.1 fixes — any non-zero is a bug
  reflectionDurationMs: number;
  errors: Array<{ step: string; message: string }>;  // soft-fail per step, not per reflect call
}

async function reflect(ctx: CompostContext): Promise<ReflectionReport> {
  const startedAt = Date.now();
  const report: ReflectionReport = {
    sensoryObservationsDeleted: 0,
    sensoryFactsCascaded: 0,
    semanticFactsTombstoned: 0,
    outboxRowsPruned: 0,
    skippedDueToFkViolation: 0,
    reflectionDurationMs: 0,
    errors: [],
  };

  // Acquire the reflect lock (one reflect runs at a time globally, cross-process)
  const lockAcquired = await acquireFileLock(
    `${ctx.dataDir}/reflect.lock`,
    { staleMs: 15 * 60 * 1000 /* 15 min stale */ }
  );
  if (!lockAcquired) {
    report.errors.push({ step: 'acquireLock', message: 'another reflect is in progress' });
    return report;
  }

  try {
    // Step 1: Sensory hard-GC.
    // FK cascade (facts, ingest_queue, captured_item) drops dependent rows automatically.
    // derivation_run.observe_id and wiki_page_observe.observe_id also cascade (debate #3 schema).
    // Count cascaded facts BEFORE the delete so the report is accurate.
    await db.transaction(tx => {
      const factsCount = tx.prepare(`
        SELECT COUNT(*) AS c FROM facts f
        JOIN observations o ON o.observe_id = f.observe_id
        WHERE o.captured_at < datetime('now', '-7 days')
          AND o.source_id IN (SELECT id FROM source WHERE kind = 'sensory')
      `).get() as { c: number };
      report.sensoryFactsCascaded = factsCount.c;

      const result = tx.prepare(`
        DELETE FROM observations
        WHERE captured_at < datetime('now', '-7 days')
          AND source_id IN (SELECT id FROM source WHERE kind = 'sensory')
      `).run();
      report.sensoryObservationsDeleted = result.changes;
    }).catch((err: Error) => {
      report.errors.push({ step: 'sensoryGC', message: err.message });
      if (err.message.includes('FOREIGN KEY')) report.skippedDueToFkViolation++;
    });

    // Step 2: Semantic soft-tombstone (no FK concerns — archived_at is just a column update).
    const tombstoneResult = await db.prepare(`
      UPDATE facts SET archived_at = datetime('now')
      WHERE archived_at IS NULL
        AND importance_pinned = FALSE
        AND importance * POW(0.5,
          (unixepoch() - last_reinforced_at_unix_sec) * 1.0 / half_life_seconds
        ) < 0.001
    `).run().catch((err: Error) => {
      report.errors.push({ step: 'semanticTombstone', message: err.message });
      return { changes: 0 };
    });
    report.semanticFactsTombstoned = tombstoneResult.changes;

    // Step 3: Prune drained outbox rows older than retention window (7 days default).
    // v2.2: single table in ledger.db, no adapter directory iteration.
    // Quarantined rows (drain_quarantined_at IS NOT NULL) are NEVER pruned here —
    // operator must release them via `compost doctor --drain-retry`.
    try {
      const pruned = db.prepare(`
        DELETE FROM observe_outbox
        WHERE drained_at IS NOT NULL
          AND drained_at < datetime('now', '-7 days')
          AND drain_quarantined_at IS NULL
      `).run();
      report.outboxRowsPruned = pruned.changes;
    } catch (err) {
      report.errors.push({ step: 'pruneOutbox', message: (err as Error).message });
    }
  } finally {
    await releaseFileLock(`${ctx.dataDir}/reflect.lock`);
  }

  report.reflectionDurationMs = Date.now() - startedAt;
  return report;
}
```

**Phase 3+** additions: contradiction arbitration, L3 wiki rebuild, `compost.ask` synthesis refresh, fact consolidation (similar facts merged via embedding cluster).

**Phase 4** additions: curiosity agent / gap tracker / SearchPlan generator for active learning (Phase 4 scope, not Phase 0).

**Scheduler**: Phase 0 `compost-daemon` runs `reflect()` every 6 hours via an internal timer. User can trigger manually with `compost reflect`. The reflect file lock prevents concurrent runs if the user triggers while the timer fires.

### 8.5 Classification boundary (Q1 from debate #4)

When the extractor returns a claim with explicit temporal AND participant metadata, emit BOTH:
1. ALWAYS: one `facts` row (semantic anchor, discoverable via `compost.query`)
2. IF promotion-eligible: one `memory_episodic` row (Phase 3+) that REFERENCES the fact via `fact_id`, carrying only episodic-specific fields (`event_type`, `participants`, `location`, `occurred_at`)

This is **link-not-duplicate**: no row-bloat, no redundant vectors, semantic search always finds the anchor, episodic queries join to retrieve full context. Phase 0 accepts `episodic_metadata` in the extractor output but does not materialize `memory_episodic` rows (Phase 3 work).

---

## 9. `install.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> compost install"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found. install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found. install: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

# Guardrail: detect sync services (debate #1)
COMPOST_DIR="${HOME}/.compost"
case "$COMPOST_DIR" in
  *Dropbox*|*iCloud*|*OneDrive*|*"Google Drive"*)
    echo "ERROR: ~/.compost must be on local disk. Detected sync service path."
    echo "See docs/portability.md"
    exit 1
    ;;
esac

echo "==> installing Node workspaces"
bun install

echo "==> bundling compost hook shim (fast cold start)"
bun run --cwd packages/compost-hook-shim bundle

echo "==> installing Python compost_ingest"
( cd packages/compost-ingest && uv sync --frozen )

echo "==> running schema contract test"
( cd packages/compost-ingest && uv run pytest tests/test_schema_contract.py -q )

echo "==> creating data dir"
mkdir -p "${HOME}/.compost"/{blobs,wiki,logs}
# Note (v2.2): no adapters/<name>/outbox.db dirs — observe_outbox is in ledger.db

echo "==> locking down permissions (0700 — owner only)"
chmod 700 "${HOME}/.compost"
chmod 700 "${HOME}/.compost/blobs"
chmod 700 "${HOME}/.compost/wiki"
chmod 700 "${HOME}/.compost/logs"
# SQLite WAL/SHM files inherit these perms at creation time under WAL mode.
# The ledger.db file is created with 0600 by better-sqlite3; its -wal and -shm
# sidecars inherit from the parent dir's 0700.

echo "==> applying L0 schema"
bun run --cwd packages/compost-core schema:apply
# This runs migrations 0001..0004 AND upserts the TypeScript policies registry
# into the `policies` SQL table BEFORE any writer can connect.

echo "==> measuring compost hook cold start"
bun run --cwd packages/compost-cli -- doctor --measure-hook
# Fails installation if p95 > 30ms on reference hardware. See §11 DoD.

echo "==> done. try: compost daemon start --help"
echo ""
echo "To integrate with Claude Code, add this to ~/.claude/settings.json:"
echo '  "hooks": ['
echo '    { "event": "SessionStart",     "command": "compost hook session-start",     "timeout": 5000 },'
echo '    { "event": "UserPromptSubmit", "command": "compost hook user-prompt-submit", "timeout": 5000 },'
echo '    { "event": "PreToolUse",       "command": "compost hook pre-tool-use",       "timeout": 5000 },'
echo '    { "event": "PostToolUse",      "command": "compost hook post-tool-use",      "timeout": 5000 },'
echo '    { "event": "Stop",             "command": "compost hook stop",               "timeout": 5000 }'
echo '  ]'
```

**Permissions rationale**: `~/.compost/` holds the user's entire ingested memory — markdown content, observations, derived facts. Default macOS umask is 022 which creates world-readable directories (`drwxr-xr-x`). Any process on the machine running as another user could read `~/.compost/ledger.db` and walk the provenance chain. `chmod 700` restricts to the owning user only. This does NOT protect against root or same-user malware, but it closes the multi-user-machine data leak.

---

## 10. Day-one guardrails (merged across all debates)

| Guardrail | Source | Implementation |
|---|---|---|
| `compost doctor --reconcile` runs before any autonomous crawl ships | debate #1 | `compost-cli` subcommand comparing L0 count vs LanceDB + policy audit |
| `compost doctor --measure-hook` reports cold-start p50/p95 | debate #4 | install.sh runs this; install fails if p95 > 30ms |
| `compost doctor --rebuild L1 --policy <tp>` verifies rebuild | debate #3 | Step 13b, pinned policy name mandatory |
| `compost doctor --drain-retry` releases quarantined outbox poison pills | v2.1 | clears outbox rows where `drain_attempts > 5` |
| **Cross-process LanceDB lock via proper-lockfile** | debate #1 + v2.1 | Daemon and any `compost add`/CLI writer acquire `~/.compost/lancedb.lock` via [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) before writes. Stale lock timeout 60s. NOT a within-process AsyncMutex — must survive across processes. |
| `~/.compost/` on local disk only | debate #1 | install.sh detects and errors on sync service paths |
| `~/.compost/` permissions `chmod 700` | v2.1 | install.sh applies; protects against multi-user-machine data leak |
| `daemon` process supervision spec | v2.1 | see §10.1 below for PID file / socket / startup idempotency |
| `$REPOS`, `$HOME` expansion validation | debate #1 | explicit env check in any writer path |
| Contradiction arbitration has real confidence variance | debate #1 | seed passive 0.85, active push 0.95, web 0.75 |
| L3 freshness derived from L2 via `wiki_page_observe` join | debate #3 | no more JSON-array scans |
| Python dep pinning (`uv.lock`) + schema contract test | debate #1 | CI-blocking on Python output drift |
| Python subprocess failure handling spec | v2.1 | see §4.5 below for timeout/retry/DLQ |
| Outbox durability for all adapters (v2.2: merged) | debate #1 + #6 | canonical schema + drain in §1.6 — `observe_outbox` is a table in `ledger.db`, NOT per-adapter files |
| `compost hook` sync outbox append before ack | debate #4 + #6 | WAL commit mandatory before exit 0; target is `ledger.db` not adapter-local file |
| Deterministic `idempotency_key = sha256(adapter||source_id||envelope)` | debate #4 | identical across retries; deduped by outbox idx_outbox_idempotency UNIQUE AND observations UNIQUE |
| **Writer budget guardrail (v2.2 from Sonnet debate #6 concession)** | v2.2 | any `ledger.db` write > 50ms pino-logged with op-name; `compost daemon status --degraded` surfaces when >1 event in last minute |
| **Drain transaction auto-registers sources** (v2.2 from Gemini debate #5 R2) | v2.2 | drain step 2: `INSERT OR IGNORE INTO source` using envelope's source_kind/source_uri |
| **Drain transaction auto-links source_context** (v2.2 from Gemini debate #5 R2) | v2.2 | drain step 3: loop over envelope's contexts array, `INSERT OR IGNORE INTO source_context` |
| `is_noteworthy()` gates before autonomous crawl ingest | debate #1 | 6 fixture tests; Phase 4+ uses this |
| Coverage SLO schema day-one | debate #1 | `expected_item` + `captured_item` |
| "Auditable Coverage" in docs, not "Complete" | debate #1 | grep check on `coverage-slo.md` |
| Derivation versioning via `derivation_run` table | debate #3 | created directly in 0002 (the v1 `derivations` table never ships) |
| `policies` SQL table populated from TypeScript registry | debate #3 | upsert on daemon startup, BEFORE any writer connects |
| `transform_policy` validated at app layer, not SQL FK | v2.1 | see §2 for rationale |
| `context` as entity, no JSON array | debate #3 | `fact_context` + `source_context` joins |
| `ingest_queue` lease columns for multi-writer | debate #3 | `lease_owner`, `lease_token`, `lease_expires_at` — claim SQL in §10.2 |
| FK CASCADE on `facts.observe_id`, `ingest_queue.observe_id`, `captured_item.observe_id` | v2.1 | sensory GC cannot FK-fail |
| Stateless decay with `as_of_unix_sec` bind | debate #4 | no inline `strftime('%s','now')` in ORDER BY |
| `last_reinforced_at_unix_sec` explicit column | debate #4 | separate from `created_at` |
| `half_life_seconds` per-fact, set by policy | debate #4 | immutable after insertion |
| `access_log` append-only, no inline writes | debate #4 | batched telemetry |
| Sensory hard-GC via `compost reflect` | debate #4 | 7-day TTL; cascades through FK |
| `reflect.lock` file lock prevents concurrent reflect runs | v2.1 | 15min stale timeout |
| `ranking_components` API locked Phase 0 | debate #4 | committed even with w1-only |
| `ranking_audit_log` write rule: always on w2+, sampled on w1-only | v2.1 clarification | `COMPOST_RANKING_SAMPLE_RATE` env var |
| `ranking_profile` table versioning weights | debate #4 | A/B testable |
| Bounded reinforcement `LN(1+n)/LN(1+sat)` | debate #4 | no unbounded `sqrt` |
| `COALESCE(..., 0.0)` on every ranking term | debate #4 | NULL safety |
| Ranking SLO: p50 < 100ms, p99 < 500ms on 100K facts | debate #4 | forcing function for staging |
| `compost.ask` + `compost.query` share ranking contract | debate #4 | one formula, two call sites |
| Stage-1 → Stage-2 bridge via temp table | v2.1 | see §5.1 — no SQLite UDF, no array binding |

### 10.1 Daemon process supervision

`compost daemon` operates as a user-space long-running process managed via PID file + unix domain socket. Supervisors (launchd, systemd, runit) are OPTIONAL wrappers but the daemon's own CLI supports start/stop/status/reload without them.

**Files**:
- `~/.compost/daemon.pid` — PID file, written on startup, deleted on clean shutdown
- `~/.compost/daemon.sock` — unix domain socket for control commands (stop, reload, status)
- `~/.compost/logs/daemon-YYYY-MM-DD.log` — rotating daily log (pino JSONL)

**Startup idempotency**:
1. `compost daemon start` checks for `daemon.pid`
2. If PID file exists: read PID, `kill -0 <pid>` to test liveness
3. If process alive: print "already running (pid N)", exit 1 (non-zero so scripts can detect)
4. If PID file exists but process dead: delete stale PID file, proceed
5. Acquire PID file exclusively (`O_EXCL`), write own PID
6. Bind control socket at `daemon.sock` (remove any stale socket first)
7. Register SIGTERM/SIGINT handlers that: drain ingest_queue leases, close DB handles, delete PID file, unlink socket
8. Enter main loop

**`compost daemon stop`** sends `{"op":"stop"}` over `daemon.sock`, waits up to 30s for graceful shutdown, then SIGKILL fallback.

**`compost daemon status`** sends `{"op":"status"}` and prints `{pid, uptime_sec, outbox_drained_total, queue_depth, last_reflect_at, quarantined_outbox_count, quarantined_queue_count, degraded_flags: string[]}`.

**`degraded_flags`** is an array of currently-active degradation signals:
- `"python_extractor_unavailable"` — `uv` or `compost_ingest` module not found (§4.5 fatal)
- `"write_budget_exceeded"` — >1 write exceeding 50ms in the last minute (§10.3 writer budget guardrail)
- `"quarantine_backlog"` — quarantined outbox or queue rows > 0 awaiting operator action
- `"lance_lock_stale"` — LanceDB lockfile older than stale timeout (§10.3)

**`compost daemon reload`** sends `{"op":"reload"}` which re-reads `~/.compost/settings.json` and re-upserts the policies registry (useful after adding a new `tp-*` entry).

### 10.2 Ingest queue lease claim protocol

Concrete SQL for the lease columns introduced in migration 0002:

```sql
-- Claim one pending row. Returns the claimed row's id or nothing.
BEGIN IMMEDIATE;

UPDATE ingest_queue
SET lease_owner = :worker_id,          -- e.g. 'daemon@host-abc:pid1234'
    lease_token = :claim_uuid,          -- new UUID v7 per claim
    lease_expires_at = datetime('now', '+60 seconds'),
    attempts = attempts + 1
WHERE id = (
  SELECT id FROM ingest_queue
  WHERE completed_at IS NULL
    AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))
  ORDER BY priority ASC, enqueued_at ASC
  LIMIT 1
)
RETURNING id, observe_id, source_kind, attempts;

COMMIT;
-- If RETURNING gave a row, worker processes it.
-- If not, queue is empty or all rows are actively leased — sleep and retry.
```

**Heartbeat**: while processing, the worker extends the lease every 30s:
```sql
UPDATE ingest_queue
SET lease_expires_at = datetime('now', '+60 seconds')
WHERE id = :id AND lease_token = :claim_uuid;
-- If rowcount = 0, the lease was stolen (worker must abort).
```

**Completion**:
```sql
UPDATE ingest_queue
SET completed_at = datetime('now'),
    lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
WHERE id = :id AND lease_token = :claim_uuid;
```

**Failure**: worker updates `last_error`, clears the lease (so another worker can retry), and does NOT set `completed_at`. `attempts` increments on each claim. Poison pill (attempts > 5) is quarantined by a periodic `compost doctor --drain-retry` reaper.

### 10.3 LanceDB cross-process write lock

```typescript
import lockfile from 'proper-lockfile';

async function withLanceWrite<T>(
  ctx: CompostContext,
  fn: () => Promise<T>
): Promise<T> {
  const release = await lockfile.lock(`${ctx.dataDir}/lancedb.lock`, {
    stale: 60_000,              // consider lock stale after 60s
    retries: { retries: 10, minTimeout: 100, maxTimeout: 1000 },
    realpath: false,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}
```

ALL writes to LanceDB (insert chunks, update vector, delete rows, rebuild index) MUST go through `withLanceWrite`. Reads do NOT need the lock (LanceDB handles reader isolation internally). The daemon and any CLI writer (`compost add`, `compost doctor --rebuild`) compete for the same lockfile.

---

## 11. Phase 0 Definition of Done

### Functional

- [ ] `./scripts/install.sh` runs clean on a fresh macOS checkout (including hook cold-start measurement gate)
- [ ] `install.sh` applies `chmod 700` to `~/.compost/` and all subdirectories
- [ ] `compost daemon start` writes `~/.compost/daemon.pid`, binds `daemon.sock`, applies all migrations (0001-0004), upserts policies registry BEFORE opening MCP server
- [ ] `compost daemon start` is idempotent (second invocation detects stale PID or rejects live PID)
- [ ] `compost daemon stop` gracefully drains leases, closes DB handles, removes PID file and socket
- [ ] `compost daemon status` reports `{pid, uptime_sec, queue_depth, outbox_drained_total, last_reflect_at, degraded_flags}`
- [ ] **`compost hook session-start`** (and 4 others) reads stdin JSON, synchronously writes to `~/.compost/ledger.db.observe_outbox` with deterministic idempotency_key, returns exit 0 only after WAL commit
- [ ] `compost-daemon` drains `observe_outbox` via the canonical §1.6.2 single-DB transaction (source auto-register → INSERT OR IGNORE → enqueue → ack)
- [ ] **Outbox persistence across daemon restart** — kill daemon mid-send → restart daemon → outbox event appears in `observations` exactly once
- [ ] **Outbox persistence across hook retry** — run same hook payload twice → exactly one outbox row (idx_outbox_idempotency dedup) → exactly one `observations` row after drain (observations UNIQUE dedup)
- [ ] **Outbox poison pill quarantine** — 6 failed drain attempts on a malformed row → `drain_quarantined_at` set, row excluded from claims, `compost doctor --drain-retry` releases it
- [ ] `compost.observe` MCP notification path works for a non-Claude-Code test adapter (§3.1 SDK)
- [ ] `compost.query` (Phase 0 stub) returns `[]` with correct shape including `ranking_components: {}`, `final_score: 0`
- [ ] `compost add <markdown-file>` writes to L0 + enqueues + claims via lease SQL (§10.2) + runs Python extraction + stores chunks
- [ ] `compost doctor --reconcile` runs, reports `{L0_count, L1_count, delta, orphaned_policies: []}`
- [ ] **`compost doctor --rebuild L1 --policy tp-2026-04`** (Step 13b) — drops LanceDB rows, replays observations, asserts chunk-hash equivalence with pinned policy name
- [ ] **`compost doctor --measure-hook`** — follows §3b.5 methodology (n=100, trim 4%, report p50/p90/p95/p99); **fails install if p95 > 30ms on reference hardware**
- [ ] `compost reflect` executes §8.4 reflection: sensory hard-GC (with FK cascade verified), semantic soft-tombstone, outbox prune, returns `ReflectionReport` with `skippedDueToFkViolation = 0`
- [ ] `compost drain --adapter claude-code` manually drains one adapter outbox (diagnostic path)

### Non-functional / infrastructure

- [ ] `transform_policy` TypeScript registry compiles and upserts to `policies` SQL table at daemon startup, BEFORE any writer connects
- [ ] `is_noteworthy()` passes its 6 fixture test cases
- [ ] Python `compost_ingest extract` passes schema contract test against 3+ markdown fixtures (§4.4)
- [ ] Python subprocess failure handling (§4.5): timeout, non-zero exit, malformed JSON, schema violation, OOM — each case has a test
- [ ] `uv.lock` committed; `bun.lockb` committed
- [ ] `ranking_profile` table seeded with `rp-phase1-default` (w1=1.2, others=0.0) on first daemon startup
- [ ] `ranking_audit_log` table exists; writes gated by `COMPOST_RANKING_SAMPLE_RATE` env var
- [ ] `proper-lockfile` integrated: LanceDB write lock at `~/.compost/lancedb.lock`, reflect lock at `~/.compost/reflect.lock`
- [ ] FK CASCADE verified: sensory GC test inserts observation → fact → ingest_queue row, runs reflect, asserts all three rows gone with no error
- [ ] `docs/coverage-slo.md` exists and contains no occurrence of "complete" as a guarantee
- [ ] `docs/transform-policy.md` documents the versioning rule (see §2)
- [ ] `docs/portability.md` documents the local-disk-only constraint
- [ ] `docs/cognitive-model.md` documents the 5-tier cognitive ↔ L-layer mapping from §8.1
- [ ] `docs/compost-v2-spec.md` (this file) is the canonical spec; `phase0-spec.md` has superseded banner

### Crash-recovery test matrix (v2.1)

All six scenarios must pass. Each is a single-process test that kills the daemon or writer mid-operation and verifies eventual consistency.

- [ ] **Crash during hook sync-append**: kill hook shim with SIGKILL between INSERT and commit → outbox row absent (nothing to recover) → Claude Code retries → new idempotency_key match deduplicates via `idx_outbox_idempotency`
- [ ] **Crash during daemon drain step 2 (observations insert)**: next drain runs INSERT OR IGNORE, still works
- [ ] **Crash during daemon drain step 4 (queue enqueue)**: next drain sees outbox row with `drained_at IS NULL`, re-runs steps 2-5, `ingest_queue` duplicate-protected by pre-check
- [ ] **Crash during daemon drain step 5 (outbox ack)**: outbox row still pending but `observations` has the row → next drain step 2 IGNORE, step 3 returns existing observe_id, step 4 checks queue (exists), step 5 ack
- [ ] **Crash during reflect sensory GC**: transaction rolls back, no partial delete, next reflect retries
- [ ] **Crash during ingest queue extraction**: lease expires after 60s, another worker claims, `attempts` increments, idempotent on retry

### Explicitly NOT in Phase 0

- w2-w7 ranking factors (Phase 2-4)
- Embedding + BM25 in LanceDB (Phase 1)
- Real `compost.query` results (Phase 1)
- Fact extraction beyond Phase 0 fixtures (Phase 1)
- `memory_episodic` table materialization (Phase 3)
- `memory_procedural` table (Phase 4)
- L3 wiki synthesis (Phase 2)
- `compost.ask` implementation (Phase 2)
- `compost.feedback` CLI + MCP tool (Phase 1)
- Active learning / curiosity agent / gap tracker (Phase 4)
- Cross-machine sync / export / import (Phase 5)
- Native Go/Rust hook binary (Phase 1 if cold-start gate fails)
- Contradiction arbitration in `compost reflect` full loop (Phase 3)

---

## 12. Phase roadmap — by cognitive capability

| Phase | Cognitive capability | Major deliverables |
|---|---|---|
| **Phase 0** (~2 weeks) | Encoding + Storage | L0 ledger, derivation_run, policies, context entity, hook contract, sensory hard-GC stub, ranking API shape, Step 13b rebuild test |
| **Phase 1** (week 3) | Semantic retrieval | LanceDB embeddings, BM25, fact extraction → `facts`, w1 semantic ranking, real `compost.query` results, `ranking_audit_log` active |
| **Phase 2** (week 4-5) | Temporal + wiki | w2 temporal decay, L3 wiki synthesis, `compost.ask`, web URL source with freshness loop, `decay_floor` + `decay_function` pluggability |
| **Phase 3** (week 6-8) | Consolidation + reflection | Episodic link table materialization, w3 + w4 ranking factors, contradiction arbitration, `compost reflect` full loop, wiki rebuild |
| **Phase 4** (week 9-12) | Active learning | Curiosity agent, gap tracker, SearchPlan generator, w5-w7 ranking factors, autonomous crawl with semantic novelty gate, procedural memory |
| **Phase 5** (later) | Shareability | Cross-machine sync protocol, HTTP transport, multi-host concurrency, `compost export` / `compost import`, L3 file reconcile path |

### Phase mapping to the 7 brain-like requirements

| User requirement | Delivered in |
|---|---|
| 1. Probabilistic ranking (not deterministic RAG) | Phase 1 API shape + Phase 2 temporal + Phase 3 reinforcement |
| 2. Multi-context search with weights | Phase 0 `context` + `fact_context` schema + Phase 2 `w7_context_mismatch` |
| 3. Long-term weighted recall | Phase 0 `importance` + `half_life_seconds` + Phase 3 reinforcement |
| 4. Auto-iterative learning / evolution | Phase 3 `compost reflect` full loop + Phase 4 curiosity agent |
| 5. Active search-learning | Phase 4 SearchPlan + autonomous crawl |
| 6. Experience formation (success/failure) | Phase 3 episodic link table + Phase 4 procedural with success/failure counts |
| 7. Passive feeding | Phase 0 `compost add` + Phase 0 hook contract + Phase 2 web URL |

Phase 0 delivers the schema infrastructure for all seven requirements. The actual cognitive behaviors are layered across Phase 1-4.

---

## 13. Decision lineage

This spec is the merge of 6 debates. For detailed rationale on any decision, consult:

- `docs/debate/synthesis.md` — original architecture (L0-L4, stdio MCP + outbox, hybrid runtime, `is_noteworthy`, Auditable Coverage)
- `docs/debate2/synthesis.md` — D3 hybrid lock-in, `transform_policy` convention
- `docs/debate3/synthesis.md` — `derivation_run` PK fix, `policies` table, context entity, queue lease, Step 13b rebuild test
- `docs/debate4/synthesis.md` — stateless decay, probabilistic ranking, vertical partitioning, hook contract, link-not-duplicate episodic
- `docs/debate5/rounds/` — fresh-eyes spec review (R1: 3 reviewers, R2: 3 reviewers + Opus); results fed v2.1 and v2.2 fix passes
- `docs/debate6/rounds/` — outbox architecture binary decision (per-adapter files vs merged ledger.db); 3B/1A → Option B merged

Every SQL table, column, and API field in this spec traces to a specific decision in one of those sources. When updating this spec, reference the originating debate and add a v2.x entry to the "What changed" section at the top.

---

## 14. Open questions (tracked for Phase 2+)

Questions that surfaced in debates but were explicitly deferred past Phase 0:

1. **Cross-machine ledger sync protocol** — debate #3 noted that `content_hash` generated column enables future sync via `INSERT OR IGNORE`, but no sync engine is specified. Phase 5.
2. **Context hierarchy** (`parent_id` on `context` table) — debate #3 deferred; `context.id` is hierarchical-path-safe to enable Phase 2 backfill.
3. **Orphaned contexts on re-derivation** — debate #3 Gemini flagged: if `fact_context.freshness` marks a fact stale in context A and triggers re-derivation producing `fact_id'`, context B's subscription stays on old fact. Resolve via `superseded_by` chain walk at query time. Phase 2+.
4. **Ranking auto-tuning from `result_selected`** — feedback-driven weight adjustment. Requires enough query history (Phase 3+).
5. **Multi-agent concurrency beyond single-machine** — HTTP transport, shared storage service. Phase 5.
6. **`compost.ask` LLM provider selection** — Phase 2.
7. **Gap detection from query failure signals** — Phase 4 curiosity agent input.
8. **Quarantine resolution workflow** (v2.1 new) — `compost doctor --quarantine-purge` and `compost doctor --drain-retry` exist, but the operator UX for inspecting a quarantined row and deciding "fix extractor vs. drop this event" is not specified. Phase 1 when real extraction starts producing poison pills.
9. **Observability / metrics export** (v2.1 new) — `compost daemon status` reports minimal counters. Prometheus/OpenTelemetry export is Phase 3+.

---

**End of compost-v2-spec.md**
