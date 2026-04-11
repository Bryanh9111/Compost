# Final Synthesis — Debate #4: Compost v2 Architecture Stress Test

**Debate**: do the four proposed architectural shifts (stateless decay, probabilistic ranking, 5-tier one-table, hook contract replacing MCP notifications) survive stress testing in Compost's specific context?

**Participants**: 🔴 Codex, 🟡 Gemini, 🟠 Sonnet, 🐙 Claude Opus
**Rounds**: 3 (no R4 needed — both open questions closed in R3)
**Mode**: cross-critique, independent per-decision scoring
**Output target**: `docs/compost-v2-spec.md` replacing `phase0-spec.md`
**Started**: 2026-04-11

---

## Executive summary

All four decisions reach 2/3 or 3/3 consensus after R3. Two had framing confusion in R1 that was resolved in R2 (C and D). Two open questions survived into R3 and both closed:

- **Q1 (semantic-vs-episodic boundary)** — closed with Opus's R3 "link-not-duplicate" compromise
- **Q2 (sync outbox append vs async-true)** — closed with Opus conceding to Codex's position (3-1 then 4-0)

The final architectural direction is clear enough to author `compost-v2-spec.md` directly from this synthesis.

---

## Final score matrix

| Decision | Gemini R1→R3 | Sonnet R1→R3 | Codex R1→R3 | Opus R1→R3 |
|---|---|---|---|---|
| **A** (stateless decay) | 3→3→3 | 2→2→2 | 2→2→2 | 2→2 |
| **B** (multi-factor ranking) | 2→2→2 | 1→2→2 | 2→2→2 | 2→2 |
| **C** (physical layout) | 3→2→2 | 1→2→2 | 1→2→3* | 2→2 |
| **D** (hook contract) | 3→3→3 | 2→2→2 | 1→2→3* | 2→2 |

*Codex moved C from 1→2→3 on reframing to vertical partitioning + Q1 closed, and D from 1→2→3 on reframing + Q2 closed with sync-append.

**Adoption status**: all four decisions accepted with specific refinements. No "rejected" column.

---

## Decision A — Stateless query-time decay: ADOPTED

### Required refinements (unanimous)

1. **Request-scoped `as_of_unix_sec` bind parameter** — NOT inline `strftime('%s','now')`. Pagination and cursor stability demand a fixed clock per request. (Codex)

2. **Explicit `last_reinforced_at_unix_sec` column on `facts`** — do NOT overload `created_at`. Decay anchor is ranking state; creation time is rebuild identity. Keeping them separate means ranking state can change without contaminating the derivation identity locked in debate #3. (Codex)

3. **`half_life_seconds` per-fact column, set by transform_policy** — different content types decay at different rates. Technical facts have multi-year half-lives; episodic observations have week-scale half-lives. Must be immutable per-fact after insertion so decay is reproducible from the derivation record. (Sonnet)

4. **Batched append-only `access_log` table, NO inline writes on retrieval** — retrieval reinforcement is telemetry, not durability. Fire-and-forget appends; aggregated in the decay query via GROUP BY. Inline writes on `facts` would turn every read into a write under SQLite WAL and cause hot-row contention. (Sonnet + Codex)

5. **Sensory-tier hard-GC via `compost reflect`** — stateless decay is a ranking trick, not forgetting. Sensory-tier observations (`adapter = 'sensory' OR kind = 'sensory'`) are hard-deleted after 7-day TTL. Episodic/semantic/procedural use soft-tombstone via `archived_at`. Procedural never forgets. (Opus, endorsed by all)

### Schema change

```sql
-- Migration 0003_stateless_decay.sql

ALTER TABLE facts ADD COLUMN half_life_seconds INTEGER NOT NULL DEFAULT 2592000;  -- 30 days
ALTER TABLE facts ADD COLUMN last_reinforced_at_unix_sec INTEGER NOT NULL DEFAULT (unixepoch());

CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  accessed_at_unix_sec INTEGER NOT NULL DEFAULT (unixepoch()),
  query_id TEXT
);
CREATE INDEX idx_access_log_fact ON access_log(fact_id);

-- Example decay-aware query:
-- Note: :as_of_unix_sec is a REQUIRED bind parameter, never inlined
SELECT f.*,
  f.importance * POW(0.5,
    (:as_of_unix_sec - f.last_reinforced_at_unix_sec) * 1.0 / f.half_life_seconds
  ) AS decayed_score,
  (SELECT COUNT(*) FROM access_log a WHERE a.fact_id = f.fact_id) AS access_count
FROM facts f
WHERE f.archived_at IS NULL
ORDER BY decayed_score DESC;
```

