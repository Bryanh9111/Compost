# Debate 026 — Round 1: Sonnet (Pragmatic Implementer)

**Persona**: The person who ships this, debugs it at 2am, and explains to the user why `compost reason` stopped producing chains last Tuesday.

---

## Q1 — Seed Selection: Vote (c) recently-active subjects, with a noise guard

**Vote: (c)** with explicit de-noise for import surges.

**(c) is the only option that works without bootstrapping new infrastructure.** `gap-tracker.ts:86-95` confirms `ask_count` exists, but the context notes "open_problems: 待统计 (gap-tracker 在 ledger 中跑)" — meaning real ask_count data volume is still unknown. Option (a) could fire zero seeds if the instance is young. Option (b) needs 4 confirmed chains for ANN k-NN to produce meaningful signal — we have exactly 4, which is the minimum, not a comfortable margin. If one gets archived or re-judged, the bootstrap floor collapses.

**Implementation for (c):** one SQL query (`SELECT subject, COUNT(*) FROM facts WHERE created_at > ? GROUP BY subject ORDER BY COUNT DESC LIMIT 3`) — no new tables, no vector math. ~2h: query + de-noise heuristic (cap import-burst by adding `AND observe_id NOT IN (SELECT observe_id FROM observations WHERE adapter = 'engram-pull')` or a surge-detection threshold). The "614 facts in one import" gotcha the context warns about is real: without this guard, every scheduler cycle for weeks after an Engram pull will hammer Engram-origin subjects.

**What (a) misses:** `resolveSeed()` at `reasoning.ts:175-179` already handles `seed.kind === "gap"`, so wiring is there — but if `open_problems` table has 0 rows with `ask_count >= 2`, the scheduler produces zero seeds silently. That silent-zero is a production observability hole. **(b) misses:** local maximum trap — if all 4 confirmed chains happen to be about zyloapp internals, the scheduler loops on zyloapp forever. **(d)** is the right long-term target but 3x the implementation surface — wrong scope for MVP. **(e)** optimizes a metric users don't see; the scheduler could be churning graph density in an area the user has never visited.

**Effort:** (c) with noise guard ~3h. (a) ~2h but risk of silent-zero. (b) ~4h (ANN pipeline plumbing, risk of local maximum). (d) ~8h. (e) ~4h but wrong signal.

---

## Q2 — Cadence: Vote (p) fixed 6h, independent ticker

**Vote: (p)** fixed 6h, max N=3, independent ticker.

**Implementation:** copy the `startReflectScheduler` pattern from `scheduler.ts:104-153` — same `while(running)` + `Bun.sleep(intervalMs)` shape. New export `startReasoningScheduler`. The `intervalMs` test-override pattern (line 89-93) is already established; one new constant `REASON_INTERVAL_MS = 6 * 60 * 60 * 1000` and a `maxChainsPerCycle = 3` cap. ~3h total.

**The 2am gotcha for (q):** `startReflectScheduler` at line 116-122 swallows reflect errors with `continue` — adding reasoning inside that same loop means a reflect crash silently also kills the reasoning cycle. You'd spend 2am debugging "why aren't any chains appearing" and the answer is "reflect errored three weeks ago." Coupling two LLM-heavy operations into one timer also means the test suite fixture for reflect timing (pass small `intervalMs`) now also races against a 60-90s LLM call per cycle.

**(r) adaptive:** the confidence spread is currently 0.84 (mean_confirmed=0.94, mean_rejected=0.10) — good calibration. But `getVerdictStats()` at `reasoning.ts:754-794` is a full-table scan with no index on `user_verdict`. Under adaptive cadence it runs every cycle to decide the next sleep duration. That's fine now at 12 rows, but adds technical debt. More critically, the 80% acceleration threshold can trigger during a burst of user engagement (user judges 5 chains in a weekend), then the scheduler kicks into 3h cadence, produces 6 more chains on Monday, user hasn't touched them, `unjudged` climbs — and the cadence never naturally decelerates. The logic has a ratchet asymmetry. ~8h to implement and test the state machine properly.

**(s) idle-only:** macOS lid-close kills the daemon. No idle signal to poll. Dead on arrival for this hardware target.

**Effort:** (p) ~3h. (q) ~2h but coupling risk. (r) ~8h. (s) not viable.

---

## Q3 — Quality Gate: Vote (ii) static threshold, per-cycle skip

**Vote: (ii)** static threshold, per-cycle skip only.

