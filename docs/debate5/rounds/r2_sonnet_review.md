# Second-Round Fresh-Eyes Review: compost-v2-spec.md v2.1

Reviewer: Sonnet (independent, no prior review history read)
Specialty: cross-section consistency, patch-introduced regressions

---

## 1. Shippability Verdict

**SHIP WITH REQUIRED CHANGES** — 3 concrete fixes must land before coding starts.

---

## 2. Top Concerns Still Present

### 2a. `wiki_page_observe.observe_id` missing FK CASCADE

**Location**: §1.2 Migration 0002_debate3_fixes.sql, lines 339-346

The `wiki_page_observe` join table declares:
```sql
observe_id TEXT NOT NULL REFERENCES observations(observe_id),
```
No `ON DELETE CASCADE`. Every other child-of-`observations` table (ingest_queue at line 204, captured_item at line 229, facts at line 245, derivation_run at line 276) received ON DELETE CASCADE via debate #5 fix pass. `wiki_page_observe` was supposed to get it too — §8.4's reflection pseudocode at line 1271 explicitly comments "derivation_run.observe_id and wiki_page_observe.observe_id also cascade (debate #3 schema)" — but the actual DDL at line 342 does NOT have CASCADE. This means `compost reflect` sensory GC will FOREIGN KEY fail the moment any sensory observation has an associated `wiki_page_observe` row, which is exactly the failure mode the v2.1 patch claimed to fix. The `skippedDueToFkViolation` counter in `ReflectionReport` (line 1241) will be non-zero in this scenario, and the DoD gate at line 1587 ("asserts... `skippedDueToFkViolation = 0`") will fail.

**Fix**: Add `ON DELETE CASCADE` to `wiki_page_observe.observe_id` in migration 0002.

### 2b. Drain transaction context binding bug

**Location**: §1.6, drain transaction SQL, lines 486-524; and §5.1 query SQL, line 1063

The drain transaction at lines 499-508 binds named parameters (`:observe_id`, `:source_id`, etc.) but the duplicate-enqueue pre-check at line 534 binds `:observe_id` — no structural issue here. However, the query rerank in §5.1 at line 1063 passes context IDs via spread `...(opts.contexts ?? [])` into the named-parameter bind object. The `better-sqlite3` API for named parameters does not accept positional-style spread into a named object — the context IDs are bound via positional `?` placeholders (line 1014) but the surrounding object spread at line 1063 puts them in a dictionary, which `better-sqlite3` ignores for positional params. This means `contextFilter` will always behave as if no context was set, silently — no error, just wrong results. This is a Phase 1 correctness bug that is specced into the pseudocode now.

**Fix**: Replace the context bind approach. Either use an array-form `.all([...positionalArgs])` or name the context params explicitly (`:ctx0`, `:ctx1`, etc.) in the dynamically-built `IN (...)` clause. The current spread into a named-param object is a no-op for the positional `?` markers.

### 2c. Quarantine threshold inconsistency: 5 vs 3 vs 6

**Location**: §1.6 line 540, §4.5 lines 889-892, §11 DoD line 1580

Three thresholds are cited for "poison pill" quarantine:
- §1.6 (outbox drain): "drain_attempts > 5" (line 540)
- §4.5 (extraction queue): "attempts == 3" → quarantine (line 890)
- §11 DoD test: "6 failed drain attempts on a malformed row" (line 1580)

The DoD gate says "6 failed drain attempts" but the implementation rule in §1.6 says "> 5" (i.e., on the 6th attempt). Those two are consistent. But §10.2 guardrail table at line 1538 says "attempts > 5 → quarantined" while the DoD test at line 1580 says "6 failed drain attempts" — again consistent. The real inconsistency is between outbox drain threshold (> 5) and extraction queue threshold (== 3). §4.5 line 895 explicitly calls this "deliberate asymmetry" with a rationale, which is fine — but the DoD at line 1580 only tests the outbox path (drain_attempts > 5 → 6 attempts). There is no DoD item for the extraction queue quarantine path (attempts == 3). Any implementation could ship the extraction quarantine at the wrong threshold with no DoD catch.

**Fix**: Add a DoD item: "`compost doctor --drain-retry` on a queue row with 3 failed extraction attempts → quarantined; `compost doctor --quarantine-purge` releases it."

---

## 3. New Issues Introduced by the Patch

### 3a. `transform_policy.extraction_timeout_sec` referenced but never declared

**Location**: §4.5 line 881

The timeout table says "per-policy override via `transform_policy.extraction_timeout_sec`." This field does not exist in the TypeScript `policies` record in §2 (lines 556-570). The only keys defined are `chunk`, `embedding`, `factExtraction`, `wikiSynthesis`, `dedup`, `normalize`, `factDecay`. `extraction_timeout_sec` is neither there nor in `policies` SQL columns (lines 299-307). The v2.1 patch introduced §4.5 as new content but forgot to add this field to the canonical policy shape in §2.

**Fix**: Either add `extraction_timeout_sec?: number` to the §2 TypeScript policy record (and default it to 120 if absent), or change §4.5 to say "120s hardcoded default, no per-policy override in Phase 0."

### 3b. `compost doctor --quarantine-purge` listed in §14 but absent from DoD and CLI command list

