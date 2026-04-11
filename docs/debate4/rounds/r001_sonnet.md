# Debate #4 — Round 1: Pragmatic Implementer (Sonnet 4.6)

**Role**: Pragmatic Implementer — ships this, debugs it at 2am
**Date**: 2026-04-11

---

## Decision A — Stateless query-time decay

**Score: 2/3**

Adopt in principle, with one mandatory schema column before Phase 1.

### Failure mode NOT in the stress-test list

**Stale sort with composite WHERE clauses against LanceDB.** The `memories` concept in the new proposals spans both the SQLite ledger (`facts` table, now with `fact_context` join) and LanceDB vectors. The stateless decay formula operates on SQLite `facts`, but `compost.query` in Phase 1 will do a two-stage retrieval: ANN search in LanceDB returns top-K candidate IDs, then SQLite applies the decay-reranked ORDER BY. The problem is that LanceDB's ANN pre-filter is cosine-distance ranked without decay — so a very old semantically-close fact will bubble up from LanceDB into the top-K candidate set, then decay will push it down in the SQL rerank stage. Under the current Phase 0 `QueryHit` interface (`packages/compost-core/src/api.ts` line 519), you return a fixed list. If the decay function eliminates 40% of the LanceDB top-K as stale, you are left with a short result set and there is no second-chance retrieval pass to fill the gap. At 500K+ rows this silently degrades result quality without any error signal. The user sees "sparse results" with no indication that decay killed them.

### Concrete schema change required

Add `half_life_seconds INTEGER NOT NULL DEFAULT 2592000` (30 days) to the `facts` table — not to `memories`, because Compost does not yet have a `memories` table; facts are the unit in `phase0-spec.md §1.6`. Without this column, every fact uses the same global decay curve and you cannot differentiate procedural facts (should decay slowly) from session-ephemeral observations (should decay fast). The column must be set at fact-insertion time by the transform policy, not runtime config, so that decay behavior is reproducible from the derivation record.

```sql
ALTER TABLE facts ADD COLUMN half_life_seconds INTEGER NOT NULL DEFAULT 2592000;
```

The `transform_policy` registry entry (`packages/compost-core/src/policies/registry.ts`) gets a new field:
```typescript
factDecay: { halfLifeSeconds: 2592000 }  // per-policy, immutable after locked
```

### Rationale tied to Compost workload

