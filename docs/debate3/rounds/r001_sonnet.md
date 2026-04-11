# R1 — Sonnet (Pragmatic Implementer)

**Role**: the builder who ships this and debugs it at 2am. Every claim is grounded in a specific table, column, or step number.

---

## Top 3 Architectural Risks

### Risk 1: `contexts TEXT[]` is a JSON-array column doing load-bearing work it cannot carry

**Where it lives**: `source.contexts` (spec §1, line 97), `facts.contexts` (spec §1, line 182), `wiki_pages.contexts` (spec §1, line 197).

**The concrete failure mode**: the long-term vision requires contexts to behave like human "physical environments" — you walk into a different room and a different memory set activates, with potentially different freshness rules, different trust floors, and partial overlap. The current schema encodes context membership as a JSON text array on individual rows. This means:

1. There is no `contexts` table. Context names are raw strings repeated across thousands of rows with zero constraint on what a valid context is or what properties it carries. You cannot say "context `work` has a 24h freshness SLO but context `personal` has a 7-day SLO" — there is nowhere to store that. When the user asks "switch me to work context," the query layer must filter by `json_contains(contexts, '"work"')` — a full-table scan with no index.

2. Two contexts sharing a fact (`contexts = '["work","research"]'`) cannot independently expire that fact. If `work` refreshes it and `research` does not, you cannot represent the per-context staleness. `facts.freshness` is a single enum column (spec §1 line 183), not per-context.

3. When Agents B and C each operate in different contexts, a `compost.query` call with `opts.contexts = ["work"]` (spec §5 `QueryOptions`, line 514) returns hits — but the freshness and confidence values are computed globally, not per-context. You get stale facts served as fresh to Agent B because Agent C already marked them fresh in a different context.

**The user's vision explicitly describes "真的像人一样在物理世界多context下环境切换记忆内容" (actually switching like a human in a physical environment).** A JSON column on facts rows is not that. It is a tag system with no semantics.

---

### Risk 2: The single-writer LanceDB mutex is a cross-machine concurrency cliff disguised as a durability fix

**Where it lives**: spec §9 guardrail (line 702): "Node `AsyncMutex` wrapped around all LanceDB writes (daemon + CLI share the mutex via file lock)." Checklist Step 12 (line 100-102): "two concurrent inserts serialize through AsyncMutex, both land; file lock released after close."

**The concrete failure mode**: the mutex is scoped to a single OS process group on one machine. When the long-term vision requires "多个Agent使用" (multiple distinct agents sharing the same memory store concurrently across machines), `AsyncMutex` is invisible to any process not running in the same Node runtime. A file lock (`flock`) works within one machine but breaks silently in two scenarios:

1. **Compost-daemon + compost-cli running simultaneously on the same machine** — the spec intends these to coexist (checklist Step 0 clarification: "add `packages/compost-cli/`" as separate binary). If `compost add <file>` uses embedded-mode (spec §5, line 545: "Embedded mode imports `createCompost`, calls the functions directly") and the daemon is also running, they share the LanceDB file. Node `AsyncMutex` in the daemon's heap does not know about the CLI's mutex. You have two file-lock holders who each think they are the single writer.

2. **Multi-machine or even multi-session** — there is no sync layer (by design, spec §9 line 703: "~/.compost/ on local disk only"). So when the user's brain needs to follow them from laptop to desktop, the "rebuild from L0 anchor" path (mentioned in context.md axis 5) requires shipping the entire `~/.compost/` directory. The spec's `docs/portability.md` documents the constraint but provides no mechanism. For a "brain" that self-evolves, crossing a machine boundary today requires a full cold rebuild — which means L1 embeddings are regenerated (fine), but L3 wiki pages at `~/.compost/wiki/` are filesystem artifacts not in SQLite, so the rebuild path (`compost doctor --reconcile` at checklist Step 18) only compares `observations JOIN derivations WHERE layer='L1'` row counts against LanceDB — it does not reconcile `wiki_pages` records against actual files under `~/.compost/wiki/`.

**The L3 wiki is the part of the "brain" most expensive to rebuild, and it is the only layer without a reconcile path in Phase 0.**

---

### Risk 3: `wiki_pages.contributing_observes` is a JSON array of observe_ids — the L3 freshness check will silently break at scale

**Where it lives**: spec §1.7 (line 197-201):
```sql
CREATE TABLE wiki_pages (
  contributing_observes TEXT NOT NULL  -- JSON array of observe_ids
);
```
Spec §9 guardrail (line 706): "L3 freshness derived from L2 updated_at: `wiki_pages.last_synthesis_at` compared against `MAX(observations.captured_at) WHERE observe_id IN contributing_observes`."

**The concrete failure mode**: this freshness check requires parsing `contributing_observes` JSON in a WHERE clause using SQLite's `json_each()`. As L3 wiki pages accumulate contributing observations over months (which is the entire point of a self-evolving brain — pages get richer over time), this array grows unbounded. A wiki page about "Next.js caching" after 6 months of weekly crawls could have 50+ observe_ids in that JSON blob.

Worse: the query the spec describes — `MAX(observations.captured_at) WHERE observe_id IN contributing_observes` — cannot use any index on the observations table because the IN clause is dynamically computed from a JSON parse. Every L3 staleness check is a full `observations` table scan filtered by parsed JSON. At 50,000 observations (not unrealistic for 6 months of passive sniff + crawl), the freshness check on a single wiki page scans 50,000 rows.