**Implementation:** before each cycle, call `getVerdictStats(db)`, compute `rejected / judged` for the most recent N judged chains. If `>= 0.5`, log a warning and skip this cycle — no state write, no pause. ~2h: the helper is already at `reasoning.ts:754-794`, just add a guard block at the top of the reasoning loop.

**Bootstrap-period gotcha for (ii):** the context flags it — "近 10 条 judged" might not exist yet. The fix is simple: `if (judgedCount < 5) { skip gate entirely }`. This is a one-liner guard, not an architectural change. Without it, the gate is permanently disabled during bootstrap, which is fine — you want the scheduler running until you have enough data to gate on.

**Why not (iv) two-layer:** the soft + hard combination is conceptually right but the "consecutive_skipped_cycles" counter requires either in-memory state (lost on restart, violates Q4 intent) or a DB write per cycle. If you write it to DB (migration 0020), you've also added a schema bump for what is essentially a counter. More testable surface area, more migrations to maintain. Get (ii) working first, promote to (iv) in debate 027 once you have real cooldown data.

**Why not (iii) manual resume:** "user may forget to resume, scheduler permanently dead" is not a hypothetical — it will happen. A single-user personal tool that requires manual intervention to un-pause is a support ticket waiting to happen, except the user files it against themselves six weeks later.

**Effort:** (i) ~0.5h but no protection. (ii) ~2h with bootstrap guard. (iii) ~3h, UX risk. (iv) ~5h, overkill for MVP.

---

## Q4 — State Persistence: Vote (A) migration 0020

**Vote: (A)** single-row `reasoning_scheduler_state` table.

**Implementation:** one new migration file, one new table with 6 columns. The schema is fully specified in the context. Read/write from the same `db: Database` handle the rest of the daemon uses. ~2h: migration + typed read/write helpers + test fixture seeding.

**The cross-process gotcha for (B):** `scheduler.ts` and the CLI both get their `db` from the same SQLite WAL file, which handles concurrent readers fine. A JSON file at `COMPOST_DATA_DIR/reason-scheduler-state.json` has no equivalent concurrency story — if `compost reason scheduler pause` is called while the daemon is mid-cycle-read, you get a partial JSON write and the daemon crashes next startup trying to parse it. SQLite WAL makes this a non-issue.

**(C) in-memory:** the debate itself calls out the fatal flaw. If the daemon restarts during a quality regression pause, the scheduler resumes immediately and burns LLM on bad seeds. Not acceptable once (r) from Q3 is in place.

**(D) generic kv table:** context confirms no such table exists (grep verified). Building it to avoid a migration is more work than the migration itself. Pure overhead.

**Effort:** (A) ~2h. (B) ~1h but concurrency risk. (C) ~0h but wrong. (D) ~3h to build the generic layer, then use it.

---

## Q5 — User-Facing Surface: Vote (II) CLI + read-only MCP

**Vote: (II)** CLI full control, MCP status-only.

**Implementation:** three CLI subcommands (`status`, `pause`, `resume`) that read/write the migration 0020 table from Q4. One MCP tool `compost.reason.scheduler.status` that calls the same read path. ~3h: CLI wiring + MCP registration + help text.

**The agent-mis-pause gotcha for (III):** `reasoning.ts:720-744` shows `setVerdict` is idempotent and safe for agent callers. But a `pause` is not idempotent in the same way — it changes the scheduler's running state globally, and `resume` requires a separate intentional act. An agent that reasons "rejected_rate is high, I should pause the scheduler" and calls `compost.reason.scheduler.pause` is doing the right thing for the wrong reason: the quality gate (Q3) already handles that, and the agent double-pause creates a situation where neither the gate nor the user realizes the scheduler is dark. The asymmetry between agent-pause (easy, auto-triggered) and user-resume (requires user to notice + act) is exactly the silent-death scenario.

**What (I) misses:** agents legitimately want to read scheduler state for diagnostics — "is the scheduler paused? when was the last cycle?" is a natural part of a `compost reason stats` flow. Blocking that read for no benefit adds friction without safety gain.

**Effort:** (I) ~2h. (II) ~3h. (III) ~3h but agent-pause risk makes it a net negative.

---

## Overall Verdict

The MVP is 5 independent decisions that each have a clear 3-8h implementation path using existing patterns from `scheduler.ts` — build them in sequence, not in parallel, and the combined surface is testable with time-injection and fake LLM in under a day.