Compost Phase 0 ingests local markdown files. The dominant query pattern is "what did I know about X?" where X is a technical topic. Technical facts do not decay on the Ebbinghaus curve — a fact that Next.js 16 introduced Cache Components is either still true or superseded by a later observation. Ebbinghaus decay makes sense for episodic memory (AIRI's use case: chat interactions with a VTuber persona). Compost's content model is closer to a knowledge base than episodic recall. So stateless decay is right architecturally (no background jobs, simpler), but the half-life must be long and per-topic-kind, not a single global lambda. The `half_life_seconds` column on `facts` is the minimum viable hook for this.

The write-amplification risk (where does `access_count` get written?) is real but manageable: batch-append `access_count` increments to an `access_log` table, sum them with `GROUP BY fact_id` in the decay query. This avoids hot-row contention on `facts` while preserving the reinforcement signal. Do NOT update `facts.access_count` inline on retrieval — that turns every read into a write under SQLite WAL and degrades latency noticeably at even modest (10K+ row) scales.

---

## Decision B — Probabilistic multi-factor ranking

**Score: 1/3**

Premature as specified. The formula is directionally correct but unshippable without a calibration story, an audit path, and a cold-start fallback. This is not architectural opposition — it is sequencing opposition.

### Failure mode NOT in the stress-test list

**Formula drift between query paths.** The formula as written applies to `compost.query` results. But `compost.ask` (Phase 2) will call an LLM that synthesizes from L3 wiki pages. Wiki pages are synthesized from `facts` via `wiki_page_observe`. If the ranking formula promotes memory X in `compost.query` but the wiki synthesis weights are computed at synthesis time (not retrieval time), the two paths diverge: the user sees "result X" in query mode but wiki-synthesized answer "Y" because X was stale when the wiki was last built. This is not a formula correctness problem — it is an architectural coherence problem. You now have two independent ranking surfaces (real-time formula + pre-computed synthesis) that can contradict each other with no reconciliation protocol.

### Concrete schema/code change required

Before the formula can ship, require a `ranking_audit_log` table that captures per-query factor contributions when debug mode is on:

```sql
CREATE TABLE ranking_audit_log (
  query_id TEXT NOT NULL,
  fact_id TEXT NOT NULL REFERENCES facts(fact_id),
  queried_at TEXT NOT NULL DEFAULT (datetime('now')),
  w1_semantic REAL,
  w2_temporal REAL,
  w3_access REAL,
  w4_importance REAL,
  w5_emotional REAL,
  w6_repetition_penalty REAL,
  w7_context_mismatch REAL,
  final_score REAL NOT NULL,
  rank_position INTEGER NOT NULL
);
```

Without this, when a user reports "bad results," you are debugging a black-box formula against a production database. This table is gated behind a `COMPOST_RANKING_DEBUG=1` env var (write on every query only when enabled) so it does not affect steady-state performance. The audit log is the prerequisite for any future auto-tuning from thumbs-up/down feedback.

### Rationale

Phase 0 scope is `compost.query` returning empty results with correct schema (phase0-spec.md §10 DoD). Phase 1 adds embeddings. The ranking formula requires `w1*semantic_similarity` which requires embeddings, `w3*sqrt(access_count)` which requires the access log, and `w5*emotional_intensity` which requires the valence/arousal columns that do not exist in the current `facts` schema at all. Shipping all seven weights simultaneously in Phase 1 is a debugging nightmare — one mis-calibrated weight silently degrades all retrieval. The correct sequence: Phase 1 ships w1 only (pure semantic). Phase 2 adds w2 (temporal, stateless, cheap). Phase 3 adds w3 and w4 when there is enough retrieval history to validate access_count signal. w5-w7 are Phase 4+. The formula as a target architecture is 2/3 correct; the proposal to adopt all seven factors simultaneously is 1/3 ready.

---

## Decision C — 5-tier cognitive memory in ONE physical table

**Score: 1/3**

Premature and partially regressive relative to debate3 decisions. Specific opposition: the single-table proposal repeats the `contexts TEXT[]` JSON anti-pattern that debate3 unanimously rejected (synthesis.md finding #3, line 36).

### Failure mode NOT in the stress-test list

**Partial-index proliferation kills migration velocity.** If you enforce kind-partitioned retrieval via `WHERE kind='semantic'` and performance requires a partial index per kind, you now have N partial indexes (one per cognitive tier). When Phase 3 adds `procedural`, you add a new partial index. Fine for 5 tiers. But the real cost hits when kind-combination queries appear: "give me all semantic AND procedural facts about X" requires either a full scan (ignoring partial indexes) or a UNION of two partial index scans, which SQLite's query planner struggles with. The Phase 3 schema for procedural memory almost certainly needs columns that semantic facts don't have (e.g., `preconditions TEXT`, `effect_conditions TEXT`, `last_executed_at TEXT`). Under a single table, these are NULL for 99% of rows exactly as the stress-test question predicts — but the worse problem is that every new nullable column forces a table-wide migration lock in SQLite, because SQLite's `ALTER TABLE ADD COLUMN` requires default values and cannot add NOT NULL columns without a full table rewrite. At 500K+ rows that lock is minutes, not milliseconds.

### Concrete schema change required

Do NOT merge all five tiers into one table. Use the airi precedent (4 separate tables: `memory_fragments`, `memory_episodic`, `memory_long_term_goals`, `memory_short_term_ideas`) and LycheeMem precedent (3 separate stores), both of which arrived at separate physical tables via operational experience, not armchair design. The Compost equivalent that preserves debate3's hard-won `fact_context` join pattern:

Keep the existing `facts` table (debate3 §1.6) as the semantic/factual tier. Add separate tables for additional tiers as they are needed, linked back to `observations` via the existing `derivation_run` mechanism:

```sql
-- Phase 3, when procedural actually ships:
CREATE TABLE procedural_memory (
  proc_id TEXT PRIMARY KEY,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
  name TEXT NOT NULL,
  preconditions TEXT,          -- can be NOT NULL here, no sparse problem
  effect_conditions TEXT,
  last_executed_at TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The `kind` enum belongs in derivation metadata (`derivation_run.layer` already does this for L1/L2/L3), not in a flat discriminator column on a merged table. Views on top of separate physical tables can expose a unified query interface without paying the sparse-column and migration-lock costs.

### Rationale

The "one table is simpler" claim is a Phase 0 argument. It becomes an operational liability in Phase 3 when procedural memory lands with radically different schema requirements. The migration from one-table-with-kind to N-tables is far more painful than starting with separate tables. The view-based abstraction can be added at any time. The data migration from merged table back to separate tables cannot be done live without downtime. YAGNI applies in both directions: do not add complexity you don't need (single table), but do not take on migration debt that blocks you later (sparse columns). Separate tables from the start is the conservative choice, not the aggressive one.

---

## Decision D — Hook contract replaces MCP notifications as write path

**Score: 2/3**

Adopt for Claude Code adapter specifically. Do NOT replace the MCP notification write path globally. The proposal as stated overreaches.

### Failure mode NOT in the stress-test list

**Double-write hazard during transition window.** The proposal says `compost-adapter-claude-code` disappears. But the adapter's outbox (debate3's locked decision, phase0-spec.md §3) is the durability guarantee for events when the daemon is down. If `compost hook user-prompt-submit` replaces the adapter, who owns the outbox? The Claude Code source survey shows that Claude Code's async hook registry (`utils/hooks/AsyncHookRegistry.ts`) tracks completion using file-based task files under `~/.claude/teams/{teamId}/tasks/`. This is Claude Code's task tracking, not Compost's outbox. If the `compost hook` subprocess is the "thin shim over the outbox" (the debate context's own phrase), then you have two outbox owners: Claude Code's async registry AND Compost's `observe_outbox` SQLite. When the daemon recovers, both replay mechanisms fire. The `UNIQUE(adapter, source_id, idempotency_key)` constraint on `observations` prevents duplicates in the ledger, but you get double-processing in `ingest_queue` if the idempotency check is not implemented at enqueue time (the current spec does not show it at `ingest_queue` level, only at `observations` level).

### Concrete code change required

If adopting hook contract for Claude Code, the `compost hook <event>` subprocess must own ONE outbox, not share state with Claude Code's task registry. Concretely: the `compost hook` command writes the event to `~/.compost/adapters/claude-code/outbox.db` (same path as the current adapter outbox), then exits with code 0. The daemon's reconciliation loop picks it up. No changes to the daemon. The `compost hook` binary is a thin wrapper:

```typescript
// packages/compost-hook/src/index.ts
// stdin: Claude Code hook JSON payload
// writes to outbox.db, exits 0
// daemon reads outbox exactly as before
```

The adapter package (`compost-adapter-claude-code`) does not disappear — it becomes the `compost hook` binary. The MCP notification path (`compost.observe` notification) stays as a fallback for non-Claude-Code hosts (airi, generic MCP clients). The architectural change is: for Claude Code specifically, the trigger is a hook subprocess rather than a long-running adapter process watching for hook events via its own Claude Code API. This is a real improvement for Claude Code because it eliminates the always-running adapter process. But it does not replace MCP notifications as the write-path protocol for other hosts.

### Rationale

Debate1 locked in stdio MCP + outbox "after explicit contestation" (context.md line 88). The new evidence justifying reopening is specific to Claude Code: the hook system (utils/hooks.ts) is a stable, well-documented subprocess contract with exit code semantics, explicit async mode, and Claude Code manages its own retry queue. This is strictly better than running a background adapter process for Claude Code users. But the justification is Claude-Code-specific. airi uses Telegram/Discord bots with no hook dispatcher. Generic MCP clients have no hook system. The proposal's scope should be "replace the Claude Code adapter process with a hook subprocess" not "replace MCP notifications globally." Scoping it correctly keeps debate1's decisions intact while capturing the real improvement from the Claude Code source survey.

---

## Composition check

The four decisions have two non-obvious conflicts when composed:

**A + B conflict — decay formula doubles the index pressure.** If A (stateless decay) is adopted with `half_life_seconds` column on `facts`, and B (probabilistic ranking) adds `w2*temporal_relevance` + `w3*sqrt(access_count)`, then the query that evaluates the ranking formula reads `facts.half_life_seconds`, `facts.created_at` (for decay), and the `access_log` aggregate (for access_count) in a single SELECT. Without careful query planning, this is a three-way join on every `compost.query` call. Under LanceDB's two-stage retrieval (ANN then rerank), this join happens after the ANN narrows to top-K candidates, so the join is bounded. But it is only safe if both A and B are implemented together with the LanceDB two-stage architecture explicitly designed to feed the join. If A lands in Phase 1 and B lands in Phase 2 without this architectural agreement, Phase 2 will require a query rewrite that breaks Phase 1 API contracts.

**D cold-start cost does NOT conflict with B formula evaluation** — the stress-test question (context.md line 89) asks if the 50-200ms Node cold start at PreToolUse/PostToolUse frequency is a bottleneck. Answer: yes, but this is a D-only problem. The formula (B) runs inside the daemon process during `compost.query` (MCP tool call), not inside the hook subprocess. Hook subprocess is write-path only; formula evaluation is read-path only. They do not interact.

**C + B conflict — tier-specific weights.** If C (single table with kind enum) is adopted and B (ranking formula) is also adopted, the formula's w4 (importance) and w5 (emotional_intensity) may need to be kind-specific — procedural facts don't have emotional intensity, semantic facts don't have execution success_count. Under a single table with nullable columns this becomes a case-expression nightmare in the ranking formula: `COALESCE(emotional_intensity, 0)` for non-emotional kinds silently zero-weights emotional signal for all procedural facts. Under separate physical tables (my recommendation for C), each table's query wrapper applies the relevant formula subset. This is the correct decomposition.

---

## Final paragraph

If forced to ship Compost v2 tomorrow with only two of these four decisions adopted, I pick **A (stateless decay)** and **D (hook contract for Claude Code specifically)**.

Rationale: A is the only one of the four that eliminates background infrastructure you would otherwise have to build and operate. Background decay update jobs are subtle to get right — they fail silently (the daemon dies, scores drift, nobody notices until results are obviously wrong six months later). Stateless computation is testable, reproducible, and has no operational surface. The `half_life_seconds` column on `facts` is a one-migration addition that carries no migration debt. A is adoptable in Phase 1 with minimal risk.

D (scoped correctly to Claude Code adapter) is adoptable in Phase 0 because it replaces a design decision before any code ships. The current adapter package is not written. Changing the write-path from "long-running adapter process sending MCP notifications" to "hook subprocess writing to outbox" is a simpler architecture: fewer moving parts, no always-running process to crash, natural integration with Claude Code's existing hook infrastructure. The outbox durability guarantee is preserved because the hook subprocess writes to the same SQLite outbox the adapter would have used. Zero new concepts.

B is not picked because it requires production query history to calibrate and a ranking audit log to debug — neither exists yet. Shipping the formula before you have the data to tune it is aesthetics, not engineering.

C is not picked because the opposing evidence (airi's 4-table design, LycheeMem's 3-store design) represents operational experience, and the single-table path creates migration debt that compounds with every new memory tier. Do not make the schema decision that is hardest to undo.
