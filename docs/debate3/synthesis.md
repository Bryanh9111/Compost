# Final Synthesis — Debate #3: Phase 0 Architecture Future-Fitness

**Debate**: does the Phase 0 architecture (`phase0-spec.md` + `phase0-checklist.md`) actually create the foundation for a brain-like memory bank that self-evolves, absorbs external knowledge, switches contexts like a human switching physical environments, is shareable across multiple agents concurrently, and is simply portable across machines?

**Participants**: 🔴 Codex, 🟡 Gemini, 🟠 Sonnet, 🐙 Claude Opus
**Rounds**: 3 (initial → cross-critique → final positions)
**Mode**: cross-critique
**Priority**: future extensibility of the architecture, not development tactics

---

## Position tracking across 3 rounds

### Axis scores (0=blocking, 3=solid)

| | Gemini | Sonnet | Codex | Opus | **Consensus** |
|---|---|---|---|---|---|
| **Axis 1** Self-evolution | 2→1→1 | 1→1→1 | 1→1→1 | 1→1→1 | **1** |
| **Axis 2** External absorption | 3→2→2 | 2→2→2 | 2→2→2 | 2→2→2 | **2** |
| **Axis 3** Multi-context switching | 1→0→3* | 0→0→0 | 1→1→1 | 0→0→1 | **1** (post-fix) |
| **Axis 4** Cross-agent shareability | 1→1→1 | 1→1→1 | 1→1→1 | 1→1→1 | **1** |
| **Axis 5** Cross-machine portability | 0→0→2* | 1→1→1 | 0→0→0 | 0→0→1 | **1** (post-fix) |
| **Axis 6** Dependency graph | 3→3→3 | 2→1→1 | 1→1→1 | 1→1→1 | **1** (rises to 2 with Step 13b) |

*Gemini's higher scores are conditional on hierarchy + deterministic hash + policies-as-ledger-data being adopted. Opus/Sonnet/Codex do not grant those conditions.

### The unanimous convergences

Every participant, across all three rounds, agreed on five findings:

1. **`derivations` PK bug is real.** `(observe_id, layer, model_id)` cannot represent two rows differing only in `transform_policy`. Policy-only revisions (chunk overlap change, prompt version bump) collide. The entire rebuild story depends on fixing this. Credit: Codex R1.

2. **Phase 0 has no L0→L1 rebuild verification test.** The spec's "L0 is the anchor, L1-L3 are disposable views" premise is unverified. Credit: Opus R1. Concrete test form specified by Codex R2 + Sonnet R2.

3. **`contexts TEXT[]` as JSON column is inadequate.** No context entity table, no per-context freshness, no SLO surface. Credit: independently raised by Gemini R1, Sonnet R1, Codex R1 — the strongest convergence signal of the debate.

4. **`ingest_queue` needs lease columns.** No owner/lease token means two workers can claim the same row. Credit: Codex R1 (naming) → Sonnet R2 (CI concurrency case) → Codex R2 (concrete SQL DDL).

5. **`wiki_pages.contributing_observes` JSON array breaks L3 freshness at scale.** Full table scans with no index path. Credit: Sonnet R1.

---

## Resolution of the 5 contested questions (Q1-Q5)

Debate #3 Round 3 closed the five questions that remained open after cross-critique:

### Q1. Context hierarchy: Phase 0 or Phase 2?
**Resolution: defer to Phase 2** (2-1, Sonnet + Codex + Opus vs Gemini)

Sonnet's R2 objection is decisive: freshness propagation across `parent_id` hierarchy requires either O(facts × depth) cascade writes or unindexed recursive CTE reads, and the propagation semantics are unspecified. You cannot ship correctness you have not defined.

**Concession to Gemini**: `context.id` is designed as hierarchical-path-safe from day one (`"work"`, `"work/project-zylo"`) so the Phase 2 `parent_id` migration is a backfill, not a rename.

