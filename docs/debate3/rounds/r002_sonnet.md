# R2 — Sonnet (Pragmatic Implementer)

**Role**: builder, debugger, shipper. R2 only — no repetition of R1 material.

---

## Conceding to Codex on derivation_run

Codex named the strongest concrete bug in R1: `derivations` PK `(observe_id, layer, model_id)` cannot store two rows differing only in `transform_policy`. I missed this in my R1. The collision is not theoretical — it fires the moment Phase 0's first policy iteration changes chunk overlap without upgrading the embedding model. SQLite either silently overwrites the old row (losing audit history) or rejects the insert (blocking the rebuild). Both outcomes break the rebuild story before it has run once.

**Full concession**: `derivation_run` with Codex's partial unique index on `(observe_id, layer, transform_policy, model_id) WHERE status IN ('pending','running','succeeded')` is the correct fix. The current `derivations` table must not ship as keyed.

---

## Attacking Gemini's context_scopes hierarchy

Gemini's `context_scopes.parent_id` is strategically sound for 2031 but operationally unshippable in Phase 0. The problem is freshness propagation. My `fact_context` schema stores freshness per `(fact_id, context_id)`. Gemini's hierarchy means a query arriving in parent scope `work` must determine whether a fact linked only to child scope `project-zylo` is visible and how fresh it is. There are two paths:

- **Cascade-up on write**: every freshness update to a child scope must walk and update ancestor rows — O(facts x depth) writes on a staleness sweep.
- **Traverse-at-query-time**: every query in `work` scope must recursive-CTE its descendant scopes, join `fact_context` on all of them, and aggregate minimum freshness. No index path covers this.

**My flat `fact_context` is cheaper for Phase 0** — one row per (fact, context), freshness check is a PK lookup. Gemini's `isolation_level` field is worth adding to the `context` entity; the `parent_id` traversal is Phase 2 scope. Shipping hierarchy before the freshness propagation semantics are specified will produce silent correctness bugs on first use.

---

## On Opus's Risk A: rebuild test gap

Opus correctly identified that Phase 0 never drops LanceDB and re-runs the ingest pipeline to verify output equivalence. I endorse Step 13b as a Phase 0 DoD blocker.

One addition Opus did not name: the test must pin `transform_policy` by exact name, not "latest." If the rebuild path auto-selects a newer policy, the assertion passes trivially even if the actual derivation is different. Locking to `tp-YYYY-MM` explicitly is what makes the test deterministic. 40 lines of test code, no architectural cost.

---

## On Opus's Risk B: context-blind extractor

Opus proposed adding `contexts: string[]` to the §4.2 Python extractor schema as "a forward-compatible field Phase 0 ignores." I partially disagree on the framing. If Phase 0 ships without this field and Phase 2 adds it, every community-built adapter written in the interim must be updated. The extractor contract is the public seam between Node and Python — breaking it forces a version bump on all adapters. **Add `contexts` as an optional field now with the contract that extractors MAY ignore it.** This costs one JSON schema field. Deferring it to Phase 2 costs a forced adapter migration and will be re-debated then.

---

## New Risk: `ingest_queue` lease gap in parallel test runs

Codex flagged no owner column on `ingest_queue`. Extending this: Step 18 (`compost doctor --rebuild L1`) and Step 17 (`compost add`) both claim queue rows. Running them concurrently in CI — which the checklist's parallel phases imply — produces double-processing with no `claimed_by` column to prevent it. This is not caught by the single-process AsyncMutex test in Step 12. Add `claimed_by TEXT` (nullable, set to process UUID on claim, cleared on completion). One column, prevents phantom work in concurrent CI.

---

## Revised Axis Scores

| Axis | R1 | R2 | Change reason |
|---|---|---|---|
| 1. Self-evolution | 1 | 1 | Codex fix correct but does not make rebuild tested; Opus Risk A still open. |
| 2. External absorption | 2 | 2 | No change; extractor context-blindness is manageable if `contexts` added now. |
| 3. Multi-context switching | 0 | 0 | Confirmed blocking. Gemini's hierarchy worsens operational cost. |
| 4. Cross-agent shareability | 1 | 1 | `claimed_by` fix is small; fundamental single-host ceiling unchanged. |
| 5. Cross-machine portability | 1 | 1 | L0 anchor path exists; L3 reconcile gap is the binding constraint, not absence of sync protocol (explicitly deferred). |
| 6. Dependency graph | 2 | 1 | Opus Risk A is a Phase 0 DoD omission; docking one point. |