**Location**: §14 line 1688, §0 CLI list lines 131-143, §11 DoD

§14 open question 8 references `compost doctor --quarantine-purge <id>` as a CLI command. §0 lists all CLI subcommands — the list does not include `--quarantine-purge`. §11 DoD does not test it. The v2.1 patch added this to open questions but neglected to either spec it properly (as a real Phase 0 command) or explicitly defer it (as "Phase 1, not in Phase 0 DoD"). It is currently in limbo: mentioned as if it exists, but not defined.

**Fix**: Either add `compost doctor --quarantine-purge <queue-id>` to the §0 CLI list and a DoD item, or add a parenthetical in §14 Q8 "Phase 1 — not in Phase 0 DoD."

### 3c. `ranking_audit_log` write-path is outside the transaction but accesses transaction-scoped temp table context

**Location**: §5.1 lines 1082-1083

`writeAuditLog(reranked, ...)` is called via `queueMicrotask` — after the `db.transaction()` has returned and the temp table `query_candidates` has been dropped. If `writeAuditLog` needs any data from the temp table (e.g., per-candidate `semantic_score` to populate the `w1_semantic` column in `ranking_audit_log`), those scores must already be present in `reranked`. They are — the query SELECTs them into the result rows. So the audit write itself is safe. However, there is a subtlety: the `queueMicrotask` write is outside the transaction, meaning it uses a DIFFERENT implicit transaction. If the process crashes between `return reranked` and the microtask executing, audit rows are lost. The spec does not acknowledge this — it calls the write "fire-and-forget" (line 1069) but does not explain what "fire-and-forget" means for the audit log's integrity expectations. If audit data is supposed to support Phase 3+ ranking calibration, silently losing it on crash is a correctness hole.

**Fix**: Add a note that `ranking_audit_log` rows are best-effort (not crash-safe) in Phase 1, and that Phase 3 must tighten this if calibration accuracy depends on it. Currently the spec is silent on this reliability class.

---

## 4. Cross-Reference Consistency

| Reference | From | Defined in | Mismatch |
|---|---|---|---|
| `skippedDueToFkViolation = 0` DoD gate | §11 line 1587 | §8.4 `ReflectionReport` line 1241 | Consistent on the field name. But §8.4 line 1271 claims `wiki_page_observe` cascades; §1.2 line 342 does NOT have CASCADE. The DoD gate will catch this in tests, but only if the test inserts a `wiki_page_observe` row for a sensory observation — the spec does not require that. |
| `compost doctor --quarantine-purge` | §14 line 1688 | §0 CLI list | Missing from CLI list. §10 guardrail table at line 1433 mentions `--drain-retry` but not `--quarantine-purge`. |
| `extraction_timeout_sec` | §4.5 line 881 | §2 policy TypeScript shape | Field does not exist in §2's canonical policy record. |
| Phase of `compost.feedback` | §6 line 1135 says "Phase 1"; §0 CLI list line 142 says "Phase 1"; guardrail table §10 line 1462 says `ranking_audit_log` write rule references feedback implicitly | Consistent after v2.1 patch clarified this | No mismatch — v2.1 fix is correct here. |
| `3b.4` section numbering | §3b.4 (lines 777-793) appears AFTER §3b.5 (lines 733-776) | Sequential numbering convention | §3b.5 appears before §3b.4 in the file. Out-of-order section numbers. Not a logic error but will confuse implementers cross-referencing by section ID. |
| `compost doctor --drain-retry` threshold | §10 guardrail table line 1433: "drain_attempts > 5"; DoD §11 line 1580: "6 failed drain attempts" | §1.6 line 540 | Both are consistent (> 5 means 6th attempt triggers it). No mismatch. |
| `ranking_profile` seeded in migration vs. startup | §1.4 line 401: INSERT seeded in SQL migration itself | §11 DoD line 1597: "seeded... on first daemon startup" | Minor: migration seeds it unconditionally at migration-apply time, not at daemon startup. DoD wording is slightly wrong — the seed happens during schema:apply (install.sh line 1402), not daemon start. Not a bug, but the DoD test for this will pass vacuously on first daemon start since the row is already there. |

---

## 5. Personal Sign-Off

I would not approve this for coding today — but I'm close. The `wiki_page_observe` missing CASCADE is a verified bug: the spec's own pseudocode (§8.4) asserts this cascade exists and the DoD gate tests for zero FK violations, but the actual DDL does not have it, meaning every reflect run that touches a sensory-sourced wiki-linked observation will fail the gate. That is a one-line DDL fix, not an architectural debate, and it needs to land before the first engineer writes the migration file. The context-binding bug in the §5.1 query pseudocode is Phase 1-active code, not Phase 0, so it cannot block Phase 0 ship — but it should be corrected in the spec now while the pseudocode is being read by implementers, not discovered during Phase 1 debugging. The `extraction_timeout_sec` phantom field is a spec consistency error introduced by the v2.1 patch itself. These three fixes are mechanical. The cognitive architecture is well-thought-out, the crash-recovery matrix is thorough, the FK cascade story (except wiki_page_observe) is sound, and the stateless decay formula is correctly isolated from rebuild identity. Fix the three items above, verify §1.2 DDL vs. §8.4 prose alignment explicitly in the DoD, and this is ready.
