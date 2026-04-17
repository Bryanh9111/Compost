### Q1 — MODIFY
Lines 13-17 make the audit the decision point for truncate/downgrade/fail-fast, so replacing it with "let INSERT fail" removes the policy input and turns the first CHECK violation into control flow.
Keep the audit, but collapse it into a preflight query executed immediately before migration rather than a long-lived standalone step: `SELECT SUM(origin='compiled') AS compiled_count, SUM(length(content) > 2000) AS long_count, SUM(origin='compiled' AND pinned=1) AS compiled_pinned_count FROM memories;`.
Then, if the chosen policy is "migrate", run `BEGIN IMMEDIATE; CREATE TABLE memories_v2 (...); INSERT INTO memories_v2 (...) SELECT ... FROM memories; DROP TABLE memories; ALTER TABLE memories_v2 RENAME TO memories; COMMIT;` as one transaction so any CHECK failure rolls back the whole swap.

### Q2 — REJECT
Judged against lines 19-24, `unpin()` is introduced only to clean migration-era `origin='compiled'` pollution, so a permanent store/CLI/MCP API is too much surface area for a one-off repair.
Do the repair as migration-local SQL inside the same transaction as the table swap: `BEGIN IMMEDIATE; UPDATE memories SET pinned=0 WHERE origin='compiled' AND pinned=1; SELECT changes(); CREATE TABLE memories_v2 (...); INSERT INTO memories_v2 ... SELECT ... FROM memories; DROP TABLE memories; ALTER TABLE memories_v2 RENAME TO memories; COMMIT;`.
If long-term user-visible unpinning is later desired, add it as a separate product decision with its own semantics and tests rather than smuggling it in under migration.

### Q3 — SUPPORT
For the checklist order at lines 34-39, DDL before invariant tests is the realistic boundary because Python can only introspect the schema that `init_db` actually creates, and a DSL-first test does not validate the real migration/trigger/FTS behavior.

### Q4 — REJECT
If Q4's scope is the inclusive list at lines 65-67, `~250 LoC` is materially low because it omits the real cost of atomic migration scaffolding, rollback, explicit FTS rebuild, CLI/MCP wiring, and benchmark/test code.
Re-baseline v3.3 as a narrow migration slice: step 0 preflight + one-transaction DDL/migration/rollback + invariant tests at roughly 300-450 LoC, with the migration explicitly containing `BEGIN IMMEDIATE ... COMMIT` and `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')` after the table rename.
Move WAL tuning, cold-cache benchmarking, Repository abstraction, kind-lint changes, and recall-miss logging into later slices with their own budgets.

### Q5 — MODIFY
Lines 69-71 describe prerequisites that are mostly outputs of the implementation itself, so a "6 choose 4" gate is self-referential rather than dependency-driven.
Replace it with hard entry criteria for step 2 only: step 0 preflight counts recorded, an explicit policy chosen for violating rows, and migration SQL reviewed to run as one `BEGIN IMMEDIATE` transaction with `CREATE ... INSERT ... DROP ... RENAME` plus `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`.
Treat README/CONTRIBUTING updates, Repository abstraction, and WAL benchmarks as exit criteria or follow-up steps, and if a checkpoint is desired in WAL mode run `PRAGMA wal_checkpoint(TRUNCATE)` only after the migration commits, not as a precondition.

## Codex 独家警告
- External-content FTS5 will not repopulate itself after a table-copy migration; once the new `memories` table and triggers exist, run `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')` explicitly or recall will silently miss rows.
- `CREATE TABLE` + `INSERT ... SELECT` + `DROP TABLE` + `ALTER TABLE ... RENAME` must live inside one `BEGIN IMMEDIATE ... COMMIT`; splitting them across autocommit boundaries risks a crash leaving `memories`, `memories_v2`, and triggers out of sync.
- Under WAL, schema changes are still transactional and sit in the WAL until commit/checkpoint; do not checkpoint mid-migration, and only consider `PRAGMA wal_checkpoint(TRUNCATE)` after commit if you want to compact the WAL.