### Q2. derivation_run PK: UUID or deterministic hash?
**Resolution: Sonnet's compromise** (UUID PK + STORED `content_hash` generated column + unique index)

Gemini is directionally correct — cross-machine convergence needs deterministic identity. Sonnet's bridge provides the convergence identity today (two machines deriving the same inputs collide on `content_hash` unique index) without forcing Phase 0 to implement a sync/merge protocol. When sync ships, the merge path is `INSERT OR IGNORE` on `content_hash`, not on the UUID.

### Q3. transform_policy: TypeScript code or SQL ledger data?
**Resolution: Sonnet's bridge** (SQL `policies` table in Phase 0, populated by TypeScript registry upsert at startup)

Ships as a table from Phase 0 so cross-machine rebuild can read policy definitions without TypeScript source parity (Gemini's R1 concern), while preserving TypeScript as the authoring source (Codex's R3 position). Full ledger-sync of policy rows is Phase 2.

### Q4. Context-dependence of extraction
**Resolution: Codex R2 correction** (context lives in `derivation_run` inputs, not observation keys or extractor input schema)

Codex's argument is decisive: if context is in observation identity, the same Slack message captured in work+personal becomes two L0 rows and portability gets worse. Context is a *perception* layer (subjective), not an *observation* layer (objective). The extractor CLI contract receives `context_scope_id` and optional `extraction_profile` as derivation inputs, producing different L1/L2 runs from the same L0 anchor.

Opus (me) was wrong in R1. I formally concede.

### Q5. Migration order of the schema diffs
**Resolution: Sonnet's 5-step sequence**

1. `derivation_run` replaces `derivations` (unblocks Codex R1 bug fix immediately)
2. `policies` table + TypeScript registry upsert-on-startup
3. `context` entity + `fact_context` join (with per-context freshness)
4. `wiki_page_observe` join (replaces `contributing_observes` JSON)
5. `ingest_queue` lease columns

Rejected Gemini's "atomic" framing: these are additive migrations with no circular dependencies. Shipping them sequentially lets Step 1 unblock the rebuild story before the rest land.

---

## Required Phase 0 schema diff (unanimous minimum)

Merged from Codex R3 + Sonnet R3 + Opus R3. All four participants must approve this diff before ship.

```sql
-- ─────────────────────────────────────────────────────────────
-- Migration 0002_debate3_fixes.sql (applied after 0001_init.sql)
-- ─────────────────────────────────────────────────────────────

-- (1) Replace `derivations` with `derivation_run`
DROP TABLE IF EXISTS derivations;  -- Phase 0 only, never shipped

CREATE TABLE derivation_run (
  derivation_id TEXT PRIMARY KEY,                 -- uuid v7
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  context_scope_id TEXT,                          -- null = context-neutral derivation
  extraction_profile TEXT,                        -- null = default profile
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','superseded')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  artifact_ref TEXT,
  supersedes_derivation_id TEXT REFERENCES derivation_run(derivation_id),
  error TEXT,
  -- Cross-machine convergence identity (Gemini's concern, Sonnet's bridge)
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
  ON derivation_run(content_hash)
  WHERE status = 'succeeded';

-- (2) transform_policy as ledger-resident data
CREATE TABLE policies (
  policy_id TEXT PRIMARY KEY,                     -- e.g. 'tp-2026-04'
  supersedes TEXT REFERENCES policies(policy_id),
  effective_from TEXT NOT NULL,
  definition_json TEXT NOT NULL,                  -- full policy object as JSON
  migration_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- TypeScript registry upserts this table at daemon startup.

-- (3) Context as first-class entity (flat, no parent_id)
CREATE TABLE context (
  id TEXT PRIMARY KEY,                            -- hierarchical-path-safe: 'work', 'work/project-zylo'
  display_name TEXT NOT NULL,
  isolation_level TEXT NOT NULL DEFAULT 'shared'
    CHECK(isolation_level IN ('shared','isolated')),
  trust_floor TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_floor IN ('user','first_party','web')),
  freshness_ttl_sec INTEGER,                      -- NULL = inherit global default
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- Remove `contexts TEXT` from facts, source, wiki_pages; replace with join tables:
CREATE TABLE fact_context (
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  freshness TEXT NOT NULL DEFAULT 'fresh'
    CHECK(freshness IN ('fresh','stale','expired')),
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fact_id, context_id)
);
CREATE INDEX idx_fc_context ON fact_context(context_id);

CREATE TABLE source_context (
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, context_id)
);

-- (4) wiki_page_observe replaces contributing_observes JSON
CREATE TABLE wiki_page_observe (
  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_path, observe_id)
);
CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);
-- Remove wiki_pages.contributing_observes column (migration recreates wiki_pages)

-- (5) ingest_queue lease columns
ALTER TABLE ingest_queue ADD COLUMN lease_owner TEXT;          -- e.g. 'laptop-7f3c:daemon:pid1234'
ALTER TABLE ingest_queue ADD COLUMN lease_token TEXT;          -- UUID per claim attempt
ALTER TABLE ingest_queue ADD COLUMN lease_expires_at TEXT;     -- short TTL, heartbeat-renewed
CREATE INDEX idx_queue_claim
  ON ingest_queue(priority, enqueued_at, lease_expires_at)
  WHERE completed_at IS NULL;
CREATE UNIQUE INDEX idx_queue_active_lease
  ON ingest_queue(lease_token)
  WHERE completed_at IS NULL AND lease_token IS NOT NULL;
```

