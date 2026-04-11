1. **Q1**: Defer hierarchy to Phase 2; ship a first-class but flat `context_scope` now, because per-context freshness is required in Phase 0 but `parent_id` propagation semantics are not specified enough to ship safely.
2. **Q2**: Hold UUID `derivation_id` with refinement; cross-machine identity should be derived from `(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)` as a secondary deterministic fingerprint, not as the Phase 0 PK.
3. **Q3**: Defer SQL-ledger `policies` table to Phase 2; Phase 0 can keep the TypeScript registry if each `derivation_run` persists exact `transform_policy` and replay is tested against it.
4. **Q4**: Hold with refinement: context-sensitive extraction must ship now, but only as `derivation_run.context_scope_id` plus optional `extraction_profile` passed into Python; observation identity stays context-blind.
5. **Q5**: Hold my R2 order: `derivation_run` first, then `wiki_page_observe`, then first-class context tables, because freshness-by-context is meaningless until replay identity is correct.

**Minimal Phase 0 schema diff I require**

- Replace keyed `derivations` with `derivation_run(derivation_id TEXT PRIMARY KEY, observe_id, layer, transform_policy, model_id, context_scope_id NULL, extraction_profile NULL, status, started_at, finished_at, artifact_ref, supersedes_derivation_id NULL, error NULL)` plus a partial unique index on active `(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)`.
- Add `context_scope(id TEXT PRIMARY KEY, display_name TEXT NOT NULL, isolation_level TEXT NOT NULL, trust_floor TEXT NOT NULL, freshness_ttl_sec INTEGER NULL)`; no `parent_id` in Phase 0.
- Add `fact_context(fact_id, context_scope_id, freshness, last_verified_at, PRIMARY KEY(fact_id, context_scope_id))`.
- Replace `wiki_pages.contributing_observes` JSON with `wiki_page_observe(page_path, observe_id, PRIMARY KEY(page_path, observe_id))`.
- Add queue lease columns to `ingest_queue`: `lease_owner TEXT`, `lease_token TEXT`, `lease_expires_at TEXT`, plus claim/active-lease indexes. This is Sonnet’s `claimed_by` point, but the lease triplet is the minimal form that actually defines ownership and recovery.

**Final blocker**

- I would not ship without Step 13b: drop L1 artifacts, rebuild from L0 under a pinned `transform_policy`, and prove the rebuilt output matches the original snapshot under unchanged policy.

**Final axis scores**

All unchanged from R2.