### Active forgetting (`compost reflect`)

```typescript
// packages/compost-daemon/src/scheduler.ts
async function reflect(ctx: CompostContext): Promise<ReflectionReport> {
  // Phase 0 scope:
  // 1. Hard-GC sensory tier
  await db.run(`
    DELETE FROM observations
    WHERE captured_at < datetime('now', '-7 days')
      AND adapter IN (SELECT adapter FROM source WHERE kind = 'sensory')
  `);

  // 2. Soft-tombstone semantic facts below decay threshold
  await db.run(`
    UPDATE facts SET archived_at = datetime('now')
    WHERE archived_at IS NULL
      AND importance * POW(0.5, (unixepoch() - last_reinforced_at_unix_sec) * 1.0 / half_life_seconds) < 0.001
      AND fact_id NOT IN (SELECT fact_id FROM facts WHERE importance_pinned = 1)
  `);

  // Phase 2+: decay_floor + decay_function pluggability, contradiction arbitration, etc.
}
```

### Phase 2 additions (deferred)

- `decay_floor REAL` column for pinnable memories (Gemini)
- `decay_function` plugin for custom per-context curves (Gemini)
- `ignore_decay: boolean` query flag for archival recall (Sonnet's correction of Gemini's decay_floor-at-ingestion)

---

## Decision B — Probabilistic multi-factor ranking: ADOPTED WITH STAGING

### Staging consensus

| Phase | Active factors | Formula |
|---|---|---|
| **Phase 1** | w1 only | `rank = semantic_similarity` |
| **Phase 2** | w1 + w2 | `rank = 1.2*semantic + 0.2*temporal_decay` |
| **Phase 3** | w1 + w2 + w3 + w4 | `+ LN(1 + access_count) / LN(1 + 100) + 0.1*importance` |
| **Phase 4** | all seven | `+ 0.08*emotional_intensity - 0.05*repetition_penalty - 0.1*context_mismatch` |

Factor disablement is mandatory if any phase cannot meet the p50 < 100ms / p99 < 500ms SLO on a 100K-fact database. This is the forcing function against premature complexity.

### Required refinements

1. **`QueryHit.ranking_components: Record<string, number>` locked from Phase 0** — API contract commits to exposing per-factor scores even when only w1 is active. Third-party agents can build rerankers on top. Phase 1 returns only `{w1_semantic: 0.87}`; Phase 4 returns all seven. (Gemini)

