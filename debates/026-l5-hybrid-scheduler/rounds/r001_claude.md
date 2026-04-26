# 🐙 Claude (Opus) — Round 1

## Q1 (Seed source) — vote: **(a) High ask_count gaps only**

**+ Opus addition**: cap selector to gaps WHERE `last_asked_at > now-30d` (not all-time). Prevents stale 6-month-old gaps from dominating after engram-pull bursts.

(a) is the only option whose signal **does not self-confirm**: ask_count is incremented by `gap-tracker.ts:86-95` at each unanswered query — a real user pulling on the bell, independent of any prior reasoning chain. (b) verdict-similarity is elegant but creates a bootstrap of "the brain only thinks about what it's already shown it can think about" — local maximum exactly when we want the brain to surprise the user. (c) recently-active subjects has the engram-pull contamination Sonnet will confirm: 614 facts in one batch ≠ user activity. (d)/(e) are complexity bombs for MVP. **Defer (b) to v2 once we have ≥30 confirmed chains; defer (c) once we have an "import-burst" detector.**

## Q2 (Cadence) — vote: **(p) Fixed 6h, max N=3**

(r) adaptive verdict-driven sounds principled but double-counts the verdict signal — Q3 is already the verdict-feedback channel for the *hard* gate. Adding it to cadence too means a single bad week can both pause AND extend cooldown, debugging nightmare. (q) couples reflect — reflect already does wiki rebuild + LLM, adding 3 more LLM calls inflates a single tick from ~30s to ~5min and any reflect failure now stalls reasoning. (s) idle-only fails on closed laptop. **(p) is boring and predictable; predictability is the right virtue for v1.**

## Q3 (Quality gate) — vote: **(iii) Verdict-driven cooldown + manual resume**

**+ Opus modification**: auto-resume after 7 days OR manual resume, whichever first. Pure manual resume risks the user forgetting and the brain going dark forever. Pure static-skip (ii) lets a degraded LLM keep retrying on every cycle. (iv) double-layer is over-engineered for v1 — we don't have data to set both thresholds.

Threshold: `getVerdictStats()` over recent 10 judged chains; if rejected_rate ≥ 50%, write `paused=true, paused_reason='verdict cooldown: N/M rejected'` and stop scheduled cycles. Manual `compost reason scheduler resume` clears it. Auto-resume tick: scheduler reads paused_at; if (now - paused_at) > 7d, auto-clears + logs "auto-resumed after 7d cooldown".

## Q4 (State) — vote: **(A) Migration 0020 single-row table**

Easiest decision in this debate. `reasoning_scheduler_state` 1 row, `paused BOOLEAN, paused_reason TEXT, paused_at TEXT, last_cycle_at TEXT, last_cycle_stats_json TEXT`. SQLite WAL = cross-process safe; backup/restore zero-special-case; verdict stats already in same DB so the cooldown query is local. (B) JSON file = two truths (SQLite ledger vs JSON) and `compost backup` would need explicit handling. (C) in-memory loses cooldown across restart — exactly the wrong direction. (D) needs a generic kv table that doesn't exist; **building a kv table is heavier than just writing 0020 directly**.

## Q5 (Surface) — vote: **(II) CLI + read-only MCP**

Pause/resume are user-policy decisions, not agent-policy. Agent reading `compost.reason.scheduler.status` lets it warn the user ("scheduler has been paused for 4 days due to verdict cooldown — review chains?") which is brain-like. Agent triggering pause = silent failure mode where the user thinks reasoning is happening but isn't. Symmetric with the verdict surface: agent can read stats, but only the user writes verdicts that reshape policy. **Trust boundary preserved: agent observes, user steers.**

## Overall verdict

**(a) + (p) + (iii)+auto-resume + (A) + (II)** — boring, debuggable, single-source signals, clean trust boundary; defers every "smart" alternative to v2 with explicit promotion criteria.

## False premises flagged

- Q2 (r) framing assumes cadence and quality-gate are separable variables; they're the same verdict signal applied at different time scales. Picking (r) AND (iii)/(iv) is the same mechanism twice.
- Q1 (c) "Recently-active subjects" pretends `created_at` reflects user activity; engram-pull writes 600 facts at one timestamp, so this signal is ~2 orders of magnitude noisier than (a) ask_count.
