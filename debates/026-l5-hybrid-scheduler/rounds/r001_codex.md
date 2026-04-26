## Q1 — Seed Selection Source

**Vote: (c) Recently-active subjects.**

Implementation reality knocks out (a) as the first MVP source: live ledger has 7 open gaps but `open_gaps_ask2=0`, so `ask_count >= 2` would currently produce no work. Also, the gap schema comment says re-asking a dismissed question creates a new row, but `question_hash` is unique and `logGap()` updates the existing row without changing status; code reality is `UPDATE ... ask_count = ask_count + 1 ... WHERE problem_id = ?` at [gap-tracker.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/gap-tracker.ts:84), while the stale schema comment is at [0016_open_problems.sql](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/schema/0016_open_problems.sql:12). (b) is strategically attractive but not an MVP primitive: `VectorStore` supports text search and precomputed vector search, not "confirmed seed SPO embedding -> unreasoned fact kNN" as a ready scheduler interface ([lancedb.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/storage/lancedb.ts:76), [lancedb.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/storage/lancedb.ts:100)). Risk: (c) must suppress bulk-import surges, because Engram previously collapsed hundreds of entries into dense project subjects ([ingest-adapter.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-engram-adapter/src/ingest-adapter.ts:76)).

## Q2 — Cadence

**Vote: (p) Fixed 6h, max N=3.**

(q) conflicts with HC-8 and code reality: `startReflectScheduler()` already couples reflect -> triage -> optional wiki synthesis, and reflect failure skips the rest of that cycle ([scheduler.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-daemon/src/scheduler.ts:104), [scheduler.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-daemon/src/scheduler.ts:120), [scheduler.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-daemon/src/scheduler.ts:135)). (r) is a good follow-up, but current verdict stats are global aggregates, not recent-window cadence inputs ([reasoning.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/reasoning.ts:754)). (s) needs a new idle detector, while the daemon already has independent loop patterns with injectable intervals ([scheduler.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-daemon/src/scheduler.ts:33), [scheduler.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-daemon/src/scheduler.ts:159)).

## Q3 — Quality Gate / Cooldown

**Vote: (iv) Static gate + verdict cooldown双层.**

No gate is unacceptable because `runReasoning()` persists failed/no-chain rows as active chains with `failure_reason`, so a bad model can fill the table without derived-link writeback ([reasoning.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/reasoning.ts:567), [reasoning.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/reasoning.ts:594)). A pure manual pause risks permanent product death, but a pure soft skip can silently loop forever. Implementation caveat: do not use current `getVerdictStats()` directly for "recent N"; it scans all chains ([reasoning.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/reasoning.ts:760)), so scheduler needs a recent-judged helper ordered by `verdict_at` or `created_at`.

## Q4 — State Persistence

**Vote: (A) Migration 0020 + single-row `reasoning_scheduler_state`.**

State belongs in SQLite because the scheduler must coordinate with CLI/MCP and survive daemon restart; in-memory loses the very cooldown signal Q3 depends on. JSON creates a second truth outside the ledger backup path, while existing code already opens the ledger in WAL mode for shared CLI/daemon access ([reason.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-cli/src/commands/reason.ts:28)). I found no existing generic `daemon_kv`/`system_state`; adding one now is larger schema surface than the purpose-built row.

## Q5 — User-Facing Surface

**Vote: (II) CLI + read-only MCP.**

Scheduler pause/resume is operator control, not agent autonomy. Existing MCP already exposes write-capable reasoning and verdict tools ([mcp-server.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-daemon/src/mcp-server.ts:691), [mcp-server.ts](/Users/zion/Repos/Zylo/Compost/packages/compost-daemon/src/mcp-server.ts:775)); adding MCP pause/resume would create a hidden coupling where an agent can stop the brain and the user may not notice. Read-only MCP status is enough for agents to explain why no proactive chains appeared.

**Overall verdict:** Ship the smallest independent scheduler: recently-active subject seeds, fixed 6h/N=3 cadence, two-layer cooldown, SQLite state, CLI control plus MCP status only.
