# R3 — Claude (Opus) — FINAL POSITIONS + BINDING DECISIONS

**Role**: moderator + participant. In R3 I hold final position on Q1-Q5 and mark each as **Decided / Deferred / Disputed**. The synthesis.md will carry the same decisions.

---

## Final positions on Q1-Q5

### Q1 — Context hierarchy: **Decided — defer to Phase 2**

Sonnet's R2 attack is correct. Hierarchy requires freshness propagation semantics that nobody has specified. You cannot ship correctness you have not defined. Gemini's strategic point is registered and carried into Phase 2 scoping.

**Ship in Phase 0**: flat `context` entity with `isolation_level` and `trust_floor`. No `parent_id`.

**Concession to Gemini**: `context.id` is designed as hierarchical-path-safe from day one (`"work"`, `"work/project-zylo"`) so the Phase 2 migration that adds `parent_id` is a backfill, not a rename.

### Q2 — derivation_run PK: **Decided — Sonnet's compromise**

Gemini is directionally correct that cross-machine convergence needs deterministic identity. Sonnet's bridge (UUID PK + `content_hash` generated column + unique index) gives you the convergence identity today without forcing Phase 0 to implement a sync/merge protocol. When Phase N actually ships sync, the merge path is `INSERT OR IGNORE` keyed on `content_hash`, not the UUID.

This gives Gemini the convergence property (two machines producing identical inputs produce one row with one hash) while keeping Codex's operational simplicity (UUID as referenced PK).

### Q3 — transform_policy: **Decided — Sonnet's bridge**

Ship `policies` as an SQL table in Phase 0. Populate it via the TypeScript registry `upsert()` at daemon startup. This shuts down Gemini's cross-machine concern (L0 ledger now contains the policy definition, not just a string pointer) while preserving Codex's practicality (authoring stays in TypeScript). Full ledger-sync-of-policies is Phase 2.

### Q4 — Context-dependent extraction: **Decided — Codex's R2 correction**

Codex is right, I was wrong in R1. Context belongs in `derivation_run` inputs (`context_scope_id` + optional `extraction_profile`), not in observation keys. The Python extractor receives `(observe_id, transform_policy, context_scope_id, extraction_profile)` at derivation time. Observations stay context-blind to preserve L0 portability: same Slack message captured in work+personal is still ONE L0 row, with two derivation runs producing different L1/L2 artifacts.

Gemini's cognitive-science objection ("perception is context-dependent") is answered: perception IS context-dependent, but it happens at derivation, not observation. The objective arrival of bytes is L0; the subjective interpretation is L1+.

### Q5 — Migration order: **Decided — Sonnet's 5-step sequence**

1. `derivation_run` replaces `derivations` (unblocks policy-only reruns — Codex R1 bug fix)
2. `policies` table + TypeScript registry upsert-on-startup
3. `context` entity table + `fact_context` join (with per-context freshness)
4. `wiki_page_observe` join table (replaces `contributing_observes` JSON)
5. `ingest_queue` lease columns (`lease_owner`, `lease_token`, `lease_expires_at`)

Gemini's "atomic" argument is rejected: these are additive migrations with no circular dependencies. Shipping them sequentially lets Step 1 unblock the rebuild story immediately while the rest land in the same sprint.

---

## Minimum Phase 0 schema diff I require before ship

Merged from Codex R3 + Sonnet R3 (they converged):

