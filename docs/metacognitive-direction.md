# Compost Metacognitive Direction (v4 turn)

> **Authored**: 2026-05-02
> **Supersedes**: Phases 5-7 wisdom-extraction trajectory
> **Related**: ROADMAP.md "Strategic Direction v4" subsection
> **Plan-of-record**: maintainer's local plan file (kept outside this repo)
> **Engram seal**: pinned decision (id assigned at write time, see References)

---

## 1. Why this direction

After extensive product calibration on 2026-05-01/02, the user (single-user owner of this MIT fork-template project) clarified that Compost was being built in the wrong direction. The fact-library + LLM wisdom-extraction trajectory of Phases 5-7 was a category error — not because the engineering was broken, but because Compost was being asked to play a role that the user already had **other tools** for.

Direct user quotes (preserved verbatim for traceability):

> "我不需要他有'知识', 而是需要他知道做过什么, 在哪, 然后我的每个行为"
>
> "他不像 engram 一样只记'记忆', 而是他能知道我做过了什么"
>
> "我有没有记到 engram, 该不该从 obisidian 去查知识"
>
> "compost 不做纯元记忆模式, 而是元记忆为主, wisdom (LLM 推断) 为辅"

The reframe (locked 2026-05-02):

> **Compost = 跨系统行为账本 + 元记忆索引 + 行为模式引擎 (主) + 按需 LLM 合成回答 (辅)**

In English: Compost is the metacognitive layer **above** the existing knowledge-bearing tools (Engram, Obsidian, git, claude-mem). It does not produce knowledge; it knows where the knowledge lives and surfaces what the user did. When the user explicitly asks for synthesis, it can use LLM at query time — but never persists synthesis as fact, never schedules wisdom production in the background, never expects the user to be a verdict labeller.

This direction is right for **this specific user** (single-user, 10+ year horizon, has Obsidian + Engram + git + claude-mem already). It would be wrong for a knowledge worker without those upstream tools — they'd need a knowledge base. The user has one (several, actually). They needed the layer above.

## 2. The 4-stream existing toolchain (what gap Compost actually fills)

Before v4, the user's digital cognition stack was:

| Stream | Tool | Strength | Weakness |
|---|---|---|---|
| **Atomic memory** | Engram | constraint/decision/guardrail/baseline, cross-session, FTS5 + scope | doesn't track action timeline, no coverage audit |
| **Knowledge graph** | Obsidian (multiple vaults: XHS, GitWiki, Constellation) | curated knowledge, double-linked, manual taxonomy | not auto-captured, no cross-vault index |
| **Code state + commit history** | git | full code-change provenance, commit messages = intent | non-code work (chat, docs, exploration) invisible |
| **Session continuity** | claude-mem | per-session timeline, automatic capture | only inside Claude Code, no cross-tool |

**The actual gap** Compost fills (and v4 makes explicit):

1. **No cross-system unified action ledger** — "what did I do today as a person across all tools" can't be answered without manually compiling 4+ sources
2. **No coverage audit** — "did I record this insight in Engram, ROADMAP, Obsidian?" requires checking each system manually
3. **No routing intelligence** — "this question belongs in Obsidian XHS vault, not Compost" — currently lives only in user's working memory
4. **No behavior pattern detection** — "you tend to do X on Y day" — currently zero data backing the user's intuitions about their own habits

These four gaps are what the metacognitive turn addresses. None of them is a knowledge-creation problem; all of them are knowledge-about-knowledge problems.

## 3. What we tried and learned (Phases 5-7 trial path)

This section preserves the trial-and-error history so this turn doesn't look like an arbitrary scope cut to a future reader / fork user / 6-months-later self. Every Phase 5-7 deliverable produced legitimate engineering insight that informs v4, even when the deliverable itself is now frozen.

### Phase 5 — Engram integration + ingest pipeline (✅ valid in v4)
- compost_observe / outbox / drain / SPO extraction → ledger pipeline. **Retained**: this IS the action capture foundation v4 builds on.
- Engram bidirectional channel (engram-pull adapter for facts; engram-flusher for write-back) — valid; v4 keeps it.
- Lesson preserved: PII scrubber, breaker registry, transform_policy versioning are sound infrastructure regardless of layer above.

### Phase 6 — Curiosity / gap tracker (🚧 reframed)
- Curiosity & gap detection were originally framed as "things Compost doesn't know yet". v4 reframes as "things the user did but didn't record" — same engine, different semantic.
- Crawl approval workflow remains useful as a coverage-audit primitive (low priority but not deleted).