2. **`ranking_audit_log` table from Phase 1** — even when only w1 is active, log every query hit with factor breakdown + `result_selected: boolean` for calibration telemetry. Without this signal, Phase 2 weight calibration has no ground truth. (Sonnet's R2 calibration deadlock point)

3. **`ranking_profile` SQL table versioning weights** — weight changes are first-class data, not code edits. Enables A/B testing and replay. (Codex)

4. **Bounded reinforcement via saturation** — replace unbounded `sqrt(access_count)` with `LN(1 + access_count) / LN(1 + access_sat)` capped at 1.0. Prevents a 10K-access row from contributing 100 units while other factors contribute 1. (Codex)

5. **`COALESCE(..., 0.0)` on every term** — NULL safety. One missing column must not null the whole expression. (Codex)

6. **Single ranking contract across `compost.query` and `compost.ask`** — `compost.ask` must carry `ranking_profile_id` and `as_of_unix_sec` through its page selection. Same formula, different call sites. No two surfaces producing contradictory recall. (Sonnet + Codex)

### Schema change

```sql
-- Migration 0004_probabilistic_ranking.sql

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

-- Seed with Phase 1 default:
INSERT INTO ranking_profile (profile_id, name, w1_semantic)
VALUES ('rp-phase1-default', 'Phase 1 semantic only', 1.2);

CREATE TABLE ranking_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES ranking_profile(profile_id),
  fact_id TEXT NOT NULL REFERENCES facts(fact_id),
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
-- Gated by COMPOST_RANKING_DEBUG=1 or sampled at 1% in production.
```

```typescript
// packages/compost-core/src/api.ts
export interface QueryHit {
  fact: { subject: string; predicate: string; object: string };
  confidence: number;
  provenance: { ... };
  contexts: string[];
  ranking_components: Record<string, number>;  // { w1_semantic: 0.87, w2_temporal: 0.45, ... }
  final_score: number;
}
```

---

## Decision C — Physical memory layout: ADOPTED AS VERTICAL PARTITIONING + LINK-NOT-DUPLICATE EPISODIC

### The converged design (Opus R1 reframe confirmed by all participants in R2)

Reject the strawman "one sparse table with 7-tier kind enum". Reject also "5 fully independent tables with no shared identity". Converged design:

1. **`facts` table** (from debate #3) is the **semantic tier base**. Every extracted claim lands here. Semantic search via `compost.query` reads from `facts`.

2. **`memory_episodic` table** (Phase 3+) is an **additive link** from facts to episodic metadata. It does NOT duplicate the fact content. A fact that qualifies as an event gets both a `facts` row AND a `memory_episodic` row, linked by `fact_id`. (Opus R3 compromise resolving Q1)

3. **`memory_procedural` table** (Phase 4+) is separate with its own schema (preconditions, success_count, etc.). Linked to `facts` via `fact_id` if the procedure is derived from a claim, or standalone if purely synthesized.

4. **`memory_blobs`** (Phase 2+) is a vertical partition holding LanceDB vector IDs keyed by `fact_id`. Separates hot metadata rows from cold vector data to prevent page churn (Codex's "shared page churn" + Gemini's "Storage Class Collision").

5. **Unified query surface via views**:
```sql
CREATE VIEW memory_surface AS
  SELECT f.fact_id AS id, 'semantic' AS kind, f.subject || ' ' || f.predicate || ' ' || f.object AS content,
         f.created_at, f.last_reinforced_at_unix_sec, f.half_life_seconds
  FROM facts f
  WHERE f.archived_at IS NULL;
```

The view does NOT UNION episodic records because they link to facts, not duplicate them. Semantic search is `SELECT * FROM memory_surface`. Episodic queries (Phase 3) are `SELECT * FROM memory_episodic JOIN facts USING(fact_id)`.

### Q1 resolution — link-not-duplicate

The Opus R1 "single-emit-with-promotion" rule is replaced by:

**Rule**: every extracted claim ALWAYS writes one `facts` row. When the claim has explicit temporal AND participant metadata, the extractor ADDITIONALLY writes one `memory_episodic` row that references `fact_id` with the episodic-specific fields.

- No row-bloat: episodic record carries only event_type / participants / location / occurred_at, not the fact content or vector
- Semantic retrieval guaranteed: `compost.query` over `facts` always finds the anchor
- Episodic retrieval via dedicated path: `compost.recall_event(time_range, participant)` joins `memory_episodic` to `facts`
- No lossy classification boundary at extraction time
- Sonnet and Codex's R3 condition satisfied (semantic search never silently misses a promoted record)
- Gemini's R2 concern satisfied (no duplicate vectors or content)

### Schema change

```sql
-- Migration 0005_episodic_link.sql (Phase 3, not Phase 0)

CREATE TABLE memory_episodic (
  episodic_id TEXT PRIMARY KEY,                             -- uuid v7
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
  event_type TEXT NOT NULL,                                 -- 'deployment', 'conversation', 'error', etc.
  participants TEXT NOT NULL DEFAULT '[]',                  -- JSON array
  location TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_episodic_fact ON memory_episodic(fact_id);
CREATE INDEX idx_episodic_time ON memory_episodic(occurred_at);
CREATE INDEX idx_episodic_event_type ON memory_episodic(event_type);

-- Phase 4:
CREATE TABLE memory_procedural (
  proc_id TEXT PRIMARY KEY,
  fact_id TEXT REFERENCES facts(fact_id),                   -- optional: can be standalone
  name TEXT NOT NULL,
  preconditions TEXT,
  effect_conditions TEXT,
  last_executed_at TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Phase 0 scope for C

Phase 0 does NOT add `memory_episodic` or `memory_procedural`. These land in Phase 3+. Phase 0 commits the `facts` table from debate #3 + the eventual extension path. The extractor JSON contract §4.3 adds optional `episodic: {event_type, participants, location, occurred_at}` field that Phase 0 ignores and Phase 3 honors.

---

## Decision D — Hook contract: ADOPTED AS CLAUDE-CODE-SPECIFIC ADAPTER, SYNC APPEND MANDATORY

### Corrected framing (Opus R1)

`compost hook <event>` is a CLI subcommand that **replaces the long-running `compost-adapter-claude-code` PROCESS** but writes to the **SAME outbox.db** with the **SAME idempotency protocol** from debate #1 + debate #3. It is an implementation change, not a protocol change.

- The stdio MCP notification protocol (debate #1) stays for non-Claude-Code hosts: airi, openclaw, generic MCP clients
- `packages/compost-adapter-claude-code` does NOT disappear — it becomes the `compost hook` CLI subcommand binary
- The outbox protocol (durable write + `UNIQUE(adapter, source_id, idempotency_key)` + replay on reconnect) is unchanged

### Q2 resolution — sync append mandatory

After R3, unanimous 4-0 on synchronous outbox append before hook success. Returning `{async: true}` before the WAL commit moves durability behind the ack boundary, which is exactly what the outbox pattern exists to prevent. Opus R1 Option 2 is retracted.

**The hook contract semantics**:
```
compost hook <event-name> < stdin.json

1. Parse stdin JSON envelope
2. Compute idempotency_key = sha256(adapter || source_id || stable(envelope))
3. Open outbox.db (WAL mode, exclusive lock for append)
4. INSERT INTO observe_outbox (payload) VALUES (?)
5. Wait for WAL commit (fsync implicit)
6. Close outbox.db
7. Print JSON response to stdout, exit 0

Hook completes with exit 0 ONLY after step 5 durability.
```

Any failure in steps 1-5 → exit non-zero, stderr describes error. Claude Code's retry semantics handle the retry loop; deterministic `idempotency_key` ensures duplicate retries produce one row in `observations`.

### Cold-start mitigation path

Phase 0 DoD adds a measurement gate:

1. **Phase 0 attempt**: `packages/compost-hook-shim/index.cjs` pre-bundled via `esbuild --bundle --platform=node --target=node20 --format=cjs` that loads ONLY `better-sqlite3`. No TypeScript runtime bootstrap. No workspace dep resolution. Target cold start: ≤ 20ms (8ms library load + 5ms write + 7ms overhead). (Sonnet)

2. **Phase 0 measurement**: install.sh or separate `compost doctor --measure-hook` reports p50/p95 cold start. Phase 0 ships ONLY IF p95 ≤ 30ms on reference hardware (M1/M2/M4 Mac or equivalent).

3. **Phase 1 fallback trigger**: if Phase 0 measurement fails (p95 > 30ms), Phase 1 DoD commits to rewriting `compost hook` as a native Go binary. Codex's preferred path; committed to only when the Node shim proves insufficient. (Codex)

The path order (Node first, native second) is pragmatic. The path trigger (measurement gate, not guesswork) is principled.

### Integration with Claude Code

```json
// User adds to ~/.claude/settings.json:
{
  "hooks": [
    {
      "event": "SessionStart",
      "command": "compost hook session-start",
      "timeout": 5000
    },
    {
      "event": "UserPromptSubmit",
      "command": "compost hook user-prompt-submit",
      "timeout": 5000
    },
    {
      "event": "PreToolUse",
      "command": "compost hook pre-tool-use",
      "timeout": 5000
    },
    {
      "event": "PostToolUse",
      "command": "compost hook post-tool-use",
      "timeout": 5000
    },
    {
      "event": "Stop",
      "command": "compost hook stop",
      "timeout": 5000
    }
  ]
}
```

Zero user-side integration work beyond pasting this block. No long-running adapter process. The outbox at `~/.compost/adapters/claude-code/outbox.db` is populated by each hook invocation; `compost-daemon` drains it on its own schedule.

---

## Composition check (final)

All four decisions compose cleanly under the refined forms:

| Pair | Tension | Resolution |
|---|---|---|
| A + B | B's `access_count` reinforcement wants writes; A is stateless | Batched append-only `access_log` table, aggregated in decay query. No inline writes on `facts`. |
| A + C | C's separate tables mean different decay curves per tier | `half_life_seconds` per-fact column, set by transform_policy at insertion. Each tier can have its own default half-life. |
| B + C | Kind-specific factors (success_rate for procedural, emotional_intensity for episodic) | Each physical table has its own ranking subquery; `ranking_profile` can be kind-specific. No NULL COALESCE contamination because each table has its own column set. |
| B + D | Hook subprocess vs ranking formula runtime | No interaction. Write path (D) and read path (B) run in different processes. |
| D + A | Hook write does not trigger decay recomputation | Correct — decay is read-time only. Hook only appends to outbox. |

**The converged architecture**:

```
WRITE PATH (Decision D + debate #1 + debate #3):
  Host triggers event → compost hook <event> CLI
    ↓ (sync append, deterministic idempotency_key)
  ~/.compost/adapters/<host>/outbox.db (append-only SQLite)
    ↓ (daemon reconciliation loop)
  compost-daemon reads outbox → ingest_queue (with lease columns)
    ↓ (lease claim, Python extraction subprocess)
  compost_ingest extract (§4) with optional context_scope_id + extraction_profile
    ↓ (returns chunks, facts, episodic_metadata)
  Node core writes to observations (L0) + facts (L2) + memory_episodic link (Phase 3+)
    ↓ (derivation_run row marks completion)
  LanceDB vector write (L1, Phase 1+)

READ PATH (Decision A + B + C):
  compost.query(q, opts) via MCP tool call
    ↓
  Two-stage retrieval: LanceDB ANN (top-K = 200) → SQLite rerank
    ↓ (request-scoped as_of_unix_sec + ranking_profile_id from opts)
  Apply stateless decay formula + multi-factor rank
    ↓ (JOIN facts + access_log aggregate + fact_context, kind-specific tables as needed)
  Return QueryHit[] with ranking_components per hit
    ↓ (audit log entry if COMPOST_RANKING_DEBUG=1 or sampled)
  Optional: caller reports result_selected via compost feedback (Phase 1+)

REFLECTION (Decision A hard-GC + Phase 3+ consolidation):
  compost reflect via daemon scheduler or manual trigger
    ↓
  Phase 0: sensory-tier DELETE where TTL expired + semantic soft-tombstone below decay floor
  Phase 3+: contradiction arbitration + wiki rebuild + episodic consolidation
```

---

## Required edits to existing documents

### `phase0-spec.md` → replaced by `compost-v2-spec.md`

Marked as superseded with a banner at the top pointing at `compost-v2-spec.md`. Kept in repo for audit trail.

### `phase0-checklist.md` → updated

- Step 2 (compost-core schema) now ships migrations 0001_init + 0002_debate3_fixes + 0003_stateless_decay + 0004_probabilistic_ranking
- Step 13b (rebuild verification test, from debate #3) adds: measure `compost hook` cold start; fail CI if p95 > 30ms on reference hardware
- Step 16 (compost-adapter-claude-code) is renamed: "Step 16: `compost hook` CLI subcommand + pre-bundled shim"
- Step 19 (install.sh) adds the Claude Code settings.json snippet as a doc output

### `docs/debate3/synthesis.md`

No edits. Debate #4 is additive; debate #3's locked decisions (derivation_run, policies table, context entity, queue lease, Step 13b rebuild test) are all preserved.

---

## Final spec deliverable: `compost-v2-spec.md`

Opus will author this file next, consuming this synthesis + all prior debate decisions. The spec will replace `phase0-spec.md` as the canonical Phase 0 executable plan. It will include:

- §0 Naming and layout (unchanged from phase0-spec.md)
- §1 L0 schema (merged: debate #1 + debate #3 + debate #4 migrations 0001-0005)
- §2 transform_policy (unchanged from debate #3)
- §3 Adapter SDK interface (unchanged for non-Claude-Code hosts) + new §3b Hook contract for Claude Code
- §4 Python extractor CLI (add optional episodic_metadata output from debate #4)
- §5 Core API (add `ranking_components` to QueryHit, `as_of_unix_sec` bind, `ranking_profile_id` param)
- §6 MCP server tools (unchanged list; `compost.query` semantics updated for probabilistic ranking)
- §7 `is_noteworthy()` (unchanged from debate #1)
- §8 install.sh (add Claude Code hooks settings.json snippet)
- §9 Day-one guardrails (merged across all 4 debates)
- §10 Phase 0 DoD (expanded with cold-start measurement + rebuild test)
- §11 Cognitive architecture layer (new section describing stateless decay, ranking formula, sensory hard-GC)
- §12 Phase roadmap (new section: Phase 0 encoding/storage → Phase 1 semantic retrieval → Phase 2 temporal + wiki → Phase 3 episodic + consolidation → Phase 4 active learning + procedural → Phase 5 multi-host)

---

## Decisions closed

| Decision | Status | Scope |
|---|---|---|
| Stateless query-time decay with `as_of_unix_sec` bind | ✅ Phase 0 | facts schema + decay SQL |
| `half_life_seconds` per-fact column | ✅ Phase 0 | set by transform_policy |
| Batched `access_log` table, no inline writes | ✅ Phase 0 | |
| Sensory-tier hard-GC via `compost reflect` | ✅ Phase 0 | 7-day TTL |
| Probabilistic ranking formula | ✅ Phase 1 (w1 only), Phase 2+ progressive |
| `ranking_components` API locked | ✅ Phase 0 | even with w1 only |
| `ranking_audit_log` with `result_selected` | ✅ Phase 1 | calibration telemetry |
| `ranking_profile` SQL table | ✅ Phase 0 | weight versioning |
| Bounded reinforcement saturation | ✅ Phase 3 (when w3 activates) | `LN(1+n)/LN(1+sat)` |
| Vertical partitioning physical layout | ✅ Phase 0 | facts base + future extension tables |
| `memory_episodic` link-not-duplicate | ⏸ Phase 3 | link table, not content copy |
| `memory_procedural` | ⏸ Phase 4 | standalone schema |
| `memory_blobs` / LanceDB vertical partition | ✅ Phase 1 | separate from hot metadata |
| `compost hook` CLI subcommand + sync append | ✅ Phase 0 | replaces long-running adapter for Claude Code |
| Pre-bundled CJS shim (esbuild) | ✅ Phase 0 | 20ms cold start target |
| Native Go/Rust binary fallback | ⏸ Phase 1 if p95 > 30ms | measurement-gated |
| MCP notification path for non-Claude-Code hosts | ✅ Phase 0 | unchanged from debate #1 |
| Deterministic `idempotency_key = sha256(adapter||source_id||envelope)` | ✅ Phase 0 | replaces `idempotency_key` from phase0-spec |
| `compost.ask` + `compost.query` share ranking contract | ✅ Phase 2 (when `compost.ask` ships) | |

---

## Phase 0 Go/No-Go

**GO with `compost-v2-spec.md` as the authoritative Phase 0 executable plan.**

Caveats the user should carry forward:
- The cognitive layer is set up to **behave like a brain** (ranking formula, decay, episodic/procedural paths, reflection loop) but the advanced paths (Phase 3+) are deferred. Phase 0 delivers the schema infrastructure for the vision, not the vision itself.
- The multi-host shareability story (airi, openclaw, multi-machine sync) is still deferred beyond Phase 0.
- The Active Learning loop (curiosity agent, gap tracker, autonomous crawl via SearchPlan) is Phase 4. Phase 0 opens the door but does not walk through it.

The architecture is now coherent enough to start writing code without fearing a Phase 2 rewrite.

**Phase 0 estimated scope**: ~2 weeks solo (up from 1 week in phase0-spec.md) because debate #4 added the `compost hook` shim + cold-start measurement + stateless decay schema + ranking profile/audit tables. The extra week is worth it — the rewritten version has a cognitive foundation the original did not.