The correct structure is a normalized join table, not a JSON column. This is a day-one schema decision that becomes a migration hazard if deferred.

---

## One Schema Change to Make Today

Replace the `contributing_observes TEXT` column in `wiki_pages` AND add a proper `context` entity table. Both fix risks 1 and 3 simultaneously:

```sql
-- Add BEFORE the facts table in 0001_init.sql

-- Context entity: first-class, with per-context configuration
CREATE TABLE context (
  id TEXT PRIMARY KEY,                    -- e.g. "work", "research", "personal"
  display_name TEXT NOT NULL,
  freshness_ttl_sec INTEGER,              -- NULL = inherit global default
  trust_floor TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_floor IN ('user','first_party','web')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT                        -- soft-delete; queries exclude archived
);

-- Replace wiki_pages.contributing_observes TEXT with a join table
CREATE TABLE wiki_page_observe (
  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_path, observe_id)
);

CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);

-- Replace facts.contexts TEXT and source.contexts TEXT with a join table
CREATE TABLE fact_context (
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  freshness TEXT NOT NULL DEFAULT 'fresh'
    CHECK(freshness IN ('fresh','stale','expired')),
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fact_id, context_id)
);

CREATE INDEX idx_fc_context ON fact_context(context_id);
```

This makes the L3 freshness query indexable:
```sql
-- Fast: indexed join, no JSON parse
SELECT MAX(o.captured_at)
FROM wiki_page_observe wpo
JOIN observations o ON o.observe_id = wpo.observe_id
WHERE wpo.page_path = ?;
```

And it enables per-context freshness on facts (`fact_context.freshness`) which the long-term vision requires but the current schema makes impossible.

The `context` table costs one migration and maybe 200 lines of updated TypeScript. Deferring it means rearchitecting when multi-context is actually needed, which is a schema migration across potentially millions of facts rows.

---

## Axis Scores

| Axis | Score | Justification |
|---|---|---|
| 1. Brain-like self-evolution | 1 | `derivations` table + `transform_policy` create the audit trail for re-derivation, but L4 scheduler is a stub in Phase 0 (spec §10, deferred to Phase 3) and `reflect()` is a no-op. The mechanism exists but the loop that actually drives evolution does not. Phase 0 builds the memory, not the self-improvement. |
| 2. External knowledge absorption | 2 | Adapter SDK abstraction (spec §3) is genuinely extensible. New source kinds require only a new `HostAdapter` subclass + new `kind` value in `source.kind` CHECK constraint. The CHECK constraint itself (spec §1 line 92: `kind IN ('local-file','local-dir','web','claude-code','host-adapter')`) is the fragility: adding a new source type requires a schema migration. Minor, but at 2am when someone wants to add a Notion adapter, they will hit this. |
| 3. Multi-context switching | 0 | JSON arrays on facts/sources/wiki_pages with no `context` entity table and no per-context freshness, trust, or SLO configuration. Query filter exists (`QueryOptions.contexts` in spec §5 line 514) but is a label match, not a semantic switch. This is blocking for the long-term vision as stated by the user. |
| 4. Cross-agent shareability | 1 | stdio MCP + outbox pattern handles multiple adapters writing to one daemon. But the single-writer LanceDB mutex (spec §9 line 702) is process-scoped. "compost add" in embedded mode (spec §5 line 545) + daemon running simultaneously = two writers who do not see each other's mutex. Concurrent reads from multiple querying agents are not addressed at all (LanceDB supports concurrent reads, but the spec does not document the read isolation model). |
| 5. Cross-machine portability | 1 | "Rebuild from L0 anchor" is the stated path, but `compost doctor --reconcile` (checklist Step 18) only verifies L1 row counts. L3 wiki files on disk are not reconciled. No export/import tooling exists or is planned. Local-disk-only is correct but the consequence for the user's "follow your brain across machines" vision is a cold rebuild that loses L3 and requires a full re-synthesis run. |
| 6. Dependency graph correctness | 2 | The 23-step checklist is correctly ordered. Phases A/B/C are genuinely parallel after Step 2. Steps 13 (ingest pipeline) correctly depends on 7, 8, 11, 12. One gap: Step 17 (`compost add`) depends on Steps 13 and 15 but not Step 10 (MCP client). `compost add` uses embedded mode (no MCP hop), so this is intentional — but the checklist does not state this dependency exclusion explicitly, which will confuse a new contributor who wonders why `compost add` does not use the daemon. |

---

## Disagreements with Debate #1 and #2

**No disagreement with the locked decisions themselves.** stdio MCP + outbox, hybrid runtime, date-stamp transform_policy, and derivations table are all correct and I hold those positions.

The gap I am raising in Risk 1 was not addressed in either prior debate. Debate #1 listed `contexts TEXT[] on facts and sources` as a fact without stress-testing whether a JSON array column is sufficient for the user's multi-context switching vision. Debate #1 synthesis said "context-based partitioning is sufficient as the primary axis" (debate/synthesis.md line 289) — I am directly contesting that claim. A JSON tag is not partitioning. It is an afterthought waiting to be a migration.

Risk 3 (`contributing_observes` as JSON) is new. Neither debate examined the L3 wiki freshness implementation at the column level.

Risk 2 (mutex scope) was raised by me in debate #1 as a single guardrail item (spec §9 line 702) but the cross-process and cross-mode implications (daemon + embedded-CLI simultaneous writes) were not fully worked through. The checklist Step 12 test (`two concurrent inserts in the same process serialize through AsyncMutex`) does not catch the daemon + CLI case.