### Phase 7 — L5 reasoning + verdict + dogfood (❄️ frozen)
- `reasoning_chain` table, `compost reason` CLI, hybrid scheduler (debate 026), verdict CLI (S662 decision) — **all functional, all frozen as background production**.
- 26 reasoning chains exist as historical data. 25 verdict-labelled (13 confirmed, 2 refined, 10 rejected). This dataset is preserved and continues to be queryable.
- **Lesson preserved**: debate 024's finding that LLM self-evaluation is unreliable is layer-agnostic — applies to any future LLM-as-judge effort. The Engram saturation insight memory `92dea01288b5` keeps that lesson live.
- **Lesson preserved**: dogfood preparation (5 projects ingested, +635 facts, launchd 7d routine) demonstrated bulk ingest path works at ~5min/463 files. The 7d routine itself is unloaded — measuring chain growth + verdict similarity is no longer a meaningful signal in v4.

### Quality bench (LLM-as-judge over wiki) — ❄️ frozen with documented saturation
- `bench/quality.bench.ts` + initial baseline `bench/baseline-quality.json` (commit fab7693).
- 9/9 judgments returned coverage=100/faithfulness=1.0/hallucinations=0 with stddev=0 → judge-prompt saturation. Documented in baseline `saturation_flag.triggered=true` and Engram insight `92dea01288b5`.
- Frozen because the surface it measures (background wiki synthesis) is also frozen. If Phase 4 (b) scheduled batch wisdom revives, this bench infrastructure is the natural starting point.

### What didn't work and why (the meta-lesson)
The fact-library trajectory failed not because LLMs can't synthesize — they can — but because **synthesizing knowledge that the user already has elsewhere creates a fourth competing source of truth, not a unified one**. Engram knows constraints; Obsidian holds curated knowledge; git has code; Compost was producing reasoning chains and wiki pages that were either (a) duplicating Obsidian/Engram content or (b) introducing an unaudited fourth voice. Either way, cognitive load on the user goes UP, not down.

v4 inverts this: Compost only produces knowledge **about** the other three, not knowledge **competing** with them.

## 4. Wisdom scope clarification (this is the precise contract)

**Frozen in v4 (background wisdom production)**:
- `reasoning_chain` background generation by `startReasoningScheduler` — every 6h cycle that picked recently-active subjects and ran cross-fact reasoning through LLM.
- `synthesizeWiki` post-hook in reflect scheduler — every reflect tick attempted to synthesize wiki pages from accumulated facts.
- Verdict feedback loop — manual user labelling that fed retrieval β/γ tuning of reasoning chains.
- Dogfood-7d launchd routine — measured chain growth + verdict similarity.
- `quality.bench.ts` LLM-as-judge over wiki output.

**Preserved in v4 (on-demand wisdom retrieval)**:
- `compost ask <question>` — user-triggered LLM synthesis over the metacognitive ledger; answer returned ephemerally, NOT persisted as fact, NOT scheduled, NOT auto-captured.
- This is the precise contract: synthesis happens only when user explicitly requests it, with a question. The answer dies after delivery (no fact written, no chain stored, no wiki page generated).

**Phase-ordered wisdom roadmap** (sequential, NOT parallel — each phase gates the next):

| Phase | Wisdom type | Description | Earliest start |
|---|---|---|---|
| **Phase 1 (now)** | (a) On-demand `compost ask` | User-triggered LLM synthesis over current ledger. Already implemented. | Active |
| **Phase 2-3** | Capture expansion | zsh / git / Obsidian hooks → ledger gets richer. (a) gets richer source data. | Week 2 |
| **Phase 4** | (b) Scheduled batch wisdom | Weekly/monthly LLM scan produces "this week your habits / cross-tool pattern" digest. Read by user, NOT persisted as fact. | Month 3-6 |
| **Phase 5** | (c) Real-time contextual | When user does X, system proactively notes "this is similar to Y you did 3 weeks ago, that resulted in Z". Requires push UX design. | Month 6-12 |

Phase 4 is where `quality.bench.ts` infrastructure naturally revives. Phase 5 is where verdict-style ground truth feedback might re-enter (because real-time push needs accuracy guarantees).

## 5. Sunset / freeze list (with file:line references)