```sql
-- (1) derivation_run replaces derivations
CREATE TABLE derivation_run (
  derivation_id TEXT PRIMARY KEY,  -- UUID v7
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  context_scope_id TEXT,           -- nullable: null = context-neutral derivation
  extraction_profile TEXT,         -- nullable
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','superseded')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  artifact_ref TEXT,
  supersedes_derivation_id TEXT REFERENCES derivation_run(derivation_id),
  error TEXT,
  -- Gemini's convergence hook
  content_hash TEXT GENERATED ALWAYS AS (
    lower(hex(observe_id)) || ':' || layer || ':' || transform_policy || ':' ||
    coalesce(model_id,'') || ':' || coalesce(context_scope_id,'') || ':' ||
    coalesce(extraction_profile,'')
  ) STORED
);
CREATE UNIQUE INDEX idx_derivation_run_active
  ON derivation_run(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)
  WHERE status IN ('pending','running','succeeded');
CREATE UNIQUE INDEX idx_derivation_run_hash
  ON derivation_run(content_hash) WHERE status = 'succeeded';

-- (2) policies table (populated from TypeScript registry at startup)
CREATE TABLE policies (
  policy_id TEXT PRIMARY KEY,             -- e.g. 'tp-2026-04'
  supersedes TEXT REFERENCES policies(policy_id),
  effective_from TEXT NOT NULL,
  definition_json TEXT NOT NULL,          -- full policy object as JSON
  migration_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- (3) context entity + fact_context join
CREATE TABLE context (
  id TEXT PRIMARY KEY,                    -- hierarchical-path-safe: 'work', 'work/project-zylo'
  display_name TEXT NOT NULL,
  isolation_level TEXT NOT NULL DEFAULT 'shared'
    CHECK(isolation_level IN ('shared','isolated')),
  trust_floor TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_floor IN ('user','first_party','web')),
  freshness_ttl_sec INTEGER,              -- NULL = inherit global default
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE fact_context (
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  freshness TEXT NOT NULL DEFAULT 'fresh'
    CHECK(freshness IN ('fresh','stale','expired')),
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fact_id, context_id)
);
CREATE INDEX idx_fc_context ON fact_context(context_id);

-- Remove `contexts TEXT` column from `source`, `facts`, `wiki_pages`
-- (in Phase 0 they become backed by fact_context + source_context join tables)

-- (4) wiki_page_observe replaces contributing_observes JSON
CREATE TABLE wiki_page_observe (
  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_path, observe_id)
);
CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);

-- (5) ingest_queue lease columns
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

**Also required but not schema**:
- Python extractor input schema §4.2 stays unchanged. `context_scope_id` + `extraction_profile` are passed as derivation inputs to `compost_ingest extract` as new top-level fields that the extractor MAY use and MUST preserve in output for replay.
- `phase0-checklist.md` Step 13b (rebuild verification test) — unanimous blocker.

---

## One final blocker

**Step 13b rebuild verification test.** Unanimous across all four participants. Without it, the entire "L0 is the anchor, L1-L3 are disposable views" premise is an assertion, not a verified property. Codex R2 specified the concrete test (seed 3 observations → snapshot → drop LanceDB → rebuild under pinned policy → assert chunk-hash match + negative test with new policy). Sonnet R2 added the critical refinement: pin the policy name, do not use "latest."

---

## Final axis scores (Opus)

| Axis | R1 | R3 | Reason for change |
|---|---|---|---|
| 1. Self-evolution | 1 | **1** | Unchanged. The evolution loop is still a Phase 3 stub. The schema diff above sets the foundation but does not ship the reflect loop. |
| 2. External absorption | 2 | **2** | Unchanged. |
| 3. Multi-context switching | 0 | **1** | With flat `context` entity + `fact_context` + per-context freshness + derivation_run context-aware derivation, the semantics exist. Still docked 2 points because hierarchy is Phase 2. |
| 4. Cross-agent shareability | 1 | **1** | Queue lease fixes multi-writer on one machine. Cross-machine concurrency still requires a sync story that is explicitly deferred. |
| 5. Cross-machine portability | 0 | **1** | `content_hash` convergence identity + `policies` table in ledger means cross-machine rebuild is now *possible without source code*. Still docked because there is no export/import tool or sync protocol. |
| 6. Dependency graph | 1 | **1** | Restores to 2 once Step 13b lands in the checklist. Currently still docked. |

**Phase 0 verdict**: the architecture foundation is sound with these fixes, but calling it a "brain" is aspirational. What Phase 0 delivers is the *metadata schema* for a brain-like memory, not the brain itself. The user should go in with eyes open: axes 1, 4, 5 are all 1/3 — the loop, the multi-host, and the multi-machine stories are scaffolded but not built.
