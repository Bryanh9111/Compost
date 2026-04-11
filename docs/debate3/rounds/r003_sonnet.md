# R3 — Sonnet (Pragmatic Implementer) — FINAL POSITIONS

---

## Final Positions on Q1-Q5

**Q1. Context hierarchy: Phase 0 or Phase 2?**
Hold. Ship flat `context` table now; defer `parent_id` to Phase 2. Gemini's freshness propagation semantics for hierarchy are unspecified -- you cannot implement correctness you have not defined. Flat entity table this sprint, hierarchy when the cascade rules are written down.

**Q2. derivation_run PK: UUID or deterministic hash?**
Concede to Gemini on direction, partial hold on Phase 0 scope. Deterministic hash is correct for cross-machine convergence. Phase 0 ships UUID PK with a `content_hash TEXT GENERATED ALWAYS AS (hash(observe_id||layer||transform_policy||model_id)) STORED` column and a unique index on it. Gives you convergence identity now without a multi-machine sync story that Phase 0 explicitly defers.

**Q3. transform_policy: TypeScript code or SQL ledger data?**
Defer to Phase 2 with one Phase 0 bridge. Ship `policies` as an SQL table in Phase 0 with `(policy_id TEXT PK, chunk_size INT, overlap INT, prompt_template TEXT, model_id TEXT, created_at TEXT)`. The TypeScript registry populates this table at startup via upsert. Policy content is now in the DB; cross-machine rebuild can read it without source code. Full ledger-sync is Phase 2.

**Q4. Context-dependence of extraction (Risk B)**
Hold. Add `context_scope_id TEXT` and `extraction_profile TEXT` to `derivation_run` now, not to the Python extractor input schema. Codex R2 is correct: idempotency must stay observation-identity-only. Same L0 anchor produces different L1/L2 runs per context via `derivation_run.context_scope_id`. The extractor contract stays stable; context variation lives in derivation inputs.

**Q5. Migration order**
Concede to Codex. Order is: (1) `derivation_run` + partial unique index, (2) `policies` table, (3) `context` entity + `fact_context` join, (4) `wiki_page_observe` join, (5) lease columns on `ingest_queue`. Each migration is independently deployable in this sequence.

---

## Minimal Phase 0 Schema Diff (Required Before Ship)

Same as Codex R2 `derivation_run` definition, plus:

1. `derivation_run.content_hash` generated column + unique index (Q2 bridge)
2. `derivation_run.context_scope_id TEXT` + `extraction_profile TEXT` (Q4)
3. `policies(policy_id, chunk_size, overlap, prompt_template, model_id, created_at)` -- populated by TypeScript registry upsert at startup (Q3 bridge)
4. `context(id, display_name, freshness_ttl_sec, trust_floor, created_at, archived_at)` -- flat, no `parent_id` (Q1)
5. `fact_context(fact_id, context_id, freshness, last_verified_at)` -- replaces `facts.contexts TEXT[]`
6. `wiki_page_observe(page_path, observe_id, linked_at)` -- replaces `wiki_pages.contributing_observes TEXT`
7. `ingest_queue` lease columns: `lease_owner TEXT`, `lease_token TEXT`, `lease_expires_at TEXT` + compound index

---

## One Blocker I Will Not Ship Without

**Step 13b rebuild verification test**: seed 3 deterministic observations, run L1 derivation under pinned `transform_policy`, snapshot chunk hashes, drop LanceDB, invoke `compost doctor --rebuild L1 --policy tp-2026-04`, assert hashes match. Without this test, "L0 is the rebuild anchor" is an untested claim, not a property of the system.

---

## Final Axis Scores

All unchanged from R2.