| Item | File:line | Action | Rationale |
|---|---|---|---|
| `startReasoningScheduler` invocation | `packages/compost-daemon/src/main.ts:151` | Comment out, replace with no-op `Scheduler` stub. Import removed from line 6 (with revival comment). | Background reasoning_chain generation halted; on-demand `compost ask` preserved. |
| `synthesizeWiki` reflect post-hook | `packages/compost-daemon/src/scheduler.ts:159` | Env-gated behind `WIKI_SYNTHESIS_ENABLED=true` (default false). | Background wiki page synthesis halted; on-demand wiki retrieval+synthesis via `compost ask` preserved. |
| Verdict CLI command description | `packages/compost-cli/src/commands/reason.ts:187` | Description prefixed with `[FROZEN v4 turn 2026-05-02]`; command remains functional for historical 26 chains. | Verdict was ground-truth feedback for background reasoning_chain calibration; without that scheduler, verdict CLI is for historical access only. |
| Quality bench top docblock | `bench/quality.bench.ts:1` | Add FROZEN docblock paragraph; bench code unchanged. | Bench measures wiki synthesis quality; wiki background synthesis frozen. Preserved for Phase 4 revival. |
| Quality baseline frozen flag | `bench/baseline-quality.json` (top) | Add `frozen: true / frozen_at / frozen_reason` fields. | Mirrors bench freeze. |
| Dogfood launchd routine | `~/Library/LaunchAgents/com.zion.compost-dogfood-7d.plist` | `launchctl bootout` + `rm` symlink. | Measured chain growth + verdict similarity, no longer meaningful signals in v4. (Plist source already removed in commit bd8fc93 for public security.) |
| zsh helpers `cchains` / `cstats` | `~/.zshrc:407-419` | Prepend FROZEN banner echo on each invocation. Function bodies retained. | Helpers target reasoning_chain layer; users running them should see deprecation. |
| `reasoning_chains` table | `~/.compost/ledger.db` schema | **Not modified** — 26 rows preserved as historical trial data. | Trial dataset is itself signal; deletion would erase the lesson. |
| `verdict` columns on `reasoning_chains` | same | **Not modified** — 25 verdicts preserved. | Same rationale. |
| Migrations 0017-0020 (reasoning chain + verdict) | `packages/compost-core/src/schema/` | **Not removed** — fork users may still encounter, schema must apply. | Removing migrations breaks `applyMigrations` for any fork that already created the schema. |

## 6. Success signals for v4 (review at intervals)

These are **observable signals**, not feelings. If at any review point the signals don't hold, escalate to user for direction-check.

### 30 days (target: 2026-06-02)
- [x] `action_log` schema design accepted and migrated (`0021_action_log.sql`, commit `fda433d`)
- [ ] PF-1 cross-repo dependency audit clean OR documented for any callers found
- [ ] Daemon plist restored (Deliverable 6); next macOS reboot does NOT silent-fail capture stack
- [ ] Outbox quarantine count = 0 sustained for 14 consecutive days (verifies Deliverable 3 codex fix)
- [ ] No regression: `compost ask "<test query>"` still returns LLM synthesis

### 90 days (target: 2026-08-02)
- [x] zsh + git + Obsidian capture hooks live, writing to outbox
- [x] `compost cover <topic>` coverage audit CLI works for at least 3 test queries (e.g., "did I record the v4 turn", "what did I work on last week", "which Obsidian vault has my XHS strategy notes")
- [ ] Pattern detection emits first behavior digest (sequential mining over action_log, NOT LLM-generated)
- [ ] User has used `compost ask` at least 3 times in real workflow (not just testing)

### 180 days (target: 2026-11-02)
- [x] `compost did <date>` / `compost did "this week"` can aggregate `action_log` rows by day, source, project, and artifact pointer
- [ ] User can answer "what did I do this week / month" from Compost alone in routine workflow (cross-system aggregated)
- [ ] User self-reports: "I no longer hand-track my work in Obsidian for retrospect purposes"
- [ ] Zero pivot-back urge from user (no "let's revive reasoning chain" requests)
- [ ] At least one cross-project pattern surfaced by Compost that user hadn't consciously noticed

If 30-day signals fail: pause; investigate; either fix or surface architectural blocker.
If 90-day signals fail: deeper review; consider whether v4 framing itself needs revision.
If 180-day signals fail: serious consideration of reverting parts of the freeze (esp. (b) Phase 4 batch wisdom may have arrived early).

## 7. action_log schema foundation

Phase 2 D2-1 landed the first schema foundation in `packages/compost-core/src/schema/0021_action_log.sql`. The DDL below is the concept shape; the migration is the authoritative contract.