Claim SQL for the lease:
```sql
UPDATE ingest_queue
SET lease_owner = ?, lease_token = ?, lease_expires_at = datetime('now', '+60 seconds')
WHERE id = ?
  AND completed_at IS NULL
  AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))
RETURNING id;
-- caller asserts changes()=1 before processing
```

---

## Required Phase 0 test additions (unanimous minimum)

### Step 13b — L0→L1 rebuild verification

Added to `docs/phase0-checklist.md` after Step 13 (ingest pipeline). Concrete form from Codex R2 + Sonnet R2:

1. Seed 3 deterministic observations from committed fixtures
2. Run extraction under fixed `transform_policy = 'tp-2026-04'`
3. Snapshot ordered tuples `(observe_id, chunk_id, chunk_hash, token_count)` for L1
4. Delete LanceDB rows for those observe_ids; mark corresponding `derivation_run` rows `status='superseded'`
5. Invoke `compost doctor --rebuild L1 --policy tp-2026-04` (the `--policy` pin is Sonnet's critical refinement — without it, rebuild auto-selecting a newer policy makes the assertion trivially pass)
6. Assert rebuilt rows match the snapshot exactly by chunk hash
7. **Negative test**: rerun under `tp-2026-05` (synthetic), assert both old and new `derivation_run` rows coexist with `status='succeeded'`, and exactly one is active per `(observe_id, layer)` via the partial unique index

Cost: ~40 lines of test code. Blocks ship without it. This is the only hard blocker unanimous across all four participants.

---

## Python extractor contract addition (Q4 resolution)

The §4.2 input schema gains two optional fields:

```json
{
  "observe_id": "018f3c...",
  "source_uri": "...",
  "mime_type": "text/markdown",
  "content_ref": "inline",
  "content": "...",
  "transform_policy": "tp-2026-04",
  "context_scope_id": "work",              // NEW: optional, null = context-neutral
  "extraction_profile": "default"          // NEW: optional, null = policy default
}
```

The `extractor_version` in output must preserve both fields for replay. Phase 0 extractors MAY ignore them (context-neutral derivation is valid). Phase 2+ can use them to vary chunk_size, prompt selection, or confidence thresholds per context.

**Idempotency**: `observations.(adapter, source_id, idempotency_key)` UNIQUE constraint stays context-blind. Same Slack message captured in two contexts = ONE observation row, TWO derivation_run rows, TWO L1 artifact sets.

---

## Summary of perspectives

### 🟡 Gemini — Ecosystem & Strategic

Strongest contribution: forced the group to confront cross-machine identity (`content_hash` convergence), `transform_policy` as ledger data (not TypeScript code), and the strategic observation that Phase 0 is building a "local-only silo" unless these are addressed. Lost Q1 (hierarchy) and Q4 (extractor context) but got the essential concerns baked in through Sonnet's bridge compromises. The "strategic dead end" framing sharpened everyone else's thinking even when Gemini's specific fixes were rejected as over-engineering for Phase 0.

Gemini also raised a concern that was registered but NOT resolved: Opus's claim that the three R1 schema proposals are "additive, not competing." Gemini argued they are fatal conflicts (mutable per-context freshness + immutable derivations produce orphaned contexts). The resolution in Q4 (Codex's context-in-derivation correction) partially answers this: if re-derivation produces a new `fact_id` with its own `fact_context` rows, old context subscriptions stay on old facts and new context subscriptions get new facts. The orphaning is still real for the cross-context sharing case, but it becomes a product-decision problem (what does "promote derivation X from work context into personal context" mean?) rather than a schema bug. Flagged as Phase 2 open question.