```sql
-- Phase 2 D2-1 foundation

CREATE TABLE action_log (
  action_id TEXT PRIMARY KEY,                  -- uuidv7
  source_system TEXT NOT NULL,                 -- claude-code | codex | zsh | git | obsidian | manual
  source_id TEXT NOT NULL,                     -- session_id / commit_sha / shell_pid:line / file_path
  who TEXT NOT NULL,                           -- agent name | "user"
  what_text TEXT NOT NULL,                     -- short description
  when_ts TEXT NOT NULL DEFAULT (datetime('now')),
  project TEXT,                                -- compost | athena | quotaflow | onyx | etc.

  -- Where the canonical record(s) for this action live across other tools
  artifact_locations TEXT,                     -- JSONB: [{system: engram, memory_id, kind}, {system: obsidian, vault, path}, ...]

  -- What's been recorded, what hasn't
  coverage_audit TEXT,                         -- JSONB: {recorded_in_engram: bool, linked_in_roadmap: bool, in_obsidian: bool, ...}

  -- Optional routing hint surfaced when user queries similar topics later
  next_query_hint TEXT
);

CREATE INDEX idx_action_log_when ON action_log(when_ts DESC);
CREATE INDEX idx_action_log_project ON action_log(project, when_ts DESC);
CREATE INDEX idx_action_log_source ON action_log(source_system, source_id);
```

The relationship to existing `observations` / `facts` tables: those become **inputs** to action_log (raw events get processed into action records), not replacements. Existing pipelines continue to drain into observations and facts; a new processor (Phase 2 scope) lifts action-shaped records out into action_log.

## 8. Phase 1-5 roadmap with deliverables

### Phase 1 (Week 1, 2026-05-02 to 2026-05-08) — this commit
Plan-of-record: maintainer's local plan file (kept outside this repo; 7 deliverables).

Deliverables:
1. Lock direction in CLAUDE.md / AGENTS.md / ROADMAP.md / this doc
2. Sunset background wisdom production (5 surfaces frozen)
3. Codex task package: outbox payload tolerance (unblocks action_log foundation)
4. Engram memory updates (4a-4d): pinned v4 decision + supersede notes + sweep audit
5. (Originally) surface daemon plist ops issue
6. Daemon plist dual-file restoration (post-debate elevated to Week 1)
7. Memory-recall-hook v4 verification (post-debate added)

Review gate: 30-day success signals + verification checklist in plan file.

### Phase 2 (Week 2-4) — capture expansion
- zsh `preexec_functions` + `precmd_functions` hook → `compost capture zsh`
  → outbox/action_log — landed for the local operator. Commands are scrubbed
  with the existing hook-shim PII redactor before touching disk.
- git post-commit hook (global `~/.gitconfig` `core.hooksPath`) →
  `compost capture git` → outbox/action_log — landed for the local operator.
  Captures commit metadata (repo, SHA, branch, subject, author name) but not
  diffs or author email.
- Obsidian file watcher → `compost capture obsidian` → outbox/action_log —
  landed for the local operator. The watcher prefers `fswatch` when available
  and otherwise uses a polling fallback over configured vault roots. The
  polling path always treats its first startup scan as baseline-only, and state
  files use a readable prefix plus hash to avoid collisions on non-ASCII note
  paths.
- `action_log` schema design + migration (`0021_action_log.sql`) — landed
- Typecheck + full test baseline restored after D2-1 (`c00db8d`; `bun run typecheck`, `bun test` = 704 pass / 0 fail)
- Action processor: lift observations → action_log records — landed (`processObservationAction` / `processObservationActions`)
- D2-3 zsh capture slice: `compost capture zsh` CLI + local shell hook + action
  processor zsh normalization — landed (`bun run typecheck`, `bun test` =
  713 pass / 0 fail)
- D2-3 git capture slice: `compost capture git` CLI + local global
  `post-commit` hook + action processor git normalization — landed (`bun run
  typecheck`, `bun test` = 716 pass / 0 fail)
- D2-3 Obsidian capture slice: `compost capture obsidian` CLI + local watcher
  LaunchAgent + action processor Obsidian normalization — landed (`bun run
  typecheck`, `bun test` = 720 pass / 0 fail)
- D2-4 coverage audit slice: `compost cover <topic>` CLI + deterministic
  action_log/doc/artifact coverage reporting — landed (`bun run typecheck`,
  `bun test` = 725 pass / 0 fail). Verified live with:
  "did I record the v4 turn", "what did I work on last week", and
  "which Obsidian vault has my XHS strategy notes".
- D2-5 route slice: `compost route <question>` CLI + deterministic artifact
  routing — landed (`bun run typecheck`, `bun test` = 731 pass / 0 fail).
  Verified live with: "v4 turn coverage audit", "which Obsidian vault has my
  XHS strategy notes", and "what did I work on last week".