### 🔴 Codex — Technical Implementation

Strongest contribution: the R1 `derivations` PK bug find — the single most important technical discovery of the debate. Both prior debates (debate #1 synthesis and debate #2 synthesis) endorsed a schema that was subtly broken, and Codex proved it wrong by walking through a concrete failure case (`tp-2026-04-02` chunk overlap change without model swap). Also contributed R2 corrections: context belongs in derivation not observation, the concrete queue lease DDL, migration order. Accepted Sonnet's compromises on PK and policies in R3.

### 🟠 Sonnet — Pragmatic Implementer

Strongest contribution: the unifying compromises in R2/R3. Where Gemini and Codex pulled in different strategic directions, Sonnet found the bridges: (a) UUID PK + generated content_hash column, (b) SQL policies table populated via TypeScript upsert, (c) flat context now with hierarchical-path-safe IDs for Phase 2 backfill. Also the two most grounded risk finds: `wiki_pages.contributing_observes` JSON as a scaling cliff, and the observation that Step 13b rebuild test must pin policy name explicitly (otherwise rebuild auto-selecting newer policy makes assertion trivially pass). Conceded fully to Codex R1 on the derivations bug.

### 🐙 Claude Opus — Moderator + Participant

Strongest contribution: Risk A (Phase 0 has no rebuild verification test), which became the single unanimous blocker across all four participants. Also forced the moderator reframe that the three R1 schema proposals were additive in the "all three ship together" sense even though Gemini correctly flagged conceptual tensions. Conceded R1 Risk B (context in extractor input) to Codex's R2 correction (context in derivation inputs). Decided Q1-Q5 in R3 as moderator.

---

## Phase 0 Go/No-Go

**GO with the binding schema diff and Step 13b test.**

But the user should go in with eyes open:

- Phase 0 delivers the **metadata infrastructure** for a brain-like memory (L0 ledger with raw_bytes, `derivation_run` with policy-aware replay, per-context freshness, cross-machine convergence identity via `content_hash`).
- Phase 0 does **not** deliver the brain itself. The evolution loop (`reflect()`) is a Phase 3 stub. Cross-machine sync is Phase 2+. Context hierarchy is Phase 2. Multi-host concurrency requires either a shared storage service or HTTP transport, neither of which is in Phase 0.
- **Final axis consensus: 1, 2, 1, 1, 1, 1 (out of 3).** The foundation is sound. Calling it a brain today is aspirational. The schema lets you get there from here without a migration hazard.

---

## Decisions Closed

| Decision | Status |
|---|---|
| Replace `derivations` with `derivation_run` (Codex R1 bug fix) | ✅ Ship Phase 0 |
| `derivation_run` PK = UUID + `content_hash` generated column + unique index | ✅ Ship Phase 0 (Sonnet bridge) |
| SQL `policies` table, populated by TypeScript registry upsert at startup | ✅ Ship Phase 0 (Sonnet bridge) |
| `context` entity table, flat (no `parent_id`), IDs hierarchical-path-safe | ✅ Ship Phase 0 |
| `fact_context` + `source_context` join tables with per-context freshness | ✅ Ship Phase 0 |
| `wiki_page_observe` normalized join (remove `contributing_observes` JSON) | ✅ Ship Phase 0 |
| `ingest_queue` lease columns (owner + token + expires_at) + claim SQL | ✅ Ship Phase 0 |
| Python extractor §4.2 gains optional `context_scope_id` + `extraction_profile` | ✅ Ship Phase 0 |
| `compost doctor --rebuild L1 --policy tp-YYYY-MM` command | ✅ Ship Phase 0 |
| Step 13b rebuild verification test (40 lines) | ✅ Ship Phase 0 — unanimous blocker |
| Context `parent_id` hierarchy | ⏸ Phase 2 |
| Cross-machine ledger sync protocol | ⏸ Phase 2+ |
| Full `transform_policy` ledger-sync (not just upsert) | ⏸ Phase 2 |
| Derivation merge semantics (orphaned contexts on re-derivation) | ⏸ Phase 2 product decision |
| HTTP transport for multi-client shareability | ⏸ Phase 2+ |
| Evolution loop (`reflect()` actually runs) | ⏸ Phase 3 |

---

## Required updates to working documents

### `phase0-spec.md` edits

- **§1.3**: replace the `derivations` table definition with `derivation_run` per this synthesis
- **§1.6**: remove `contexts TEXT` from `facts`; add reference to `fact_context` join
- **§1.1**: remove `contexts TEXT` from `source`; add reference to `source_context` join
- **§1.7**: remove `contributing_observes TEXT` from `wiki_pages`; add reference to `wiki_page_observe` join
- **§1**: add `policies`, `context`, `fact_context`, `source_context`, `wiki_page_observe` tables
- **§1.4**: add `lease_owner`, `lease_token`, `lease_expires_at` columns and claim SQL semantics
- **§4.2**: add optional `context_scope_id` + `extraction_profile` to the input schema
- **§5**: update `Compost` interface and `QueryOptions` to surface contexts as a proper entity

### `phase0-checklist.md` edits

- **Step 3** (L0 schema): now ships `0001_init.sql` + `0002_debate3_fixes.sql`. Migration test parameterized over both.
- **Step 4** (policies): now creates BOTH the TypeScript registry AND the upsert-on-startup path that writes to the SQL `policies` table
- **NEW Step 13b** (rebuild verification): seed → snapshot → drop → rebuild → assert, with the negative test under a synthetic `tp-2026-05`
- **Step 18** (doctor): adds `compost doctor --rebuild L1 --policy <tp-id>` subcommand; unchanged reconcile-only path stays
- **Step 0** clarifications: LanceDB write decision (null vectors vs non-write) shifts — derivation_run rows lifecycle now tracks L1 status explicitly, so the checklist's "LanceDB writes null-vector placeholder" becomes "derivation_run.status='succeeded' with artifact_ref pointing at LanceDB row that carries null vector"

---

## Phase 0 estimated scope (unchanged)

Still approximately 1 week solo. The debate #3 diff adds maybe 1 extra day:

- 0002 migration: ~2 hours
- policies upsert-on-startup: ~1 hour
- derivation_run status lifecycle + content_hash: ~3 hours
- fact_context / source_context / wiki_page_observe: ~3 hours
- ingest_queue lease columns + claim SQL + test: ~3 hours
- Step 13b rebuild test: ~2 hours

Total: ~14 hours. Checklist fits in a 1-week solo sprint with this diff applied.