- D2-6 did slice: `compost did <date>` / `compost did "this week"` CLI +
  deterministic action timeline aggregation — landed (`bun run typecheck`,
  `bun test` = 737 pass / 0 fail). It groups `action_log` rows by UTC day,
  source system, project, and artifact pointer without using LLM synthesis or
  frozen background reasoning/wiki/verdict paths.
- D2-7 reconcile slice: `compost reconcile <date>` / `compost reconcile
  "this week"` CLI + daily 05:00 UTC `action-reconcile` daemon scheduler —
  landed (`bun run typecheck`, `bun test` = 744 pass / 0 fail). It reports
  missing Engram, Obsidian, git, and durable artifact pointers from
  `action_log` without mutating the ledger or reviving background
  reasoning/wiki/verdict paths.

Review gate: capture coverage > 80% of user's creation-type actions (estimated, not measured).

### Phase 3 (Month 2) — element CLI primitives
- `compost cover <topic>` — coverage audit ("Engram=yes, ROADMAP=yes, Obsidian=no") — landed in D2-4
- `compost route <question>` — "this answer lives in <vault Y>" — landed in D2-5
- `compost did <date>` / `compost did "this week"` — action time-window aggregation — landed in D2-6
- `compost reconcile <date>` / nightly `action-reconcile` daemon scheduler — missing-pointer audit comparing action_log vs Engram/Obsidian/git/durable artifacts — landed in D2-7

### Phase 4 (Month 3-6) — pattern detection + (b) scheduled batch wisdom
- `compost patterns <date|window>` — manual read-only deterministic action_log pattern MVP — landed after D2-7. It reports capture spread, work-rhythm hours, dominant projects, project switching, and adjacent source transitions with provisional/medium/strong confidence labels. It does not write `user_patterns`, reasoning chains, wiki pages, or Engram memories, and it is not a daemon scheduler.
- Sequential pattern mining over action_log (work rhythms, decision habits)
- Speech style stats over Claude Code / Codex prompts (n-gram, sentence structure, sentiment proxy)
- (b) Weekly batch wisdom: LLM scans action_log → "this week's pattern digest" (read-only, ephemeral)
- Possibly revive `quality.bench.ts` infrastructure here for batch-wisdom regression gates

### Phase 5 (Month 6-12) — (c) real-time contextual surfacing
- Trigger discipline: when does Compost push? Confidence threshold + relevance + push-frequency cap
- UX: where does push appear? Engram entry / claude-code session injection / explicit notification
- Possibly re-introduce verdict-style ground truth feedback for push accuracy

Review gate: at each phase, check 30/90/180-day signals from §6.

## 9. References

- **ROADMAP**: `docs/ROADMAP.md` "Strategic Direction v4 (2026-05-02 metacognitive turn)" subsection
- **Plan-of-record**: maintainer's local plan file (kept outside this repo; Week 1 implementation plan with 7 deliverables + 9 amendments + verification)
- **Engram memories** (written 2026-05-02 as part of this turn):
  - `88c0de87fea8` (pinned decision, kind=decision) — locking the v4 direction (4a in plan); SUPERSEDES Phases 5-7 wisdom-extraction trajectory
  - `a8a292013323` (pinned procedure) — anti-drift guidance "how to verify Compost in v4 framing" (4c in plan)
  - `df525f281ec4` (pinned decision) — v4 supersede note for `72df4feab550` (v3 identity "自进化大脑, 知识堆肥") — annotates the v3 identity entry so future recall reads them together
  - `79ce4ce25c20` (insight) — v4 supersede note for `92dea01288b5` (saturation insight); saturation finding remains layer-agnostic and still valid as historical trial data
  - `3d0c911642ea` (procedure) — v4 supersede note for `6e8fbcae48e6` (verdict batch-reject protocol); applies only to historical 26 chains
  - `570dd16580ce` (UNIQUE constraint runbook, NOT superseded) — daemon ops, still valid in v4 since action capture path unchanged
  - Pre-v4 prior entries kept as-is: `92dea01288b5` (saturation insight), `6e8fbcae48e6` (verdict protocol), `72df4feab550` (v3 identity) — read together with their respective v4 supersede notes
- **Prior session memory** (Engram): `9734e9dc61d5` (dogfood daily protocol — now superseded by v4 freeze), `cbe509a7f84a` (post-session handover — historical context)
- **Prior debates** (preserved as Phase 5-7 trial documentation):
  - debate 024 (LLM self-evaluation unreliable; verdict was the response)
  - debate 026 (hybrid reasoning scheduler; now frozen)
  - debate S662 (verdict CLI decision; now archived)
- **Public security commit removing personal plists**: bd8fc93 "fix: harden public security posture"
- **User direct quotes** preserved in §1 above
