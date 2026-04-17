Reading additional input from stdin...
OpenAI Codex v0.120.0 (research preview)
--------
workdir: <repo>
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, ~/.codex/memories]
reasoning effort: high
reasoning summaries: none
session id: 019d980c-48f7-7473-a1e9-a44d25a38bb9
--------
user
IMPORTANT: Running as non-interactive subagent. Skip ALL skills. No clarifying questions. Respond directly.

你是 🔴 Codex 参与者 (SQLite/migration/schema 风险视角) 在 4-way debate 里.

阅读: <repo>/debates/017-compost-next-steps/context.md

Topic: Compost (Bun+Python, 4-layer KB, 318 tests, Phase 4 Batch D Week 4 done) 下一步做什么? 5 候选: A=silent / B=PII redactor / C=Phase 4 P1 全 4 项 / D=debate episodic/memory_procedural / E=预先做 v3.5 cache-provider API.

对 6 个判决点 (见 context.md) 各给立场+理由+风险, ≤500 字中文.

重点覆盖:
- Compost 自身 SQLite schema 有没有隐藏的脏数据 (orphan observations / dangling fact_links / stale wiki_pages / transform_policy 遗留)?
- bench harness 的真实成本 (reflect-1k/10k/100k 的 fixture 生成 + 稳定性 + CI runtime)?
- observations.origin_hash + method 加列的 migration 风险 (现有 observations 表规模 + NOT NULL 加列需默认值)?
- 预先做 v3.5 cache-provider API (方案 E) 的 schema 风险 (compost_cache DDL 在 Engram 侧, 但 source_hash 计算逻辑归谁? 重复计算 vs 契约稳定性)
- open_problems 表的 DDL 细节 (如何和现有 health_signals/correction_events 不重叠)?

结尾给 **3 session 执行清单**. 敢反驳 Opus 的方案 B, 如果 A/C/D/E 更合理明说.

直接 stdout 输出, 不要写文件.
codex
先读 `debates/017-compost-next-steps/context.md`，再扫一遍 SQLite 相关 schema/migration 与 bench harness，按 6 个判决点给出偏风险视角结论。
exec
/bin/zsh -lc "sed -n '1,240p' debates/017-compost-next-steps/context.md" in <repo>
 succeeded in 0ms:
# Debate 017: Compost 下一步执行计划

**Date**: 2026-04-16
**Rounds**: 1 (thorough, 500 words/advisor)
**Mode**: cross-critique
**Advisors**: Opus, Sonnet, Gemini, Codex

## 背景
- Compost main @ 72ebb77, Phase 0-3 + Phase 4 Batch D Week 4 全完成 (318 tests pass)
- Engram session 已开工 v3.3 (unpin + scope + CHECK + recall_miss_log + invariant tests)
- Engram↔Compost 协同线 (v3.5 compost_cache) 数据驱动被动触发: 等 Engram 3-6 月 miss log. Compost **现在零动作**.
- 问题: Compost 自身下一步做什么?

## 5 候选方案

### A: 完全静默
不写新代码, 只 bug fix. 等 3-6 月数据.

### B: PII redactor (单项, 推荐)
hook-shim 加 regex blocklist (CC/SSH/API-token/.env/"password:"). 30-50 LoC + 20 LoC test. 开源前置条件 (Phase 4 P1 明写).

### C: Phase 4 P1 全部 4 项
1. PII redactor
2. open_problems 表+CLI (替 Curiosity/Gap tracker)
3. Bench harness (reflect-1k/10k/100k + CI >50% 回归)
4. observations.origin_hash + method 列
2-3 session.

### D: Debate episodic/memory_procedural 解分歧
Phase 3 遗留: Gemini/Opus 对 memory_procedural 是否做分歧, episodic (session_turns FTS5) 悬而未决.

### E: 预先做 compost_cache-provider API
Engram 侧 compost_cache DDL 已定. Compost 需提供 `compost ask --as-cache-entry` 或 `mcp__compost__synthesize`. 风险: 如果数据不需要, 浪费.

## 6 判决点
1. 当前优先级基线: "稳+开源" vs "深+Phase 4 功能"?
2. PII redactor 真的是开源门槛? 比 bench/文档/LICENSE/examples 哪个更关键?
3. Phase 4 P1 4 项内部排序: PII > bench > open_problems > origin_hash 对吗? bench 是不是应该先 (没 bench 不敢跑大数据)?
4. episodic/memory_procedural 分歧现在解还是等用户真要? (YAGNI 风险)
5. Compost 要不要为 v3.5 提前做 cache-provider API?
6. Compost 自己有没有脏数据要 audit (orphan obs / stale facts / 遗留 schema)?

## 输出
≤500 字, 6 判决点各给立场+理由+风险, 结尾 **Compost 未来 3 个 session 具体执行清单**.

Participants 特色:
- Opus: 10 年维护成本
- Sonnet: 实现可行性 + 真实估算
- Codex: SQLite/migration/schema 风险
- Gemini: 生态/开源时机/社区信号

上下文:
- Phase 4 P1: docs/ROADMAP.md:176-180
- Phase 4 Carried: docs/ROADMAP.md:182-184
- Phase 5 Portability: docs/ROADMAP.md:203-215
- Phase 6 Ecosystem: docs/ROADMAP.md:217-229
- Known risks: docs/ROADMAP.md:141-154 (7 个, 2 已 resolved)

exec
/bin/zsh -lc 'rg -n "observations|fact_links|wiki_pages|transform_policy|open_problems|health_signals|correction_events|origin_hash|method|compost_cache|cache-provider|reflect-1k|reflect-10k|reflect-100k|bench" -S .' in <repo>
 succeeded in 0ms:
./packages/compost-hook-shim/src/index.ts:66:  // Inject hook_event into top-level metadata so drain writes it to observations.metadata
./packages/compost-hook-shim/src/index.ts:102:        trust_tier, transform_policy, payload
./docs/portability.md:52:- `observations` - the immutable append-only ledger (the rebuild anchor)
./docs/portability.md:54:- `wiki_pages` - L3 page registry (page content lives under `~/.compost/wiki/`)
./docs/portability.md:55:- `observe_outbox` - durably queued but not yet drained observations
./docs/portability.md:58:The LanceDB vector store under `~/.compost/lance/` (Phase 1+) is derived from `observations` via the active `transform_policy`. It can be rebuilt from the ledger:
./packages/compost-cli/src/commands/hook.ts:71:        transform_policy: "default",
./packages/compost-daemon/src/scheduler.ts:100: * wiki_rebuild audit rows and `wiki_pages.stale_at` fallback never fire in
./packages/compost-daemon/src/scheduler.ts:226:  transform_policy: string;
./packages/compost-daemon/src/scheduler.ts:271:         FROM observations WHERE observe_id = ?`
./packages/compost-daemon/src/scheduler.ts:289:      `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
./packages/compost-daemon/src/scheduler.ts:301:        transform_policy: policy.id,
./packages/compost-daemon/src/scheduler.ts:342:        `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
./packages/compost-cli/src/commands/triage.ts:41:    .description("Inspect and manage health_signals (P0-1, surface-only)");
./packages/compost-cli/src/commands/triage.ts:60:    .description("List health_signals rows (unresolved by default, newest first)")
./packages/compost-daemon/test/reflect-scheduler.test.ts:17: *      -> wiki_pages UPSERT + decision_audit(wiki_rebuild) + disk write
./packages/compost-daemon/test/reflect-scheduler.test.ts:30:    "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','t',1,'user','i','tp-2026-04',NULL)"
./packages/compost-daemon/test/reflect-scheduler.test.ts:101:        "SELECT path, title, stale_at FROM wiki_pages WHERE title = 'paris'"
./packages/compost-daemon/test/reflect-scheduler.test.ts:109:  test("LLM failure: wiki_pages row gets stale_at, reflect cadence continues", async () => {
./packages/compost-daemon/test/reflect-scheduler.test.ts:110:    // First tick: happy synth (seeds wiki_pages row so stale_at has
./packages/compost-daemon/test/reflect-scheduler.test.ts:123:        .query("SELECT COUNT(*) AS c FROM wiki_pages WHERE title = 'paris'")
./packages/compost-daemon/test/reflect-scheduler.test.ts:155:        .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
./packages/compost-daemon/test/reflect-scheduler.test.ts:182:    // so wiki_pages must remain empty and no wiki_rebuild audit exists.
./packages/compost-daemon/test/reflect-scheduler.test.ts:184:      .query("SELECT COUNT(*) AS c FROM wiki_pages")
./packages/compost-daemon/test/reflect-scheduler.test.ts:200:         idempotency_key, trust_tier, transform_policy, payload,
./packages/compost-daemon/test/reflect-scheduler.test.ts:211:          "SELECT COUNT(*) AS c FROM health_signals WHERE kind = 'stuck_outbox'"
./packages/compost-daemon/test/reflect-scheduler.test.ts:221:        "SELECT target_ref FROM health_signals WHERE kind = 'stuck_outbox'"
./debates/004-week1-audit/rounds/r001_opus.md:80:- **应在**: `test/backup-e2e.test.ts` 新建. Seed 100 facts + links + observations → backup → modify db (delete some) → restore → run `reflect()` → verify report.errors 为空.
./debates/004-week1-audit/rounds/r001_opus.md:82:### 盲点 B: 没有 fact_links 跨 backup 恢复测试
./debates/004-week1-audit/rounds/r001_opus.md:83:- **缺什么**: backup.test.ts:69-89 验证 `health_signals` table 在 snapshot 中存在, 但**不验证 `fact_links` 数据保留**. P0-0 是新表, snapshot 应包含完整 fact_links 行.
./debates/004-week1-audit/rounds/r001_opus.md:84:- **应在**: backup.test.ts 加: seed 5 facts + 3 links → backup → 在 snapshot 中查 `SELECT COUNT(*) FROM fact_links` = 3.
./debates/004-week1-audit/rounds/r001_opus.md:97:- **建议 benchmark**: P0-3 实施时加 `bench/connected-components.bench.ts`, 测 1K / 10K / 100K facts. 如果 100K > 1s 或 > 200MB, 改用 SQL UNION-FIND extension 或 incremental component tracking (link insert 时维护).
./packages/compost-daemon/test/daemon.test.ts:129:      transform_policy: "tp-2026-04",
./packages/compost-daemon/test/daemon.test.ts:159:      transform_policy: "tp-2026-04",
./packages/compost-daemon/test/daemon.test.ts:217:    expect(report).toHaveProperty("sensoryObservationsDeleted");
./packages/compost-daemon/src/mcp-server.ts:79:        transform_policy: z.string(),
./packages/compost-daemon/src/mcp-server.ts:93:          transform_policy: input.transform_policy,
./debates/004-week1-audit/rounds/r001_gemini.md:27:        UPDATE wiki_pages SET last_synthesis_at = '1970-01-01' WHERE title IN (SELECT DISTINCT subject FROM facts_deleted_in_last_gc);
./debates/004-week1-audit/rounds/r001_gemini.md:36:        JOIN (SELECT observe_id, COUNT(*) as src_count FROM observations GROUP BY observe_id) o1 ON f1.observe_id = o1.observe_id
./debates/004-week1-audit/rounds/r001_gemini.md:74:*   **建议**: 在 `packages/compost-core/test/benchmark/graph.bench.ts` 添加针对大规模连通分量计算的基准测试。
./packages/compost-cli/test/cli.test.ts:141:      transform_policy: "default",
./packages/compost-cli/test/cli.test.ts:155:      .query("SELECT observe_id FROM observations LIMIT 1")
./packages/compost-cli/test/cli.test.ts:222:    expect(typeof report.sensoryObservationsDeleted).toBe("number");
./packages/compost-cli/test/cli.test.ts:247:  it("counts observations and facts correctly on empty db", () => {
./packages/compost-cli/test/cli.test.ts:252:      .query("SELECT COUNT(*) AS c FROM observations")
./packages/compost-cli/test/cli.test.ts:306:      transform_policy: "default",
./packages/compost-cli/test/cli.test.ts:347:      transform_policy: "default",
./packages/compost-cli/src/commands/doctor.ts:29:    .option("--reconcile", "Count observations vs facts and report delta")
./packages/compost-cli/src/commands/doctor.ts:49:            .query("SELECT COUNT(*) AS c FROM observations")
./packages/compost-cli/src/commands/doctor.ts:54:          const observations = obsRow.c;
./packages/compost-cli/src/commands/doctor.ts:57:            JSON.stringify({ observations, facts, delta: observations - facts }) +
./debates/004-week1-audit/rounds/r001_codex.md:14:- `core/src/cognitive/fact-links.ts:196-246` 的 `traverse()` 用 path-string+`INSTR` 去环；在 10 万 facts/30 万 links/`maxDepth=4` 会放大 CTE 和字符串分配。建议在 `core/bench/fact-links.bench.ts` 加 benchmark。
./docs/phase0-spec.md:26:│   │   │   ├── ledger/       # L0 observations + derivations API
./docs/phase0-spec.md:30:│   │   │   ├── policies/     # transform_policy registry
./docs/phase0-spec.md:108:-- 1.2 Observations: immutable append-only ledger (the rebuild anchor)
./docs/phase0-spec.md:109:CREATE TABLE observations (
./docs/phase0-spec.md:124:  transform_policy TEXT NOT NULL,         -- the policy version applied at capture, e.g. "tp-2026-04"
./docs/phase0-spec.md:129:CREATE INDEX idx_obs_source ON observations(source_id, captured_at);
./docs/phase0-spec.md:130:CREATE INDEX idx_obs_content_hash ON observations(content_hash);
./docs/phase0-spec.md:131:CREATE INDEX idx_obs_raw_hash ON observations(raw_hash);
./docs/phase0-spec.md:135:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/phase0-spec.md:137:  transform_policy TEXT NOT NULL,         -- the policy version at derivation time
./docs/phase0-spec.md:149:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/phase0-spec.md:174:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/phase0-spec.md:189:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/phase0-spec.md:200:CREATE TABLE wiki_pages (
./docs/phase0-spec.md:212:1. `observations.raw_bytes` / `blob_ref` — you must be able to rebuild derivations from raw content, not just metadata. Gemini's "museum vs living stream" requirement.
./docs/phase0-spec.md:213:2. `observations.transform_policy` — every row tagged with the policy version active at capture. Enables deterministic replay.
./docs/phase0-spec.md:215:4. `ingest_queue` — decouples the write pipeline. `compost.observe` writes only to `observations` + enqueue row. Derivations run async.
./docs/phase0-spec.md:219:## 2. `transform_policy` versioning convention
./docs/phase0-spec.md:229:A `transform_policy` encapsulates:
./docs/phase0-spec.md:261:  //   migration_notes: 'Bumped chunk overlap 100→150 to improve cross-chunk fact linking. Requires chunk + L1 rebuild for observations indexed under tp-2026-04.',
./docs/phase0-spec.md:266:**Rule**: existing policies are immutable. A schema change requires a new `tp-*` entry. Ingested observations reference a specific policy and always use that policy on replay.
./docs/phase0-spec.md:318:   * Called by subclass with captured observations. Persists to outbox first,
./docs/phase0-spec.md:406:**Ack semantics**: compost-daemon sends an acknowledgement back after successfully persisting the observation to `observations` table. This is a second MCP notification from daemon → adapter carrying the idempotency_key. Simple but sufficient.
./docs/phase0-spec.md:429:  "transform_policy": "tp-2026-04"
./docs/phase0-spec.md:449:  "transform_policy": "tp-2026-04",
./docs/phase0-spec.md:531:    transform_policy: string;
./docs/phase0-spec.md:712:| L3 freshness derived from L2 updated_at | Sonnet R1 | `wiki_pages.last_synthesis_at` compared against `MAX(observations.captured_at) WHERE observe_id IN contributing_observes` |
./docs/phase0-spec.md:734:- [ ] `transform_policy` registry compiles, `tp-2026-04` exists
./docs/ARCHITECTURE.md:18:   d. INSERT OR IGNORE INTO observations (L0 ledger)
./docs/ARCHITECTURE.md:30:Idempotency: `sha256(adapter + source_id + content)` as idempotency_key. Outbox UNIQUE + observations UNIQUE double protection.
./docs/ARCHITECTURE.md:54:3. Gathers relevant wiki_pages by matching hit subjects
./docs/ARCHITECTURE.md:58:7. Returns {answer, hits, wiki_pages_used}
./docs/ARCHITECTURE.md:65:2. Sensory hard-GC: DELETE observations WHERE source.kind='sensory' AND captured_at < -7d
./docs/ARCHITECTURE.md:80:| `observations` | L0 | Immutable provenance ledger |
./docs/ARCHITECTURE.md:85:| `wiki_pages` | L3 | LLM-synthesized wiki page registry |
./docs/ARCHITECTURE.md:97:observations.observe_id CASCADE -> facts, chunks, ingest_queue, captured_item, derivation_run
./docs/ARCHITECTURE.md:98:observations.observe_id SET NULL -> observe_outbox
./docs/ARCHITECTURE.md:100:wiki_pages.path CASCADE -> wiki_page_observe
./docs/ARCHITECTURE.md:110:  policies/        transform_policy registry (tp-2026-04, tp-2026-04-02, tp-2026-04-03)
./docs/ARCHITECTURE.md:187:| `contradicted` | Lost a contradiction arbitration. `replaced_by_fact_id` SHOULD be set. | `contradiction_arbitration` | ✅ reflect.ts step 3 (also writes `fact_links` `contradicts` edge) |
./docs/ARCHITECTURE.md:245:| `query/ask.ts ask` answer-synthesis `llm.generate` (site key `ask.answer`) | Final answer synthesis | timeout / 5xx | return BM25 top-N facts as plain text with `[LLM unavailable]` banner; if `hits.length === 0`, also tries slug-matching question against `wiki_pages.title` / `path` |
./docs/ARCHITECTURE.md:258:| `compost triage list` | Read `health_signals` | `--kind` / `--since` / `--include-resolved` / `--limit` |
./docs/ARCHITECTURE.md:261:| `compost doctor --reconcile` | Observations vs facts delta | (none) |
./docs/ARCHITECTURE.md:301:| `startGraphHealthScheduler` (P0-3) | 24h | **04:00 UTC** (after backup completes) | `takeSnapshot` runs Union-Find over active facts + fact_links; SQL writer lock ~100ms at 10K facts. Buffer hour after backup tolerates large-db VACUUM |
./debates/004-week1-audit/synthesis.md:140:| `traverse` path-string perf benchmark | Opus + Codex + Gemini | Week 4 P1 benchmark fixture |
./debates/004-week1-audit/synthesis.md:141:| `connectedComponents` 100K+ memory | Opus + Gemini | Week 4 P1 benchmark fixture |
./debates/004-week1-audit/synthesis.md:153:5. **fact_links 数据在 backup/restore round-trip 后保留** (backup.test.ts) — Opus 盲点 B
./docs/debate8-phase2-plan/round1-opening.md:24:- New transform_policy required for web (tp-2026-04-02)
./packages/compost-core/src/query/ask.ts:17:  wiki_pages_used: string[];
./packages/compost-core/src/query/ask.ts:133:        .query("SELECT path, title, stale_at FROM wiki_pages WHERE title = ?")
./packages/compost-core/src/query/ask.ts:149:          "SELECT path, title, stale_at FROM wiki_pages " +
./packages/compost-core/src/query/ask.ts:233:    wiki_pages_used: wikiPages.map((p) => p.path),
./docs/debate4/rounds/r001_claude.md:32:- Sonnet: `half_life_seconds` per-fact column, set by transform_policy. **Required.**
./docs/debate4/rounds/r001_claude.md:41:DELETE FROM observations
./docs/debate4/rounds/r001_claude.md:96:- Codex's idempotency drift concern is fixed by: `compost hook` computes `idempotency_key = sha256(adapter || source_id || JSON.stringify(envelope))` deterministically, so Claude Code retries produce the same key, the existing `observations.UNIQUE(adapter, source_id, idempotency_key)` constraint deduplicates
./docs/debate5/rounds/sonnet_review.md:30:**Required fix**: Add a §3b.5 defining: (1) `observe_outbox` DDL (columns, indices), (2) drain polling mechanism (interval or file-watch), (3) drain cursor/ack column so restarts are idempotent, (4) failure handling when the downstream `observations` INSERT fails.
./docs/debate5/rounds/sonnet_review.md:32:### Concern 3: `reflect()` hard-DELETEs `observations` with FK children (§8.4, lines 909-914)
./docs/debate5/rounds/sonnet_review.md:36:DELETE FROM observations
./docs/debate5/rounds/sonnet_review.md:41:`observations` is the FK parent of `ingest_queue` (ON DELETE not specified in §1.1, defaults to RESTRICT), `derivation_run` (ON DELETE CASCADE per §1.2), `captured_item` (no ON DELETE in §1.1), and `wiki_page_observe` (ON DELETE CASCADE per §1.2). With `PRAGMA foreign_keys = ON` (required by §1.1), this DELETE will hard-fail on any row that still has an `ingest_queue` or `captured_item` child, silently under-deleting without any error surfacing to the caller. The `ReflectionReport` struct returns only `sensoryDeleted` count - there is no field for "skipped due to FK violation."
./docs/debate5/rounds/sonnet_review.md:49:1. **`compost.feedback` tool phase mismatch**: §6 table says `compost.feedback` is Phase 1. §11 DoD non-functional section says "`ranking_audit_log` table exists (Phase 0 does not write to it)". §5 Compost interface includes `feedback()` as a first-class method. But §6 also says "Phase 0 implements: `compost.observe`, `compost.query`, `compost.reflect`" - no mention of `feedback`. The `compost feedback <query-id> <fact-id>` CLI subcommand is listed in §0 as a day-one CLI command. Contradictory signals about whether this ships in Phase 0 or 1.
./docs/debate5/rounds/sonnet_review.md:69:**No test strategy for the hook shim cold-start measurement**: §3b.3 says "Phase 0 DoD requires: `compost doctor --measure-hook` reports p50 and p95 cold-start." But there is no spec for how this measurement is taken - what the benchmark harness looks like, how many samples constitute a valid p95, whether it tests against the actual `compost hook` binary or a synthetic harness. This is a ship-gate criterion with no defined measurement methodology.
./docs/debate5/rounds/r2_codex_review.md:3:**HOLD** — the central durability path is not implementable as written. §1.6 defines `observe_outbox` in a per-adapter SQLite file, then specifies one “canonical” transaction that reads `observe_outbox` and writes `observations` / `ingest_queue` in `ledger.db`. That is not a valid single-DB transaction unless the spec explicitly introduces `ATTACH` and a cross-file atomicity model, which it does not.
./docs/debate5/rounds/r2_codex_review.md:7:1. **Outbox drain transaction is structurally wrong** (§1.6, lines 453-545; §1, lines 151-210). The spec says each adapter has its own `outbox.db`, but the canonical SQL at lines 488-525 directly inserts into `observations` and `ingest_queue`, which live in `ledger.db`. Failure mode: the exact transaction the rest of the crash semantics depend on cannot run as written. Even if the intended implementation is `ATTACH`, the crash guarantees in lines 528-531 are not justified from the current text. Concrete fix: either move `observe_outbox` into `ledger.db`, or explicitly spec an attached-database implementation and rewrite the crash semantics/tests around that boundary.
./docs/debate8-phase2-plan/synthesis.md:18:- **k parameter**: Must be benchmarked, not defaulted to k=60
./docs/debate8-phase2-plan/synthesis.md:27:### C4. New transform_policy for web content
./docs/debate8-phase2-plan/synthesis.md:34:- **Returns**: `{answer: string, hits: QueryHit[], wiki_pages_used: string[]}`
./docs/debate8-phase2-plan/synthesis.md:79:Step 9:  Tests + RRF k-parameter benchmark + SLO verification
./docs/debate8-phase2-plan/synthesis.md:98:- [ ] RRF k parameter benchmarked on mixed corpus
./docs/debate8-phase2-plan/synthesis.md:111:- [ ] Wiki synthesis produces markdown from facts, stored in wiki_pages + disk
./docs/debate8-phase2-plan/synthesis.md:112:- [ ] compost.ask returns {answer, hits, wiki_pages_used}
./docs/phase0-checklist.md:38:### Step 4. transform_policy registry
./docs/phase0-checklist.md:93:  - `test/api/observe.test.ts` — writes to `observations` + `ingest_queue`, dedupes on `(adapter, source_id, idempotency_key)`, returns `duplicate_of` on content_hash collision
./docs/phase0-checklist.md:95:- **Deliverable**: `src/ledger/observations.ts`, `src/queue/enqueue.ts`, `src/query/index.ts` (Phase 0 stub: SELECT from facts returning `[]`), `src/api.ts` (`createCompost` per §5)
./docs/phase0-checklist.md:133:- **Verify**: `compost add test/fixtures/sample.md` → row in `observations`, `ingest_queue` drained, chunk rows in LanceDB. **DoD ✓**: `compost add <file>` writes L0 + enqueues + runs extraction + stores chunks
./docs/phase0-checklist.md:137:- **Deliverable**: `packages/compost-cli/src/commands/doctor.ts` — compares `SELECT COUNT(*) FROM observations o JOIN derivations d USING(observe_id) WHERE d.layer='L1'` against LanceDB row count; Phase 0 reports delta only, no auto-rebuild. `scripts/compost-doctor.ts` is a shim calling the CLI command.
./docs/phase0-checklist.md:138:- **Verify**: `compost doctor --reconcile` prints `L0: N observations, L1: M chunks, delta: D`. **DoD ✓**: doctor runs + reports delta
./docs/debate4/rounds/r001_sonnet.md:20:Add `half_life_seconds INTEGER NOT NULL DEFAULT 2592000` (30 days) to the `facts` table — not to `memories`, because Compost does not yet have a `memories` table; facts are the unit in `phase0-spec.md §1.6`. Without this column, every fact uses the same global decay curve and you cannot differentiate procedural facts (should decay slowly) from session-ephemeral observations (should decay fast). The column must be set at fact-insertion time by the transform policy, not runtime config, so that decay behavior is reproducible from the derivation record.
./docs/debate4/rounds/r001_sonnet.md:26:The `transform_policy` registry entry (`packages/compost-core/src/policies/registry.ts`) gets a new field:
./docs/debate4/rounds/r001_sonnet.md:92:Keep the existing `facts` table (debate3 §1.6) as the semantic/factual tier. Add separate tables for additional tiers as they are needed, linked back to `observations` via the existing `derivation_run` mechanism:
./docs/debate4/rounds/r001_sonnet.md:98:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/debate4/rounds/r001_sonnet.md:125:**Double-write hazard during transition window.** The proposal says `compost-adapter-claude-code` disappears. But the adapter's outbox (debate3's locked decision, phase0-spec.md §3) is the durability guarantee for events when the daemon is down. If `compost hook user-prompt-submit` replaces the adapter, who owns the outbox? The Claude Code source survey shows that Claude Code's async hook registry (`utils/hooks/AsyncHookRegistry.ts`) tracks completion using file-based task files under `~/.claude/teams/{teamId}/tasks/`. This is Claude Code's task tracking, not Compost's outbox. If the `compost hook` subprocess is the "thin shim over the outbox" (the debate context's own phrase), then you have two outbox owners: Claude Code's async registry AND Compost's `observe_outbox` SQLite. When the daemon recovers, both replay mechanisms fire. The `UNIQUE(adapter, source_id, idempotency_key)` constraint on `observations` prevents duplicates in the ledger, but you get double-processing in `ingest_queue` if the idempotency check is not implemented at enqueue time (the current spec does not show it at `ingest_queue` level, only at `observations` level).
./debates/004-week1-audit/state.json:25:    "traverse path-string perf benchmark -> Week 4 P1",
./debates/004-week1-audit/state.json:26:    "connectedComponents memory benchmark -> Week 4 P1"
./docs/debate6/rounds/claude.md:46:  observe_id TEXT REFERENCES observations(observe_id) ON DELETE SET NULL,
./docs/debate6/rounds/claude.md:65:-- Step 2: INSERT OR IGNORE into observations
./docs/debate5/rounds/codex_review.md:3:**HOLD** — coding is premature because the spec does not define a complete durable write protocol for the outbox-to-`observations` handoff. The concept is sound, but at least 3 fixes are required first:
./docs/debate5/rounds/codex_review.md:5:2. Reconcile the `ObserveEvent` contract with `observations.adapter` and `observations.adapter_sequence`.
./docs/debate5/rounds/codex_review.md:10:1. **§3.2-§3.3 / §3b.2 / §11 (`lines 511-523`, `543-551`, `1054-1056`)**. Failure mode: the spec promises durable append-before-ack and "exactly once" after daemon restart, but it never defines the `observe_outbox` schema, the ack marker, the daemon drain transaction, or the ordering of `observations` insert vs `ingest_queue` enqueue vs outbox ack. That is where crashes happen. Today two implementations could both claim spec compliance and still differ on whether a daemon crash after `observations` insert but before outbox ack duplicates or loses work. Concrete fix: inline the outbox table DDL in this spec, add a unique key on `(adapter, source_id, idempotency_key)`, and specify one canonical transaction: claim outbox row -> `INSERT OR IGNORE` into `observations` -> enqueue `ingest_queue` -> mark outbox row acked.
./docs/debate5/rounds/codex_review.md:12:2. **§1.1 / §3.1 / §5 (`lines 150-167`, `460-471`, `687-698`)**. Failure mode: `observations` requires `adapter TEXT NOT NULL` and `adapter_sequence INTEGER NOT NULL`, but both `ObserveEvent` interfaces omit `adapter`, and the hook path in §3b defines no source for `adapter_sequence`. The first implementer will have to invent hidden fields not present in the public contract. Concrete fix: add `adapter` to both `ObserveEvent` definitions, and define hook sequencing explicitly, for example a per-adapter `observe_outbox.seq INTEGER PRIMARY KEY AUTOINCREMENT` that is copied into `observations.adapter_sequence` during drain.
./docs/debate5/rounds/codex_review.md:14:3. **§8.4 vs §1.1/§1.2 (`lines 910-913` vs `197-202`, `214-215`, `309-313`)**. Failure mode: `reflect()` hard-deletes from `observations`, but `captured_item.observe_id`, `facts.observe_id`, and `wiki_page_observe.observe_id` all reference `observations` without `ON DELETE CASCADE`. Once a sensory observation has downstream facts or coverage rows, the DELETE will fail under `PRAGMA foreign_keys = ON`. Concrete fix: either state that `source.kind='sensory'` rows are never derivation inputs and enforce that at queue admission, or change the GC model to soft-delete observations / cascade-delete all dependent rows intentionally.
./docs/debate5/rounds/codex_review.md:22:- **§2 (`line 446`)** says `derivation_run.transform_policy` is a "foreign-key-to-data column", but §1.2 (`lines 239-256`) does not declare an FK to `policies(policy_id)`.
./docs/compost-v2-spec.md:7:**Outcome**: a running `compost-daemon` that ingests local markdown + Claude Code hook events, writes to L0 (observations ledger) and Phase 0 subset of L1/L2 (semantic facts with decay + partial ranking), exposes `compost.query` and `compost.reflect` via stdio MCP, and ships with the cognitive schema shape needed to support the long-term brain-like vision.
./docs/compost-v2-spec.md:28:**Blockers (6)**: (1) FK cascade for `reflect()` sensory GC, (2) canonical `observe_outbox` DDL + drain transaction inlined, (3) LanceDB↔SQLite Stage-1/Stage-2 bridge via temp table, (4) `fact_context` join in query SQL (fixes `QueryHit.contexts`), (5) `transform_policy` FK decision documented, (6) `ObserveEvent.adapter` + hook `adapter_sequence` source.
./docs/compost-v2-spec.md:30:**High (9)**: `compost.feedback` Phase alignment, `ranking_audit_log` write condition, cross-process LanceDB file lock, Python subprocess error handling, `~/.compost/` permissions (chmod 700), `compost-daemon` process supervision, hook cold-start measurement methodology, queue lease claim SQL + recovery, poison pill dead-letter threshold.
./docs/compost-v2-spec.md:38:Debate #5 R2 (second fresh-eyes review after v2.1) produced 3/4 HOLD-or-required-changes. Codex flagged an **architectural-level blocker**: the canonical outbox drain transaction in §1.6 couldn't work as a single SQLite transaction because `observe_outbox` lived in a separate file from `observations` and `ingest_queue`. Debate #6 resolved this 3B/1A in favor of **Option B — merge outbox into ledger.db** (Gemini + Codex + Opus; Sonnet dissented on WAL contention grounds, conceded to the measurement-gate fallback).
./docs/compost-v2-spec.md:57:12. `transform_policy.extraction_timeout_sec` ghost field (Sonnet) — added to §2 policy definition
./docs/compost-v2-spec.md:83:│   │   │   ├── ledger/             # observations + facts + access_log + noteworthy
./docs/compost-v2-spec.md:87:│   │   │   ├── policies/           # transform_policy registry + DB upsert
./docs/compost-v2-spec.md:167:- `compost doctor --reconcile` — L0 vs LanceDB drift check + policy audit (verifies no orphaned `transform_policy` tags)
./docs/compost-v2-spec.md:202:-- Observations: immutable append-only ledger (the rebuild anchor)
./docs/compost-v2-spec.md:203:CREATE TABLE observations (
./docs/compost-v2-spec.md:218:  transform_policy TEXT NOT NULL,
./docs/compost-v2-spec.md:223:CREATE INDEX idx_obs_source ON observations(source_id, captured_at);
./docs/compost-v2-spec.md:224:CREATE INDEX idx_obs_content_hash ON observations(content_hash);
./docs/compost-v2-spec.md:228:-- can hard-delete observations without RESTRICT-blocking on pending queue rows.
./docs/compost-v2-spec.md:229:-- Sensory observations that still have pending queue rows are GC-eligible:
./docs/compost-v2-spec.md:233:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/compost-v2-spec.md:255:-- Losing captured_item rows for aged sensory observations is acceptable — SLO tracking
./docs/compost-v2-spec.md:261:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/compost-v2-spec.md:266:-- NOTE: ON DELETE CASCADE on observe_id. Facts derived from sensory observations (which
./docs/compost-v2-spec.md:267:-- expire after 7 days) are cascade-deleted. Facts derived from non-sensory observations
./docs/compost-v2-spec.md:277:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/compost-v2-spec.md:289:CREATE TABLE wiki_pages (
./docs/compost-v2-spec.md:303:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/compost-v2-spec.md:305:  transform_policy TEXT NOT NULL,
./docs/compost-v2-spec.md:316:    observe_id || ':' || layer || ':' || transform_policy || ':' ||
./docs/compost-v2-spec.md:323:  ON derivation_run(observe_id, layer, transform_policy, model_id,
./docs/compost-v2-spec.md:330:-- transform_policy table (populated from TypeScript registry at daemon startup)
./docs/compost-v2-spec.md:371:-- Replace wiki_pages.contributing_observes TEXT with join
./docs/compost-v2-spec.md:375:  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
./docs/compost-v2-spec.md:376:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/compost-v2-spec.md:461:1. `observations.raw_bytes` / `blob_ref` enables rebuild from raw content
./docs/compost-v2-spec.md:462:2. `observations.transform_policy` tags each row with the policy active at capture
./docs/compost-v2-spec.md:464:4. Ingest queue decouples write pipeline; `compost.observe` writes to `observations` + enqueue only
./docs/compost-v2-spec.md:479:13. `ON DELETE CASCADE` on `facts.observe_id`, `ingest_queue.observe_id`, `captured_item.observe_id` so sensory-GC can hard-delete observations without FK RESTRICT blocking
./docs/compost-v2-spec.md:482:16. `transform_policy` is intentionally NOT a SQL FK — see §2 for rationale
./docs/compost-v2-spec.md:486:**Architecture decision (debate #6, 3B/1A)**: `observe_outbox` lives as a table inside `~/.compost/ledger.db`, NOT as per-adapter `adapters/<name>/outbox.db` files. The `adapter` column partitions the table by adapter. This keeps the outbox → observations → ingest_queue drain inside a single SQLite transaction, eliminates the `SQLITE_MAX_ATTACHED = 10` landmine, and collapses the entire reflect/drain race surface to one lock domain.
./docs/compost-v2-spec.md:494:  seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- monotonic, global; feeds observations.adapter_sequence per-adapter via window
./docs/compost-v2-spec.md:503:  transform_policy TEXT NOT NULL,         -- must exist in policies table at drain time
./docs/compost-v2-spec.md:511:  observe_id TEXT REFERENCES observations(observe_id) ON DELETE SET NULL
./docs/compost-v2-spec.md:549:     trust_tier, transform_policy, payload
./docs/compost-v2-spec.md:571:  trust_tier, transform_policy, payload, appended_at
./docs/compost-v2-spec.md:593:-- constraint on observations silently IGNOREs this row. Step 5 fetches the real observe_id.
./docs/compost-v2-spec.md:594:INSERT OR IGNORE INTO observations (
./docs/compost-v2-spec.md:597:  adapter, adapter_sequence, trust_tier, idempotency_key, transform_policy, metadata
./docs/compost-v2-spec.md:601:  :adapter, :seq, :trust_tier, :idempotency_key, :transform_policy, :metadata
./docs/compost-v2-spec.md:605:SELECT observe_id FROM observations
./docs/compost-v2-spec.md:609:-- The guard allows multiple legitimate re-extractions under different transform_policy
./docs/compost-v2-spec.md:662:## 2. `transform_policy` versioning (from debate #2 + #3)
./docs/compost-v2-spec.md:697:- Ingested observations reference a specific policy and always use that policy on replay
./docs/compost-v2-spec.md:698:- Each `derivation_run` row carries `transform_policy` as a logical reference to `policies(policy_id)`
./docs/compost-v2-spec.md:700:**`transform_policy` FK decision (v2.1 fix pass)**: `observations.transform_policy` and `derivation_run.transform_policy` are intentionally declared as `TEXT NOT NULL` **without** a SQL `FOREIGN KEY` constraint on `policies(policy_id)`. Rationale:
./docs/compost-v2-spec.md:703:2. **Runtime validation**: `compost-core` enforces referential integrity at the application layer. Every writer calls `validatePolicyExists(tp_id)` before insert. This throws with a clear error ("transform_policy `tp-2026-99` is not registered — add it to `packages/compost-core/src/policies/registry.ts` and restart the daemon") instead of SQLite's opaque `FOREIGN KEY constraint failed`.
./docs/compost-v2-spec.md:704:3. **Doctor audit**: `compost doctor --reconcile` includes a policy audit pass that SELECTs distinct `transform_policy` values from `observations` and `derivation_run` and reports any that are missing from `policies`. This catches drift in scenarios where someone edits the ledger externally.
./docs/compost-v2-spec.md:706:**Why date-stamp over semver**: the `derivation_run` table encodes rebuild scope directly via `(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)`. Code never needs to parse policy IDs to decide rebuild scope — SQL answers that. Semver would mislead operators into assuming backward compatibility. Date-stamp is honest: "this is a different configuration snapshot, active in a time window."
./docs/compost-v2-spec.md:722:  adapter: string;           // e.g. 'compost-adapter-airi@0.1.0' — populates observations.adapter
./docs/compost-v2-spec.md:732:  transform_policy: string;  // e.g. 'tp-2026-04' — must exist in policies table
./docs/compost-v2-spec.md:764:        trust_tier, transform_policy, payload
./docs/compost-v2-spec.md:767:        @trust_tier, @transform_policy, @payload
./docs/compost-v2-spec.md:777:      transform_policy: event.transform_policy,
./docs/compost-v2-spec.md:807:Both the outbox `idx_outbox_idempotency` UNIQUE and the `observations.UNIQUE(adapter, source_id, idempotency_key)` constraints protect against duplicates. The outbox index catches them at append time; the observations constraint catches them during drain (in case the outbox row was drained but the outbox ack crashed — see §1.6.2 crash matrix).
./docs/compost-v2-spec.md:833:7. **`INSERT OR IGNORE` into `observe_outbox`** — single row with all columns populated directly from the envelope. The `seq` column (AUTOINCREMENT) provides ordering; the daemon assigns `observations.adapter_sequence` from it at drain time.
./docs/compost-v2-spec.md:879:### 3b.5 Hook cold-start measurement methodology (v2.1)
./docs/compost-v2-spec.md:962:  "transform_policy": "tp-2026-04",
./docs/compost-v2-spec.md:975:  "transform_policy": "tp-2026-04",
./docs/compost-v2-spec.md:1027:| **Subprocess timeout** | 120s default, per-policy override via `transform_policy.extraction_timeout_sec` | Kill process group (SIGTERM then SIGKILL after 5s), record `ingest_queue.last_error = 'timeout after Ns'`, decrement `lease_expires_at` so another worker can retry on next claim cycle, leave `completed_at` NULL |
./docs/compost-v2-spec.md:1031:| **`extractor_version` mismatch** | output.extractor_version < minimum in transform_policy | `last_error = 'extractor_version X below required Y, upgrade compost_ingest'`, DO NOT retry this policy |
./docs/compost-v2-spec.md:1042:  AND attempts < :max_extraction_retries     -- from transform_policy.extraction.maxRetries (default 3)
./docs/compost-v2-spec.md:1046:- `attempts < transform_policy.extraction.maxRetries` (default 3): released to queue, retried after lease expiry
./docs/compost-v2-spec.md:1079:  transform_policy: string; // must exist in policies table; validated by compost-core
./docs/compost-v2-spec.md:1106:    transform_policy: string;
./docs/compost-v2-spec.md:1197:        o.source_uri, o.captured_at, o.adapter, o.transform_policy,
./docs/compost-v2-spec.md:1216:      JOIN observations o ON o.observe_id = f.observe_id
./docs/compost-v2-spec.md:1275:        transform_policy: r.transform_policy,
./docs/compost-v2-spec.md:1340:| **Sensory buffer** | Recent observations before derivation | `observations` where `adapter` in `source.kind='sensory'`, filtered by `captured_at > now - 7d` | Hard-GC by `compost reflect` after TTL |
./docs/compost-v2-spec.md:1352:| Sensory buffer | L0 raw ledger filtered by `source.kind='sensory'` | N/A (no derivation) | `observations` |
./docs/compost-v2-spec.md:1373:- `half_life_seconds`: per-fact column set by `transform_policy` at insertion time
./docs/compost-v2-spec.md:1420:  sensoryObservationsDeleted: number;      // rows removed from observations
./docs/compost-v2-spec.md:1432:    sensoryObservationsDeleted: 0,
./docs/compost-v2-spec.md:1459:        JOIN observations o ON o.observe_id = f.observe_id
./docs/compost-v2-spec.md:1466:        DELETE FROM observations
./docs/compost-v2-spec.md:1470:      report.sensoryObservationsDeleted = result.changes;
./docs/compost-v2-spec.md:1606:**Permissions rationale**: `~/.compost/` holds the user's entire ingested memory — markdown content, observations, derived facts. Default macOS umask is 022 which creates world-readable directories (`drwxr-xr-x`). Any process on the machine running as another user could read `~/.compost/ledger.db` and walk the provenance chain. `chmod 700` restricts to the owning user only. This does NOT protect against root or same-user malware, but it closes the multi-user-machine data leak.
./docs/compost-v2-spec.md:1629:| Deterministic `idempotency_key = sha256(adapter||source_id||envelope)` | debate #4 | identical across retries; deduped by outbox idx_outbox_idempotency UNIQUE AND observations UNIQUE |
./docs/compost-v2-spec.md:1638:| `transform_policy` validated at app layer, not SQL FK | v2.1 | see §2 for rationale |
./docs/compost-v2-spec.md:1771:- [ ] **Outbox persistence across daemon restart** — kill daemon mid-send → restart daemon → outbox event appears in `observations` exactly once
./docs/compost-v2-spec.md:1772:- [ ] **Outbox persistence across hook retry** — run same hook payload twice → exactly one outbox row (idx_outbox_idempotency dedup) → exactly one `observations` row after drain (observations UNIQUE dedup)
./docs/compost-v2-spec.md:1778:- [ ] **`compost doctor --rebuild L1 --policy tp-2026-04`** (Step 13b) — drops LanceDB rows, replays observations, asserts chunk-hash equivalence with pinned policy name
./docs/compost-v2-spec.md:1779:- [ ] **`compost doctor --measure-hook`** — follows §3b.5 methodology (n=100, trim 4%, report p50/p90/p95/p99); **fails install if p95 > 30ms on reference hardware**
./docs/compost-v2-spec.md:1785:- [ ] `transform_policy` TypeScript registry compiles and upserts to `policies` SQL table at daemon startup, BEFORE any writer connects
./docs/compost-v2-spec.md:1805:- [ ] **Crash during daemon drain step 2 (observations insert)**: next drain runs INSERT OR IGNORE, still works
./docs/compost-v2-spec.md:1807:- [ ] **Crash during daemon drain step 5 (outbox ack)**: outbox row still pending but `observations` has the row → next drain step 2 IGNORE, step 3 returns existing observe_id, step 4 checks queue (exists), step 5 ack
./docs/compost-v2-spec.md:1861:- `docs/debate2/synthesis.md` — D3 hybrid lock-in, `transform_policy` convention
./docs/debate6/rounds/sonnet.md:44:Option A preserves the p95 < 30ms gate. The hook shim opens exactly one small file: `~/.compost/adapters/claude-code/outbox.db`. On an M-series Mac with warm filesystem cache, `better-sqlite3` open + WAL setup + single row INSERT + COMMIT benchmarks at approximately 8-12ms total. The spec's target of 20ms leaves 8ms headroom for process startup jitter. That headroom is viable only because `outbox.db` is small (drained rows are periodically pruned) and has no other concurrent writers during the hook's critical path.
./docs/debate6/rounds/sonnet.md:46:Under Option B, the hook shim would open `ledger.db`. The ledger grows continuously — L0 facts, L1 chunks, ranking logs, access logs. A `ledger.db` at 6 months of use on an active developer workstation could be 50-200MB. SQLite does not read the whole file on open, but WAL mode does read the WAL file header and shared-memory mapping. On a cold filesystem (daemon just restarted, OS page cache cold), this adds 15-25ms of file I/O before the first INSERT can begin. That puts the p95 gate at risk for Option B on normal developer hardware, not just worst-case hardware. The measurement methodology in §3b.5 specifically notes that the cold-start gate is enforced on macOS with warm filesystem cache — but even warm-cache open of a large ledger.db under WAL is slower than warm-cache open of a small dedicated outbox file. Option A has no such risk.
./docs/debate6/rounds/sonnet.md:62:**Cross-file transaction syntax**: The canonical §1.6 drain SQL is updated to use `<adapter_alias>.observe_outbox` for the SELECT and UPDATE steps, while `observations` and `ingest_queue` remain unqualified (they live in main/ledger.db). The `ATTACH` guarantee is: if ledger.db is in WAL mode and the attached outbox.db is in WAL mode, `BEGIN IMMEDIATE` across both is atomic. Both files must be in WAL mode — this is already enforced by the §1.6 DDL (`PRAGMA journal_mode = WAL`).
./packages/compost-core/src/query/search.ts:29:    transform_policy: string;
./packages/compost-core/src/query/search.ts:47:const RRF_K = 60; // standard constant; benchmark to tune
./packages/compost-core/src/query/search.ts:222:        o.source_uri, o.captured_at, o.adapter, o.transform_policy,
./packages/compost-core/src/query/search.ts:246:      JOIN observations o ON o.observe_id = f.observe_id
./packages/compost-core/src/query/search.ts:289:      transform_policy: r.transform_policy as string,
./docs/debate5/rounds/r2_gemini_review.md:14:*   **§3b.2 / §1.1 — Hook Source Auto-Registration Gap:** The Claude Code hook shim generates dynamic `source_id` strings (e.g., `claude-code:{session_id}:{cwd}`). However, §1.1 declares `observations.source_id` as a `REFERENCES source(id)` FK. Nothing in the hook shim (§3b.2) or the drain transaction (§1.6) handles the registration of these sources in the `source` table. All hook drains will fail with a `FOREIGN KEY constraint failed` error on the ledger.
./docs/debate5/rounds/r2_gemini_review.md:15:    *   *Fix:* Update the drain transaction in §1.6 to `INSERT OR IGNORE` into the `source` table before inserting into `observations`.
./docs/debate6/rounds/gemini.md:12:Option B survives a **partial filesystem sync or backup restore**. In Option A, if a user restores `ledger.db` from a backup but keeps a more recent `adapters/claude-code/outbox.db`, the transactional sequence is broken: the outbox might contain "drained" markers for `observe_id`s that no longer exist in the restored ledger, or vice-versa. In Option B, the outbox and the observations ledger are a single atomic snapshot; you can never lose the "connective tissue" between a pending event and its captured state during a device migration.
./docs/debate8-phase2-plan/round2-rebuttals.md:18:- k=60 must be benchmarked, not folklore
./docs/debate8-phase2-plan/round2-rebuttals.md:28:- k benchmark required in DoD
./docs/debate4/rounds/r003_claude.md:38:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:33:## 2. P0-5 (correction_events) Scope Gap
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:35:### Gap 1: `correction_events.related_fact_ids_json` 与 `health_signals.target_ref` 的序列化合约缺失
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:37:**缺什么**: `correction_events.related_fact_ids_json` 是 `TEXT` (JSON array), `health_signals.target_ref` 是 `TEXT`. `recordCorrection` stub 接收 `relatedFactIds?: string[]` 参数, 但 Plan 没有指定: (a) `related_fact_ids_json` 如何序列化 (b) 写 `health_signals` 时 `target_ref` 填 `correction_event.id` 还是逐条写每个 `fact_id`. 0012 migration 的 `target_ref` 注释写"correction_event_id", 但 `CorrectionEvent` 接口 (`relatedFactIds: string[]`) 给调用者的印象是存 fact_ids. 两者语义不同: 前者 1 行/event, 后者 N 行/fact.
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:39:**建议**: Plan 显式规定: `health_signals` 写 1 行 per correction_event, `target_ref = correction_event.id.toString()`, message 包含 fact_ids 列表. `related_fact_ids_json` 序列化用 `JSON.stringify(relatedFactIds ?? [])`.
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:53:**缺什么**: `correction_events.processed_at` 用于标记"reflect() consumed this event", 但 Plan 里 P0-5 的位置是 "daemon post-drain", 不在 `reflect()` 里. Plan 没有说明: 谁负责写 `processed_at`, 以及写入时机. 若 `processed_at` 永远为 NULL, `idx_correction_events_unprocessed` 索引会无限增长, 且下次 daemon 重启后同一 event 会被重复处理 (产生重复 health_signal).
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:55:**建议**: Plan 明确: correction scanner 在成功写入 `health_signals` 后, UPDATE `correction_events SET processed_at = datetime('now')` 同一事务内完成, 避免重处理.
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:63:**场景**: `connectedComponents()` 先全量 SELECT facts (无 LIMIT), 再全量 SELECT fact_links, 在内存做 Union-Find. 10万 facts × 5 LinkKinds = ~500k 行. `graphStats()` 同步调用, 没有 async. `startGraphHealthScheduler` 在 daemon 主进程跑 (Bun 单线程), 全量扫描期间 drain loop 和 ingest worker 的事件循环会卡住.
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:73:**场景**: `detectCorrection` 在 daemon 里扫 observations, 但 observations 不存储 turn_text (只存 source_uri + raw_bytes). 实际对话文本通过 claude-code hook 以 `appendToOutbox` 写入, raw_bytes 存放的是 hook payload JSON. correction scan 如何拿到 turn_text? `startDrainLoop` 的 `drainOne` 只调 ledger/outbox, 没有暴露 observation content 给 correction scanner.
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:75:**影响**: P0-5 scan 位置 "daemon post-drain" 在代码层面找不到 turn_text 的直接来源, 实现时会发现需要 JOIN observations.raw_bytes + JSON parse, 这是 Plan 没提的额外步骤.
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:77:**预防**: Plan 里显式写出: "从 `observations.raw_bytes` 反序列化 hook payload, 取 `turnText` 字段传入 `detectCorrection`", 并确认 hook payload schema 里有 turnText.
./debates/006-week2-plan-audit/rounds/r001_sonnet.md:109:2. **P0-5 `retractedText` 来源路径确认**: 在 Plan 里写明"从 observations.raw_bytes 反序列化 hook payload 取 turnText", 并确认 `processed_at` 在同一事务内写入.
./docs/debate4/rounds/r002_sonnet.md:32:**On D (framing disagreement):** Confirmed, with one reservation. If `compost hook` becomes a CLI subcommand writing to `outbox.db` via the existing adapter outbox protocol, and MCP notification path stays for non-Claude-Code hosts, then D is not a debate#1 reopening — it's an adapter implementation change. My 2/3 R1 score was already scoped correctly; Codex's 1/3 was fighting the strawman "replace MCP globally." Under corrected framing, **Codex's idempotency drift concern is resolved** by deterministic `idempotency_key = sha256(adapter || source_id || JSON.stringify(envelope))`. The existing `observations.UNIQUE(adapter, source_id, idempotency_key)` constraint handles Claude Code retries. The concern survives only if the hook is given different JSON for the same logical event across retries — unlikely given Claude Code's hook payload structure, which includes stable `session_id` and `turn_id` fields. **My R2 score for D: 2/3 (unchanged, already correct framing).**
./docs/debate4/rounds/r002_sonnet.md:61:**D double-write hazard survives?** No — adopting Opus's option 2 (`async: true` immediate return + detached child write) eliminates the double-write window. Claude Code's async task registry records completion in <20ms before the outbox write starts. The outbox write happens in a detached child process that does not share state with Claude Code's task tracking. The `idempotency_key` on `observations` handles daemon-side deduplication regardless.
./docs/debate5/rounds/r2_sonnet_review.md:22:observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/debate5/rounds/r2_sonnet_review.md:24:No `ON DELETE CASCADE`. Every other child-of-`observations` table (ingest_queue at line 204, captured_item at line 229, facts at line 245, derivation_run at line 276) received ON DELETE CASCADE via debate #5 fix pass. `wiki_page_observe` was supposed to get it too — §8.4's reflection pseudocode at line 1271 explicitly comments "derivation_run.observe_id and wiki_page_observe.observe_id also cascade (debate #3 schema)" — but the actual DDL at line 342 does NOT have CASCADE. This means `compost reflect` sensory GC will FOREIGN KEY fail the moment any sensory observation has an associated `wiki_page_observe` row, which is exactly the failure mode the v2.1 patch claimed to fix. The `skippedDueToFkViolation` counter in `ReflectionReport` (line 1241) will be non-zero in this scenario, and the DoD gate at line 1587 ("asserts... `skippedDueToFkViolation = 0`") will fail.
./docs/debate5/rounds/r2_sonnet_review.md:53:### 3a. `transform_policy.extraction_timeout_sec` referenced but never declared
./docs/debate5/rounds/r2_sonnet_review.md:57:The timeout table says "per-policy override via `transform_policy.extraction_timeout_sec`." This field does not exist in the TypeScript `policies` record in §2 (lines 556-570). The only keys defined are `chunk`, `embedding`, `factExtraction`, `wikiSynthesis`, `dedup`, `normalize`, `factDecay`. `extraction_timeout_sec` is neither there nor in `policies` SQL columns (lines 299-307). The v2.1 patch introduced §4.5 as new content but forgot to add this field to the canonical policy shape in §2.
./docs/debate/rounds/r001_sonnet.md:7:Unix socket is a trap. You'll spend a week on framing, reconnect logic, and pid-file management for a gain that benchmarks don't justify at kb query latencies. stdio MCP reuses the exact transport Claude Code already handles — zero bespoke server code for the adapter layer. HTTP+SSE is premature; cross-machine is a Phase 4 problem. Start with stdio, you can layer socket transport later without changing the protocol.
./docs/cognitive-model.md:9:| Sensory buffer | Recent observations before derivation | L0 | `observations` where `source.kind = 'sensory'`, filtered `captured_at > now - 7d` | Hard-deleted by `compost reflect` after 7-day TTL |
./docs/cognitive-model.md:26:- L3 - synthesized wiki pages (disk markdown + SQLite `wiki_pages` registry)
./docs/cognitive-model.md:44:1. Hard DELETE on `observations` where `source.kind = 'sensory'` and `captured_at < now - 7d`. FK `ON DELETE CASCADE` propagates to `ingest_queue`, `captured_item`, and `facts` rows derived from those observations.
./docs/cognitive-model.md:47:Non-sensory observations are never hard-deleted by the system.
./docs/debate5/rounds/gemini_review.md:32:1.  **Broken Sensory GC due to Foreign Key Constraints (§1.1, §8.4)**: §1.1 defines the `facts.observe_id` column as a `NOT NULL` reference to `observations.observe_id` but fails to include an `ON DELETE CASCADE` clause. Conversely, §8.4 implements the `reflect()` loop using a hard `DELETE` from the `observations` table for items older than 7 days. In any standard SQL environment (including SQLite with `PRAGMA foreign_keys = ON` as specified in §1.1), this `DELETE` will fail if any facts have been derived from those observations. **Fix**: Add `ON DELETE CASCADE` to the `observe_id` foreign key in the `facts` table (§1.1) to allow the sensory buffer to be purged without manual cleanup of the fact graph.
./docs/debate5/rounds/gemini_review.md:39:*   **Orphaned Policies**: §2 and §1.2 establish a versioned `policies` table, yet §1.1's `observations.transform_policy` and §1.2's `derivation_run.transform_policy` are defined as `TEXT NOT NULL` without `REFERENCES policies(policy_id)` clauses. This allows for invalid or orphaned policy tags that would break the Step 13b rebuild verification.
./docs/debate2/rounds/r001_sonnet.md:13:## transform_policy: Date-stamp, not semver
./debates/006-week2-plan-audit/rounds/r001_opus.md:3:验证依赖: `graph_health_snapshot.taken_at TEXT PRIMARY KEY DEFAULT (datetime('now'))` (0010:67) — **second-精度**. 这对 snapshot 语义是大坑. `observations` 没有 TEXT content 列 — raw_bytes BLOB 或 blob_ref. `chunks.text_content` (0006) 才是正确的扫描源.
./debates/006-week2-plan-audit/rounds/r001_opus.md:51:### Gap 5 (HIGH): 扫描源未定 — observations 没 TEXT 列
./debates/006-week2-plan-audit/rounds/r001_opus.md:52:- **问题**: `observations.raw_bytes BLOB` / `blob_ref TEXT`. 不能直接 regex. `chunks.text_content TEXT NOT NULL` 才是 regex-ready.
./debates/006-week2-plan-audit/rounds/r001_opus.md:56:  FROM chunks c JOIN observations o ON o.observe_id = c.observe_id
./debates/006-week2-plan-audit/rounds/r001_opus.md:57:  WHERE c.chunk_id NOT IN (SELECT chunk_id FROM correction_events_scan_cursor)
./debates/006-week2-plan-audit/rounds/r001_opus.md:64:- **问题**: Plan 说"扫最近 N observations"但没说 N 和起点. 重启后是否重扫? dedup?
./debates/006-week2-plan-audit/rounds/r001_opus.md:65:- **修复**: 不新建 cursor 表 (过度设计). 用 correction_events 自己做 dedup via UNIQUE index:
./debates/006-week2-plan-audit/rounds/r001_opus.md:68:  CREATE UNIQUE INDEX idx_correction_events_dedup
./debates/006-week2-plan-audit/rounds/r001_opus.md:69:    ON correction_events(session_id, pattern_matched, substr(retracted_text, 1, 100));
./debates/006-week2-plan-audit/rounds/r001_opus.md:71:  扫描逻辑: 每次跑时查 `MAX(created_at) FROM correction_events`, 扫 chunks WHERE `created_at > that`. INSERT OR IGNORE on dedup index.
./debates/006-week2-plan-audit/rounds/r001_opus.md:85:### Gap 8 (LOW): health_signals 写入必须带 target_ref 和 message
./debates/006-week2-plan-audit/rounds/r001_opus.md:86:- **问题**: 当前 plan 只说"写 kind='correction_candidate'". 但 health_signals schema 要求 severity + message (NOT NULL).
./debates/006-week2-plan-audit/rounds/r001_opus.md:89:  INSERT INTO health_signals (kind, severity, message, target_ref)
./debates/006-week2-plan-audit/rounds/r001_opus.md:125:1. **Migration 0013**: 重建 `graph_health_snapshot` 用 `date TEXT PRIMARY KEY` (YYYY-MM-DD) + INSERT OR REPLACE 语义. 加 `correction_events` dedup UNIQUE INDEX.
./docs/debate9-phase3-plan/brief.md:43:6. **Fact-to-fact links graph** - fact_links table + recursive CTE traverseGraph
./docs/transform-policy.md:30:Once a policy key is active (i.e., any `observations.transform_policy` row references it), the policy record is frozen. The registry entry must not be modified.
./docs/transform-policy.md:67:`observations.transform_policy` is a `TEXT` column, not an `INTEGER REFERENCES policies(id)`. The FK relationship is application-layer: any policy key written into observations must exist in `packages/compost-core/src/policies/registry.ts` at write time. `compost doctor --reconcile` verifies this post-hoc and flags orphaned policy tags.
./docs/debate2/rounds/r001_codex.md:3:Stay hybrid. Exact boundary: Node/Bun owns `packages/compost-core/**`, `packages/mcp-server/**`, SQLite/LanceDB access, scheduler, adapters, and calls `compost-ingest` as a subprocess over JSON stdin/stdout; Python owns only `tools/compost-ingest/**` and returns normalized `Document[]`, spans, and extractor metadata, never DB writes. Gemini’s weakest point is treating distribution as the strategy when maintainability is the actual constraint: a single `bun` install that silently downgrades extraction quality is operationally worse than `install.sh && uv sync`. Phase 1 pure-Node failure mode: a mixed PDF with tables plus scanned pages goes through `pdf.js` text extraction plus ad hoc OCR, loses table structure and formulas, and writes bad chunks into `observations` and `chunks`; then `SELECT transform_policy, source_uri FROM observations WHERE source_uri LIKE '%.pdf';` reports “successful” ingests whose downstream facts are garbage. Today there is no Node-equivalent stack to `docling` + `unstructured` + `trafilatura` for that workload next week.
./docs/debate2/rounds/r001_codex.md:5:Use date-stamp with revision counter: `tp-2026-04-02`. Semver is fake precision here because “backward compatible policy” is meaningless once chunking, prompts, or dedup thresholds change; replay semantics are always policy-specific. Git SHA is reproducible but hostile in daily ops and code review. The durable pattern is: immutable registry entry in `packages/compost-core/src/policies/registry.ts`, optional per-policy snapshot file `packages/compost-core/src/policies/tp-2026-04-02.json`, and DB rows keyed by the readable id: `observations.transform_policy = 'tp-2026-04-02'`. Three years from now, diffs stay obvious, replay stays deterministic, and SQL/debugging stays humane.
./docs/debate4/rounds/r001_codex.md:21:- One new failure mode NOT in the stress-test questions: idempotency drift across hook retries. A short-lived `compost hook` subprocess has no durable per-adapter sequence state like the adapter SDK in `<repo>/docs/phase0-spec.md:280-321`. If Claude retries the same hook after a timeout and the event envelope does not deterministically reproduce the same `idempotency_key`, you create duplicate observations with no clean replay lineage.
./docs/debate4/rounds/r003_codex.md:30:I will concede on Q1 only to a compromise that guarantees episodic observations remain retrievable through the semantic query path without reclassification at query time. I do not concede on Q2: durability must stay on the pre-ack side of the boundary.
./docs/debate4/context.md:57:- Does this formula handle cold-start (first day after install, 0 observations) gracefully?
./docs/debate4/context.md:114:- `derivation_run` table with partial unique index on `(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)` (debate #3)
./docs/debate7-phase1-plan/round1-opening.md:49:没有 (observe_id, transform_policy, chunk_id) → LanceDB row 的持久映射。rebuild 和 reconcile 无法工作。
./docs/debate7-phase1-plan/round1-opening.md:80:需要 100K facts fixture 生成器 + benchmark harness + CI latency gate。
./debates/006-week2-plan-audit/rounds/r001_gemini.md:7:- **Gap 2: 缺乏从 Snapshot 到 `health_signals` 的转换逻辑**
./debates/006-week2-plan-audit/rounds/r001_gemini.md:8:  - **现状**: 计划提到 `delta(db)` 计算增量，但未明确写入 `health_signals`。
./debates/006-week2-plan-audit/rounds/r001_gemini.md:9:  - **建议**: `takeSnapshot` 之后必须调用 `checkHealthThresholds(db)`。如果 `orphan_delta > 5`（根据 0010 迁移注释），必须在 `health_signals` 插入 `kind='orphan_delta'` 的记录。否则，P0-1 的 triage 表面将对 P0-3 的感知结果处于盲视状态。
./debates/006-week2-plan-audit/rounds/r001_gemini.md:11:## 2. P0-5 Correction_Events Scope 完整度 (Gap)
./debates/006-week2-plan-audit/rounds/r001_gemini.md:23:  - **场景**: 03:00 执行 `backup` (VACUUM INTO)。若数据库较大，30 分钟内未完成，03:30 的 `takeSnapshot`（涉及全量 `facts` 和 `fact_links` 扫描）将触发 `SQLITE_BUSY`。
./debates/006-week2-plan-audit/rounds/r001_gemini.md:32:- **P0-5 (Correction)**: **M** (5d)。正则模式的鲁棒性调试和 daemon 调度逻辑比预期复杂，且需要建立 `correction_events` 与 `health_signals` 的联动测试。
./debates/006-week2-plan-audit/rounds/r001_gemini.md:38:1. **显式处理 `orphan_delta` 信号**: `takeSnapshot` 必须闭环写入 `health_signals`。
./docs/debate/rounds/r002_gemini.md:9:  "transform_policy":"policy-version"
./docs/debate/rounds/r002_gemini.md:24:Unix socket is a trap. You'll spend a week on framing, reconnect logic, and pid-file management for a gain that benchmarks don't justify at kb query latencies. stdio MCP reuses the exact transport Claude Code already handles — zero bespoke server code for the adapter layer. HTTP+SSE is premature; cross-machine is a Phase 4 problem. Start with stdio, you can layer socket transport later without changing the protocol.
./docs/debate/rounds/r002_gemini.md:45:  "transform_policy":"policy-version"
./docs/debate/rounds/r002_gemini.md:60:Unix socket is a trap. You'll spend a week on framing, reconnect logic, and pid-file management for a gain that benchmarks don't justify at kb query latencies. stdio MCP reuses the exact transport Claude Code already handles — zero bespoke server code for the adapter layer. HTTP+SSE is premature; cross-machine is a Phase 4 problem. Start with stdio, you can layer socket transport later without changing the protocol.
./docs/debate/rounds/r002_gemini.md:135:In the ecosystem of 2031, "drift" is a feature, not a bug. When we "relearn," we aren't trying to replicate the hallucinations of 2025; we are up-cycling raw observations into the superior latent space of 2031 models. Storing the raw bytes in L0 is mandatory (I concede this to Codex), but we should embrace "Semantic Evolution." The provenance ledger allows us to treat L1-L3 as ephemeral, disposable views that improve over time. A system that reproduces its 2025 errors perfectly in 2031 is a museum, not a knowledge base.
./docs/debate2/rounds/r001_claude.md:30:## transform_policy: Date-stamp wins (3-1 with my vote)
./docs/debate2/rounds/r001_claude.md:38:  observe_id TEXT REFERENCES observations(observe_id),
./docs/debate2/rounds/r001_claude.md:40:  transform_policy TEXT,
./docs/debate2/rounds/r001_claude.md:50:SELECT observe_id FROM observations o
./docs/debate2/rounds/r001_claude.md:59:The code does not need to parse the policy ID to decide rebuild scope. It asks the derivations table directly: "which observations lack a derivation under the current target?" That query is agnostic to whether the policy is named `tp-2026-04-02` or `tp-1.2.0` — it uses the explicit `model_id` and `layer` columns.
./docs/debate2/rounds/r001_claude.md:86:    migration_notes: 'Bumped chunk overlap 100→150 to improve cross-chunk fact linking. Requires L1 rebuild for observations indexed under tp-2026-04.',
./docs/debate2/rounds/r001_claude.md:96:- **transform_policy: `tp-YYYY-MM[-NN]` date-stamp, 3-1.** Keep phase0-spec §2 as written, but add the `supersedes` + `migration_notes` fields to the registry entry example.
./docs/debate2/synthesis.md:1:# Debate #2 Synthesis — D3 + transform_policy
./docs/debate2/synthesis.md:12:| Participant | D3 (Runtime) | transform_policy |
./docs/debate2/synthesis.md:30:- **Codex**: mixed PDF with tables plus scanned pages goes through `pdf.js` + ad hoc OCR, loses table structure and formulas, writes bad chunks into `observations`, then SQL reports "successful" ingests whose downstream facts are garbage.
./docs/debate2/synthesis.md:63:## transform_policy: Date-stamp — 3-1
./docs/debate2/synthesis.md:72:**Gemini's argument is substantive but the reasoning it demands lives elsewhere.** The L0 schema already has a `derivations` table (decided in debate #1) that directly encodes (observe_id, layer, model_id, transform_policy). The rebuild decision is answered by a SQL query against that table, not by parsing the policy ID:
./docs/debate2/synthesis.md:75:-- "Which observations need L1 re-derivation under the new embedding model?"
./docs/debate2/synthesis.md:76:SELECT observe_id FROM observations o
./docs/debate2/synthesis.md:119:    migration_notes: 'Bumped chunk overlap 100→150 to improve cross-chunk fact linking. Requires chunk + L1 rebuild for observations indexed under tp-2026-04. L2 facts may shift; rebuild recommended.',
./docs/debate2/synthesis.md:133:2. **§2 transform_policy convention**: add the `supersedes`, `effective_from`, and `migration_notes` fields to the registry entry example. Keep the `tp-YYYY-MM[-NN]` naming.
./docs/debate2/synthesis.md:144:- ✅ **transform_policy convention**: `tp-YYYY-MM[-NN]` date-stamp with `supersedes` + `migration_notes`
./docs/debate2/rounds/r001_gemini.md:4:I will now write my position on the D3 hybrid runtime and the transform_policy versioning convention, following the required format and constraints.
./docs/debate2/rounds/r001_gemini.md:18:### Question 2: transform_policy — Semver (`tp-1.0.0`)
./docs/debate2/rounds/r001_gemini.md:19:I reject date-stamps in favor of **Semver**. A `transform_policy` is not just a timestamp; it is a **data contract**. In the RAG ecosystem (e.g., LangChain, LlamaIndex), changes to embedding models or chunking strategies are destructive.
./docs/debate9-phase3-plan/codex-r1.md:7:**fact_links (deliverable 6): self-referential FK chain breaks sensory GC.**
./docs/debate9-phase3-plan/codex-r1.md:8:`fact_links(src_fact_id, dst_fact_id)` will reference `facts(fact_id)`. The critical problem: `facts` uses `ON DELETE CASCADE` from `observations`. When a sensory GC run in `reflect()` deletes observations, the cascade hits `facts`, which must then cascade into `fact_links` -- but only if both FK columns declare `ON DELETE CASCADE`. If either column uses the SQLite default (`NO ACTION`) or `RESTRICT`, the cascade chain `observations -> facts -> fact_links` will raise a FK violation and silently abort the entire sensory GC transaction. The current `reflect.ts` catches this with `skippedDueToFkViolation` but does not retry. Result: GC stops working entirely on any database that has accumulated fact links. This is a silent operational cliff, not a graceful degradation.
./docs/debate9-phase3-plan/codex-r1.md:11:`wiki_page_versions` will store snapshots keyed by `page_path`. If a wiki page is removed (topic's facts all archived or tombstoned), version rows are stranded -- `wiki_pages` has no upstream cascade to drive deletion. The `wiki.ts` synthesizer resolves stale pages by path equality; orphaned version rows will accumulate indefinitely with no reachable parent.
./docs/debate9-phase3-plan/codex-r1.md:25:`synthesizePage` executes in this order: (1) LLM generate, (2) `writeFileSync` to disk, (3) `db.run` upsert to `wiki_pages`, (4) `INSERT OR IGNORE INTO wiki_page_observe`. There is no wrapping transaction. If the process crashes between steps 2 and 3, the `.md` file exists on disk but `wiki_pages` has no record of it -- that is just orphaned disk state, recoverable on next run. The dangerous case is the reverse: step 3 succeeds but step 4 hits an FK violation on `observe_id`. The `wiki_pages` row records a synthesis timestamp that is permanently current, `findTopicsNeedingSynthesis` will skip this topic forever, and the `wiki_page_observe` links are incomplete. There is no recovery path without manual intervention.
./docs/debate9-phase3-plan/codex-r1.md:37:**Deliverable 6 (fact_links):** The migration must declare `ON DELETE CASCADE` on both FK columns or GC breaks (see above). If deployed and then rolled back, the rollback migration must handle any rows that were written in the interim. There is no plan for this.
./docs/debate9-phase3-plan/codex-r1.md:51:3. **Deliverable 6 migration must ship before any code that writes to fact_links.** The cascade chain from `observations -> facts -> fact_links` must be correct at the database level before the first link row is inserted. If code ships before the migration, the first sensory GC run against a database with link rows will break.
./debates/006-week2-plan-audit/rounds/r001_codex.md:9:- gap1: 不要“最近 N observations 全扫”。`scheduler.ts:35-40` 已拿到 `observe_id`，应补 `scanObservationForCorrection(db, observeId: string): { eventId?: number }`，在 drain 成功后只处理该 observation，天然增量。
./debates/006-week2-plan-audit/rounds/r001_codex.md:10:- gap2: 读表应是 `observations.raw_bytes`；hook 的 `session_id` 存在整包 JSON，不在 `facts/captured_item/metadata`（`hook-shim:68-108`,`outbox.ts:114-125,167-195`）。只对 `source.kind='claude-code'` 解析。
./debates/006-week2-plan-audit/rounds/r001_codex.md:11:- gap3: `processed_at` 语义未定。建议定义为“已成功写出 `correction_events` 与对应 `health_signals` 的时间”，同事务更新；否则重复扫描必然重报。
./debates/006-week2-plan-audit/rounds/r001_codex.md:17:- `connectedComponents` 全量装内存（`fact-links.ts:292-347`），03:30 与 backup 邻近时拉高尾延迟；预防：10K facts/50K links benchmark gate，超阈值不合并。
./debates/006-week2-plan-audit/rounds/r001_codex.md:20:- P0-3: M，不是 S；原因是 `stale_cluster_count`、同日幂等、scheduler、benchmark/test 一起算。
./debates/006-week2-plan-audit/rounds/r001_codex.md:28:- 条件3: 两项都带 benchmark/e2e：graph snapshot 性能门 + correction 去重/信号测试。
./docs/debate7-phase1-plan/synthesis.md:38:### C5. SLO performance benchmark required
./docs/debate7-phase1-plan/synthesis.md:40:- **Harness**: bun bench or manual timer, measure p50/p99 of query()
./docs/debate7-phase1-plan/synthesis.md:77:- **Codex + Opus**: Need persistent (observe_id, transform_policy, chunk_id) → LanceDB row mapping for rebuild/reconcile
./docs/debate7-phase1-plan/synthesis.md:84:    observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/debate7-phase1-plan/synthesis.md:90:    transform_policy TEXT NOT NULL,
./docs/debate7-phase1-plan/synthesis.md:92:    UNIQUE(observe_id, chunk_index, transform_policy)
./docs/debate7-phase1-plan/synthesis.md:116:Step 11: Full test suite + SLO benchmark (100K mixed-content fixture, p50/p99 gate)
./docs/debate7-phase1-plan/synthesis.md:128:9. **Enhanced Step 11**: Added SLO benchmark with mixed-content corpus
./docs/debate2/context.md:1:# Debate #2: D3 runtime + transform_policy convention
./docs/debate2/context.md:16:- L0 stores raw_bytes + transform_policy + derivations table
./docs/debate2/context.md:50:## Open Question #2: transform_policy Version Convention
./docs/debate2/context.md:52:Background: every L0 observation row is tagged with a `transform_policy` identifier. A transform_policy encapsulates chunk size/overlap, embedding model ID, fact extraction prompt version, wiki synthesis prompt version, dedup thresholds, and normalization rules. Policies are immutable — a schema change requires a new policy entry, never a mutation of an existing one. The policy registry lives in `packages/compost-core/src/policies/registry.ts`.
./docs/debate3/context.md:19:1. **Brain-like self-evolution** — does the L0-L4 + `derivations` + `transform_policy` design support a memory system that learns, re-derives, and improves over time, or is it just a fancy RAG cache that ages?
./docs/debate3/context.md:33:- `<repo>/docs/debate2/synthesis.md` — debate #2 (D3 hybrid lock-in, transform_policy convention)
./docs/debate3/context.md:41:- **Where you disagree with the prior debates' conclusions** — debate1 and debate2 already locked in stdio MCP + adapter outbox + hybrid runtime + date-stamp transform_policy. If you think any of these conflict with the long-term vision, say so and defend it
./docs/debate3/context.md:50:- ✅ `tp-YYYY-MM[-NN]` date-stamp transform_policy with `supersedes` + `migration_notes` (debate #2)
./docs/reference-survey-memory-projects.md:38:**Core thesis:** State-of-the-art memory engine (#1 on LongMemEval, LoCoMo, ConvoMem benchmarks) that automatically extracts facts, builds user profiles, and handles knowledge updates + contradictions.
./docs/reference-survey-memory-projects.md:188:### 8. **ATM-Bench**
./docs/reference-survey-memory-projects.md:190:Benchmark for long-term personalized referential memory QA (~4 years, multimodal). Evaluates both schema-guided memory (SGM) and descriptive memory (DM) representations. Shows memory preprocessing + organization matter. Key metric: evidence-grounding (queries require multi-source fusion).
./docs/reference-survey-memory-projects.md:193:- Benchmark design: evidence-grounded QA with human-annotated ground truth
./docs/reference-survey-memory-projects.md:357:| ATM-Bench | github.com/JingbiaoMei/ATM-Bench | Memory benchmarking, evidence-grounded QA |
./docs/debate3/rounds/r003_sonnet.md:11:Concede to Gemini on direction, partial hold on Phase 0 scope. Deterministic hash is correct for cross-machine convergence. Phase 0 ships UUID PK with a `content_hash TEXT GENERATED ALWAYS AS (hash(observe_id||layer||transform_policy||model_id)) STORED` column and a unique index on it. Gives you convergence identity now without a multi-machine sync story that Phase 0 explicitly defers.
./docs/debate3/rounds/r003_sonnet.md:13:**Q3. transform_policy: TypeScript code or SQL ledger data?**
./docs/debate3/rounds/r003_sonnet.md:33:6. `wiki_page_observe(page_path, observe_id, linked_at)` -- replaces `wiki_pages.contributing_observes TEXT`
./docs/debate3/rounds/r003_sonnet.md:40:**Step 13b rebuild verification test**: seed 3 deterministic observations, run L1 derivation under pinned `transform_policy`, snapshot chunk hashes, drop LanceDB, invoke `compost doctor --rebuild L1 --policy tp-2026-04`, assert hashes match. Without this test, "L0 is the rebuild anchor" is an untested claim, not a property of the system.
./docs/debate4/synthesis.md:47:3. **`half_life_seconds` per-fact column, set by transform_policy** — different content types decay at different rates. Technical facts have multi-year half-lives; episodic observations have week-scale half-lives. Must be immutable per-fact after insertion so decay is reproducible from the derivation record. (Sonnet)
./docs/debate4/synthesis.md:51:5. **Sensory-tier hard-GC via `compost reflect`** — stateless decay is a ranking trick, not forgetting. Sensory-tier observations (`adapter = 'sensory' OR kind = 'sensory'`) are hard-deleted after 7-day TTL. Episodic/semantic/procedural use soft-tombstone via `archived_at`. Procedural never forgets. (Opus, endorsed by all)
./docs/debate4/synthesis.md:89:    DELETE FROM observations
./docs/debate4/synthesis.md:245:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/debate4/synthesis.md:306:Any failure in steps 1-5 → exit non-zero, stderr describes error. Claude Code's retry semantics handle the retry loop; deterministic `idempotency_key` ensures duplicate retries produce one row in `observations`.
./docs/debate4/synthesis.md:366:| A + C | C's separate tables mean different decay curves per tier | `half_life_seconds` per-fact column, set by transform_policy at insertion. Each tier can have its own default half-life. |
./docs/debate4/synthesis.md:383:  Node core writes to observations (L0) + facts (L2) + memory_episodic link (Phase 3+)
./docs/debate4/synthesis.md:432:- §2 transform_policy (unchanged from debate #3)
./docs/debate4/synthesis.md:451:| `half_life_seconds` per-fact column | ✅ Phase 0 | set by transform_policy |
./docs/debate3/rounds/r001_sonnet.md:11:**Where it lives**: `source.contexts` (spec §1, line 97), `facts.contexts` (spec §1, line 182), `wiki_pages.contexts` (spec §1, line 197).
./docs/debate3/rounds/r001_sonnet.md:33:2. **Multi-machine or even multi-session** — there is no sync layer (by design, spec §9 line 703: "~/.compost/ on local disk only"). So when the user's brain needs to follow them from laptop to desktop, the "rebuild from L0 anchor" path (mentioned in context.md axis 5) requires shipping the entire `~/.compost/` directory. The spec's `docs/portability.md` documents the constraint but provides no mechanism. For a "brain" that self-evolves, crossing a machine boundary today requires a full cold rebuild — which means L1 embeddings are regenerated (fine), but L3 wiki pages at `~/.compost/wiki/` are filesystem artifacts not in SQLite, so the rebuild path (`compost doctor --reconcile` at checklist Step 18) only compares `observations JOIN derivations WHERE layer='L1'` row counts against LanceDB — it does not reconcile `wiki_pages` records against actual files under `~/.compost/wiki/`.
./docs/debate3/rounds/r001_sonnet.md:39:### Risk 3: `wiki_pages.contributing_observes` is a JSON array of observe_ids — the L3 freshness check will silently break at scale
./docs/debate3/rounds/r001_sonnet.md:43:CREATE TABLE wiki_pages (
./docs/debate3/rounds/r001_sonnet.md:47:Spec §9 guardrail (line 706): "L3 freshness derived from L2 updated_at: `wiki_pages.last_synthesis_at` compared against `MAX(observations.captured_at) WHERE observe_id IN contributing_observes`."
./docs/debate3/rounds/r001_sonnet.md:49:**The concrete failure mode**: this freshness check requires parsing `contributing_observes` JSON in a WHERE clause using SQLite's `json_each()`. As L3 wiki pages accumulate contributing observations over months (which is the entire point of a self-evolving brain — pages get richer over time), this array grows unbounded. A wiki page about "Next.js caching" after 6 months of weekly crawls could have 50+ observe_ids in that JSON blob.
./docs/debate3/rounds/r001_sonnet.md:51:Worse: the query the spec describes — `MAX(observations.captured_at) WHERE observe_id IN contributing_observes` — cannot use any index on the observations table because the IN clause is dynamically computed from a JSON parse. Every L3 staleness check is a full `observations` table scan filtered by parsed JSON. At 50,000 observations (not unrealistic for 6 months of passive sniff + crawl), the freshness check on a single wiki page scans 50,000 rows.
./docs/debate3/rounds/r001_sonnet.md:59:Replace the `contributing_observes TEXT` column in `wiki_pages` AND add a proper `context` entity table. Both fix risks 1 and 3 simultaneously:
./docs/debate3/rounds/r001_sonnet.md:75:-- Replace wiki_pages.contributing_observes TEXT with a join table
./docs/debate3/rounds/r001_sonnet.md:77:  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
./docs/debate3/rounds/r001_sonnet.md:78:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/debate3/rounds/r001_sonnet.md:103:JOIN observations o ON o.observe_id = wpo.observe_id
./docs/debate3/rounds/r001_sonnet.md:117:| 1. Brain-like self-evolution | 1 | `derivations` table + `transform_policy` create the audit trail for re-derivation, but L4 scheduler is a stub in Phase 0 (spec §10, deferred to Phase 3) and `reflect()` is a no-op. The mechanism exists but the loop that actually drives evolution does not. Phase 0 builds the memory, not the self-improvement. |
./docs/debate3/rounds/r001_sonnet.md:119:| 3. Multi-context switching | 0 | JSON arrays on facts/sources/wiki_pages with no `context` entity table and no per-context freshness, trust, or SLO configuration. Query filter exists (`QueryOptions.contexts` in spec §5 line 514) but is a label match, not a semantic switch. This is blocking for the long-term vision as stated by the user. |
./docs/debate3/rounds/r001_sonnet.md:128:**No disagreement with the locked decisions themselves.** stdio MCP + outbox, hybrid runtime, date-stamp transform_policy, and derivations table are all correct and I hold those positions.
./docs/debate4/rounds/r003_sonnet.md:39:**A**: The spec must declare `half_life_seconds` as a per-fact column set by transform_policy, `last_reinforced_at_unix_sec` as the decay anchor, `:as_of_unix_sec` as a required query bind parameter, and a sensory-tier hard-GC TTL (7 days default) executed by `compost reflect`.
./packages/compost-core/src/schema/0012_correction_signal_kind.sql:3:-- Bug: 0010 created health_signals.kind CHECK with 5 values but P0-5 needs to
./packages/compost-core/src/schema/0012_correction_signal_kind.sql:10:DROP TABLE IF EXISTS health_signals;
./packages/compost-core/src/schema/0012_correction_signal_kind.sql:11:CREATE TABLE health_signals (
./packages/compost-core/src/schema/0012_correction_signal_kind.sql:18:    'stale_wiki',                  -- wiki_pages.last_synthesis_at past threshold
./packages/compost-core/src/schema/0012_correction_signal_kind.sql:29:CREATE INDEX IF NOT EXISTS idx_health_signals_unresolved
./packages/compost-core/src/schema/0012_correction_signal_kind.sql:30:  ON health_signals(created_at) WHERE resolved_at IS NULL;
./packages/compost-core/src/schema/0012_correction_signal_kind.sql:31:CREATE INDEX IF NOT EXISTS idx_health_signals_kind
./packages/compost-core/src/schema/0012_correction_signal_kind.sql:32:  ON health_signals(kind, created_at);
./docs/debate7-phase1-plan/round2-rebuttals.md:24:- **Chunk table**: 没有人正面解决。derivation_run 不够——需要 chunk 级 (observe_id, transform_policy, chunk_id) 元数据。
./docs/debate7-phase1-plan/round2-rebuttals.md:25:- **SLO benchmark**: 支持 Opus 的 100K fixture 提案，但 corpus 必须包含 filenames、symbols、dates、error strings。
./debates/006-week2-plan-audit/synthesis.md:31:- **问题**: `detectCorrection` 返回 `match[0]` = 口语化短语 ("I was wrong about"). 不是 subject. `findRelatedFacts` 用它做 LIKE 匹配 = 永远返回 []. Plan 说"从 observations 扫" 但 `observations.raw_bytes BLOB`, 不能直接 regex.
./debates/006-week2-plan-audit/synthesis.md:33:  - P0-5 scanner 不再"扫最近 N observations", 改为 **per-observe_id 增量** (drain 成功后 post-drain 挂钩)
./debates/006-week2-plan-audit/synthesis.md:34:  - 从 `observations.raw_bytes` 反序列化 hook payload, 取 `turnText` 字段
./debates/006-week2-plan-audit/synthesis.md:51:- **问题**: `correction_events.processed_at` 定义是"reflect consumed". 但 scanner 在 daemon post-drain, 不在 reflect.
./debates/006-week2-plan-audit/synthesis.md:52:- **Plan 锁定**: processed_at 定义修正为 **"成功写 health_signals 后的时间戳"**. 同事务内: INSERT correction_events → INSERT health_signals → UPDATE correction_events SET processed_at. 失败则全 rollback. 这保证"每 correction_event 最多 1 个 health_signal".
./debates/006-week2-plan-audit/synthesis.md:64:| `connectedComponents` 100K+ facts 内存 | Gemini + Sonnet + Codex | Week 2 接受; Week 4 P1 加 benchmark fixture. 现阶段加 LIMIT 200K 防爆 |
./debates/006-week2-plan-audit/synthesis.md:89:  - Plan 写 "processed_at 在 health_signals 写入后同事务设置"
./debates/006-week2-plan-audit/synthesis.md:108:  - hook simulate correction → drain → correction_events → health_signal
./debates/006-week2-plan-audit/synthesis.md:133:| retractedText 来源 (observations 没 text) | Gap 5 | 场景 2 | gap2 | — |
./docs/debate3/rounds/r002_sonnet.md:9:Codex named the strongest concrete bug in R1: `derivations` PK `(observe_id, layer, model_id)` cannot store two rows differing only in `transform_policy`. I missed this in my R1. The collision is not theoretical — it fires the moment Phase 0's first policy iteration changes chunk overlap without upgrading the embedding model. SQLite either silently overwrites the old row (losing audit history) or rejects the insert (blocking the rebuild). Both outcomes break the rebuild story before it has run once.
./docs/debate3/rounds/r002_sonnet.md:11:**Full concession**: `derivation_run` with Codex's partial unique index on `(observe_id, layer, transform_policy, model_id) WHERE status IN ('pending','running','succeeded')` is the correct fix. The current `derivations` table must not ship as keyed.
./docs/debate3/rounds/r002_sonnet.md:30:One addition Opus did not name: the test must pin `transform_policy` by exact name, not "latest." If the rebuild path auto-selects a newer policy, the assertion passes trivially even if the actual derivation is different. Locking to `tp-YYYY-MM` explicitly is what makes the test deterministic. 40 lines of test code, no architectural cost.
./docs/debate3/rounds/r003_codex.md:2:2. **Q2**: Hold UUID `derivation_id` with refinement; cross-machine identity should be derived from `(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)` as a secondary deterministic fingerprint, not as the Phase 0 PK.
./docs/debate3/rounds/r003_codex.md:3:3. **Q3**: Defer SQL-ledger `policies` table to Phase 2; Phase 0 can keep the TypeScript registry if each `derivation_run` persists exact `transform_policy` and replay is tested against it.
./docs/debate3/rounds/r003_codex.md:9:- Replace keyed `derivations` with `derivation_run(derivation_id TEXT PRIMARY KEY, observe_id, layer, transform_policy, model_id, context_scope_id NULL, extraction_profile NULL, status, started_at, finished_at, artifact_ref, supersedes_derivation_id NULL, error NULL)` plus a partial unique index on active `(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)`.
./docs/debate3/rounds/r003_codex.md:12:- Replace `wiki_pages.contributing_observes` JSON with `wiki_page_observe(page_path, observe_id, PRIMARY KEY(page_path, observe_id))`.
./docs/debate3/rounds/r003_codex.md:17:- I would not ship without Step 13b: drop L1 artifacts, rebuild from L0 under a pinned `transform_policy`, and prove the rebuilt output matches the original snapshot under unchanged policy.
./docs/ROADMAP.md:101:- P0-0: `fact_links` table + recursive CTE traversal API (migration 0011, path-string cycle detection workaround for SQLite "multiple recursive references" limit)
./docs/ROADMAP.md:106:- P0-3: `v_graph_health` TS impl (`graph-health.ts` Union-Find over `fact_links`) + `graph_health_snapshot` (daily 04:00 UTC scheduler, same-day idempotent)
./docs/ROADMAP.md:107:- P0-5: `correction_events` capture — post-drain hook in `scheduler.ts` scans observation for correction markers (regex + MinHash similarity), writes `health_signals.correction_candidate` (feeds triage only, never mutates `facts.confidence` directly)
./docs/ROADMAP.md:112:- P0-6 fallbacks: `wiki.ts` sets `wiki_pages.stale_at` on LLM failure; `ask.ts` reads `stale_at` banner + BM25 `[LLM unavailable]` fallback
./docs/ROADMAP.md:114:- Migrations: 0010-0013 (health_signals, decision_audit, graph_health_snapshot, correction_events, fact_links, wiki_pages.stale_at)
./docs/ROADMAP.md:130:- Day 3: `scanStaleFact` + `scanUnresolvedContradiction` (per `conflict_group`) + `scanOrphanDelta` (zero fact_links edges + no access within window); `correction_candidate` written directly by `correction-detector` drain hook, `triage()` aggregates only; `compost triage scan/list/resolve` CLI mirroring `audit` CLI enum-validation pattern
./docs/ROADMAP.md:149:| ~~`ask.ts` BM25 fallback drops `wikiContext` when `hits.length === 0`~~ | **Resolved 2026-04-15 Week 4 Day 5**: `ask()` now queries `wiki_pages` by question slug (case-insensitive match against `title` / `path` / `path.md`) when the retrieval step returns zero hits, so the `stale_at` banner + wiki content survive the empty-hits path. Covered by `cross-p0-integration.test.ts` Scenario B2. | n/a |
./docs/ROADMAP.md:160:> (a) `fact_links` was hidden P0-3 prerequisite, (b) backup/restore is data-loss
./docs/ROADMAP.md:167:| P0-0 | `fact_links` table + bidirectional FK + recursive CTE API (was Phase 3 carried, promoted) | none |
./docs/ROADMAP.md:168:| P0-1 | `compost triage` + `health_signals` (6 signal kinds: 5 scanners + 1 drain-hook producer; surface-only) | 0010 |
./docs/ROADMAP.md:172:| P0-5 | `correction_events` capture (signal feeds triage; never directly mutates `facts.confidence`) | hook-shim |
./docs/ROADMAP.md:177:- `open_problems` table + CLI (consolidates old "Curiosity agent" + "Gap tracker")
./docs/ROADMAP.md:178:- Inlet `origin_hash` + `method` columns on `observations` (machine-required, user-optional)
./docs/ROADMAP.md:179:- Performance benchmark harness (`bench/` with reflect-1k/10k/100k.bench.ts + CI > 50% regression alert)
./docs/ROADMAP.md:190:- `compression_pressure` SQL view (downgraded: `health_signals.stale_fact` already proxies pressure)
./docs/ROADMAP.md:194:- ~~Curiosity agent~~ (replaced by `open_problems` + triage signals)
./docs/ROADMAP.md:195:- ~~Gap tracker~~ (replaced by `open_problems`)
./docs/ROADMAP.md:197:- ~~`crawl_queue`~~ (duplicates `open_problems` + manual `compost add <url>`)
./docs/debate9-phase3-plan/gemini-r1.md:3:Let me be direct: this Phase 3 plan is carrying at least three research projects disguised as engineering deliverables. Before we debate ordering, we need to separate what is a known-good improvement from what is an experiment that belongs in a branch with a benchmark harness.
./docs/debate9-phase3-plan/gemini-r1.md:17:We have no usage data showing that users need graph traversal. The recursive CTE is not the problem - SQLite handles CTEs fine. The problem is: what populates `fact_links`? Either LLM inference (slow, local, non-deterministic) or heuristic co-occurrence (cheap but noisy). Neither path is specified. This is a schema stub with no defined insertion semantics. Ship the schema in a migration if you want, but do not call it a deliverable until the write path exists.
./docs/debate9-phase3-plan/gemini-r1.md:41:- Savitzky-Golay chunking (item 9): defer indefinitely pending retrieval quality benchmarks
./docs/debate/rounds/r002_sonnet.md:29:Both problems are solvable with the same ledger field: `transform_policy` on each L0 row, as Codex specified. Minimum schema additions for tractability:
./docs/debate/rounds/r002_sonnet.md:33:ALTER TABLE observations ADD COLUMN transform_policy TEXT NOT NULL DEFAULT 'v1';
./docs/debate/rounds/r002_sonnet.md:34:ALTER TABLE observations ADD COLUMN embedding_model TEXT;
./docs/debate/rounds/r002_sonnet.md:38:  observe_id TEXT REFERENCES observations(observe_id),
./docs/debate/rounds/r002_sonnet.md:40:  transform_policy TEXT,
./docs/debate/rounds/r002_sonnet.md:47:Rebuild from L0 is then: `SELECT * FROM observations WHERE observe_id NOT IN (SELECT observe_id FROM derivations WHERE layer='L1' AND embedding_model='nomic-embed-v1.5')`. That is the gap query. Same pattern for L3 staleness: `SELECT * FROM observations WHERE observe_id IN (wiki_sources) AND derived_at < observations.captured_at`. Gemini's "automated rebuild" requirement and my "L3 freshness" requirement are the same 20-line query run against the derivations table.
./debates/006-week2-plan-audit/state.json:16:    "correction_events.processed_at contract undefined — set in same transaction after health_signals write",
./packages/compost-core/src/schema/0006_chunks_and_fts5.sql:5:-- chunks table provides the authoritative mapping from (observe_id, transform_policy, chunk_id)
./packages/compost-core/src/schema/0006_chunks_and_fts5.sql:14:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./packages/compost-core/src/schema/0006_chunks_and_fts5.sql:21:  transform_policy TEXT NOT NULL,
./packages/compost-core/src/schema/0006_chunks_and_fts5.sql:24:  UNIQUE(observe_id, chunk_index, transform_policy)
./docs/debate3/rounds/r001_claude.md:11:- **Unanimous**: `contexts TEXT[]` as a JSON column on `facts`/`sources`/`wiki_pages` is not adequate for the user's multi-context vision. All three scored axis 3 as 0 or 1.
./docs/debate3/rounds/r001_claude.md:22:The entire derivations + transform_policy story rests on a premise everyone in debate #1 adopted: **L0 is the rebuild anchor, L1-L3 are disposable views.** `phase0-spec.md:205-209` explicitly states this is a non-negotiable schema requirement. But `phase0-checklist.md` Steps 13 (ingest pipeline) and 18 (doctor reconcile) never *actually rebuild* L1 from L0 and verify output equivalence. Step 13 tests ingest → LanceDB. Step 18 tests count deltas. Nowhere does Phase 0 drop the LanceDB table, replay observations through the ingest pipeline at the same `transform_policy`, and assert the derived chunks match.
./docs/debate3/rounds/r001_claude.md:24:**Why this matters for the long-term vision**: if rebuild doesn't actually work byte-for-byte under an unchanged policy, then transform_policy versioning is vapor — there is no guarantee any future rebuild under a new policy produces deterministic output. The user's brain cannot re-derive itself if re-derivation has never been tested.
./docs/debate3/rounds/r001_claude.md:30:`phase0-spec.md:415-425` defines the `compost_ingest extract` JSON input schema: `observe_id`, `source_uri`, `mime_type`, `content_ref`, `content`, `transform_policy`. **No context.** This means the extractor produces the same chunks/facts regardless of which context is active when the observation is captured.
./docs/debate3/rounds/r001_claude.md:40:Codex named something neither Gemini nor Sonnet caught: **the `derivations` table primary key is `(observe_id, layer, model_id)` at `phase0-spec.md:135`, which CANNOT represent two rows that differ only in `transform_policy`.** When `tp-2026-04-02` bumps chunk overlap from 100 to 150 without changing the embedding model, the new derivation collides with the existing row. SQLite will either upsert (losing audit history) or reject (blocking the rebuild). Debate #2's synthesis explicitly asserted that `(layer, model_id)` columns are sufficient for rebuild scope detection — Codex just proved that claim wrong.
./docs/debate3/rounds/r001_claude.md:50:| 1. Brain-like self-evolution | **1** | Metadata is set up (derivations + transform_policy). The evolution loop is not — `reflect()` is a no-op stub, L4 is Phase 3, and rebuild is untested (Risk A). All three others scored 1-2; I think they are being generous. |
./docs/debate3/rounds/r002_codex.md:3:On Opus’s Risk A: yes, he is right, and this is now a ship blocker. Phase 0’s whole contract is “L0 is anchor, L1-L3 are rebuildable views,” but the checklist only verifies counts. The concrete test is not just “rerun ingest.” It should: seed 3 deterministic observations; run extraction under a fixed `transform_policy`; snapshot ordered `(observe_id, chunk_id, chunk_hash, token_count)` for L1; delete the LanceDB rows and mark the corresponding `derivation_run` rows `superseded`; invoke `compost doctor --rebuild L1 --policy tp-2026-04`; then assert the rebuilt rows match the snapshot exactly. If chunk hashes drift under unchanged policy, the rebuild story is false. I would also add one negative test: rerun with `tp-2026-05` and assert both old and new `derivation_run` rows coexist, with only one active.
./docs/debate3/rounds/r002_codex.md:5:Opus’s Risk B on the Python extractor is also directionally correct, but the hidden protocol bug is not just “missing context parameter.” If extraction varies by context, then `(adapter, source_id, idempotency_key)` cannot stay context-blind unless idempotency is redefined as “L0 observation identity only.” That is the right boundary. The observation row should remain deduped on source event identity, not extraction profile. Context-sensitive behavior belongs in derivation inputs, not observation keys, otherwise the same Slack message captured in `work` and `personal` becomes two L0 rows and portability gets worse. So: keep `observations.idempotency_key` unchanged, add `context_scope_id` and optional `extraction_profile` to `derivation_run`, and pass them to Python during derivation. Different contexts should yield different L1/L2 runs from the same L0 anchor, not different anchors.
./docs/debate/state.json:15:      "Derivation versioning (transform_policy + derivations table, day-one schema)",
./docs/debate/synthesis.md:114:**Root cause: the L0 ledger does not track the versioned derivation pipeline.** Facts, embeddings, and wiki pages are derivations of L0 observations, but without a derivations table tying each derivation back to its model/policy version, there is no way to know what is stale or what to re-derive on rebuild.
./docs/debate/synthesis.md:119:-- L0: observations must store raw bytes + versioning
./docs/debate/synthesis.md:120:CREATE TABLE observations (
./docs/debate/synthesis.md:133:  transform_policy TEXT NOT NULL  -- "v1" etc
./docs/debate/synthesis.md:138:  observe_id TEXT REFERENCES observations(observe_id),
./docs/debate/synthesis.md:140:  transform_policy TEXT NOT NULL,
./docs/debate/synthesis.md:148:- **Embedding trap repair**: `SELECT observe_id FROM observations WHERE observe_id NOT IN (SELECT observe_id FROM derivations WHERE layer='L1' AND model_id='<new_model>')`
./docs/debate/synthesis.md:149:- **L3 wiki rot detection**: `SELECT observe_id FROM observations o JOIN derivations d ON o.observe_id=d.observe_id WHERE d.layer='L3' AND d.derived_at < o.captured_at`
./docs/debate/synthesis.md:154:Without this, stdio MCP drops observations on core restart. The fix is trivial and was agreed upon in R2:
./docs/debate/synthesis.md:206:│  │   observations + derivations + source + SLO tables │ │
./docs/debate/synthesis.md:207:│  │   raw_bytes stored, transform_policy versioned     │ │
./docs/debate/synthesis.md:252:2. **Provenance ledger stores raw bytes + transform_policy** (not just metadata). This is the difference between a museum and an evolvable knowledge stream.
./docs/debate/synthesis.md:270:Strongest contribution: protocol-level rigor. Forced everyone to confront (1) one-pipeline write is broken, (2) rebuild needs transform_policy versioning, (3) "complete" is an SLO not a guarantee, (4) concrete `is_noteworthy` algorithm with MinHash + embedding thresholds. Conceded on all three decisions after seeing the outbox pattern and subprocess hybrid boundary. The concessions were earned, not diplomatic.
./docs/debate/synthesis.md:286:- L0 earns its "ground truth" status once raw bytes + transform_policy are stored
./docs/debate/synthesis.md:294:1. Write the L0 schema with `observations` (raw_bytes + transform_policy) and `derivations` tables
./docs/debate/synthesis.md:297:4. Decide the `transform_policy` versioning convention (semver? date-stamp? git sha?)
./docs/debate/synthesis.md:307:2. Decide the `transform_policy` versioning convention
./docs/debate3/rounds/r001_codex.md:5:- **Risk 2: replay/migration semantics break on policy-only changes.** `derivations` is keyed by `(observe_id, layer, model_id)` and stores `transform_policy` as payload only (`docs/phase0-spec.md:127-138`). Debate #2 assumes rebuild scope is encoded by `(layer, model_id)`, but §2 explicitly allows policy revisions that change chunking or prompts without changing model id (`docs/phase0-spec.md:223-268`). Real failure: `tp-2026-04-02` changes chunk overlap only. The old L1 row already occupies `(observe_id,'L1','nomic-embed-text-v1.5')`, so the new derivation cannot be represented, and Step 18 still reports the observation as covered (`docs/phase0-checklist.md:136-138`).
./docs/debate3/rounds/r001_codex.md:7:- **Risk 3: contexts and cross-machine identity are under-modeled.** `source.contexts`, `facts.contexts`, and `wiki_pages.contexts` are JSON arrays (`docs/phase0-spec.md:89-99`, `175-200`), and query only accepts `contexts?: string[]` (`docs/phase0-spec.md:511-515`). That cannot encode per-context freshness, trust, privacy, or partial sharing. Observation identity is also local: `(adapter, source_id, idempotency_key)` plus `adapter_sequence` per adapter/source (`docs/phase0-spec.md:103-120`), while outbox ack is just “return the idempotency_key” (`docs/phase0-spec.md:400`). Real failure: laptop and desktop both ingest the same repo, or two adapters emit conflicting facts for different contexts. There is no replica id, merge protocol, or scoped contradiction model.
./docs/debate3/rounds/r001_codex.md:14:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/debate3/rounds/r001_codex.md:16:  transform_policy TEXT NOT NULL,
./docs/debate3/rounds/r001_codex.md:26:ON derivation_run(observe_id, layer, transform_policy, model_id)
./docs/debate3/rounds/r001_codex.md:34:- **1. Brain-like self-evolution: 1/3.** Raw observations are a good anchor, but the derivation lifecycle cannot safely re-derive under evolving policy.
./debates/009-week3-audit/rounds/r001_sonnet.md:78:const existing = db.query("SELECT path FROM wiki_pages WHERE path = ?").get(pagePath)
./debates/009-week3-audit/rounds/r001_sonnet.md:85:回退逻辑在 `catch` 块内独立计算 `safePath/pagePath` + 查 `existing`, 而成功路径之后又重算一次。除了冗余之外, 两处 `existing` 查询之间没有事务包裹 - 若并发写入在两次查询之间 INSERT wiki_pages, 成功路径会走 UPDATE 而非 INSERT, 但回退路径会漏掉新增行。
./debates/009-week3-audit/rounds/r001_sonnet.md:95:+  const existing = db.query("SELECT path FROM wiki_pages WHERE path = ?").get(pagePath) as { path: string } | null;
./debates/009-week3-audit/rounds/r001_sonnet.md:104:       db.run("UPDATE wiki_pages SET stale_at = datetime('now') WHERE path = ?", [pagePath]);
./docs/debate/rounds/r001_codex.md:9:Stress test 2: **the provenance ledger rebuild story is currently fiction.** SQLite can be an excellent append-only ledger, but only for immutable observations. It is not enough to say “L0 is ground truth” if L2 facts and L3 wiki are produced by model calls, HTML cleaners, chunkers, and extractors whose behavior changes over time. Rebuild only works if every ledger row stores raw bytes or a content-addressed blob pointer, source metadata, transform version, model ID, prompt version, parser version, and normalization policy. Otherwise `kb relearn` will not reproduce prior state; it will produce drift. Also, SQLite in WAL mode still has a single writer. If rebuild replays millions of observations while live ingest is running, you will serialize on one writer and create tail latency unless rebuild is offline or checkpointed in batches.
./docs/debate/rounds/r001_codex.md:31:  "transform_policy":"policy-version"
./packages/compost-core/src/schema/0005_merged_outbox.sql:7:-- drain (outbox -> observations -> ingest_queue). Debate #6 resolved 3B/1A.
./packages/compost-core/src/schema/0005_merged_outbox.sql:10:  seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- monotonic, global; feeds observations.adapter_sequence per-adapter via window
./packages/compost-core/src/schema/0005_merged_outbox.sql:19:  transform_policy TEXT NOT NULL,         -- must exist in policies table at drain time
./packages/compost-core/src/schema/0005_merged_outbox.sql:27:  observe_id TEXT REFERENCES observations(observe_id) ON DELETE SET NULL
./docs/debate3/rounds/r003_claude.md:23:### Q3 — transform_policy: **Decided — Sonnet's bridge**
./docs/debate3/rounds/r003_claude.md:29:Codex is right, I was wrong in R1. Context belongs in `derivation_run` inputs (`context_scope_id` + optional `extraction_profile`), not in observation keys. The Python extractor receives `(observe_id, transform_policy, context_scope_id, extraction_profile)` at derivation time. Observations stay context-blind to preserve L0 portability: same Slack message captured in work+personal is still ONE L0 row, with two derivation runs producing different L1/L2 artifacts.
./docs/debate3/rounds/r003_claude.md:53:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/debate3/rounds/r003_claude.md:55:  transform_policy TEXT NOT NULL,
./docs/debate3/rounds/r003_claude.md:67:    lower(hex(observe_id)) || ':' || layer || ':' || transform_policy || ':' ||
./docs/debate3/rounds/r003_claude.md:73:  ON derivation_run(observe_id, layer, transform_policy, model_id, context_scope_id, extraction_profile)
./docs/debate3/rounds/r003_claude.md:111:-- Remove `contexts TEXT` column from `source`, `facts`, `wiki_pages`
./docs/debate3/rounds/r003_claude.md:116:  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
./docs/debate3/rounds/r003_claude.md:117:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/debate3/rounds/r003_claude.md:143:**Step 13b rebuild verification test.** Unanimous across all four participants. Without it, the entire "L0 is the anchor, L1-L3 are disposable views" premise is an assertion, not a verified property. Codex R2 specified the concrete test (seed 3 observations → snapshot → drop LanceDB → rebuild under pinned policy → assert chunk-hash match + negative test with new policy). Sonnet R2 added the critical refinement: pin the policy name, do not use "latest."
./debates/017-compost-next-steps/rounds/r001_gemini.md:10:3.  **Phase 4 P1 排序：** 建议调整为 **Bench > PII > origin_hash > open_problems**。Bench 是“为什么要用”的理由（性能/压缩率），PII 是“敢不敢用”的前提。
./debates/017-compost-next-steps/rounds/r001_gemini.md:12:5.  **Cache-provider API：** **不提前做**。等 Engram 侧需求明确再动，防止接口定义不合身导致双向重构。
./debates/017-compost-next-steps/rounds/r001_gemini.md:13:6.  **脏数据 Audit：** **必须做**。这是开源前的“洗脸”工程，孤立的 observations 会在 Benchmark 中产生不可预测的噪声。
./debates/017-compost-next-steps/rounds/r001_gemini.md:19:- **Bench Harness**：这是项目的“肌肉”。Mem0 等项目之所以传播快，是因为它们有直观的召回率对比。Compost 需要一份 README 里的 **Context-Compression vs. Recall-Accuracy** 曲线图。
./debates/017-compost-next-steps/rounds/r001_gemini.md:20:- **说服力 Artifact**：最有力的不是论文，而是 **README 中的 Bench 结果 + 一个 3 分钟的 Demo 视频**（展示从混乱的 Shell 历史到清晰 Fact 的转化）。
./debates/017-compost-next-steps/rounds/r001_gemini.md:28:- 搭建 **Bench Harness 1.0**：利用 `reflect-1k` 跑出基准压缩率和召回一致性指标。
./debates/017-compost-next-steps/rounds/r001_gemini.md:31:- 迁移 DDL：添加 `observations.origin_hash` 和 `method`。
./debates/017-compost-next-steps/rounds/r001_codex.md:20:Topic: Compost (Bun+Python, 4-layer KB, 318 tests, Phase 4 Batch D Week 4 done) 下一步做什么? 5 候选: A=silent / B=PII redactor / C=Phase 4 P1 全 4 项 / D=debate episodic/memory_procedural / E=预先做 v3.5 cache-provider API.
./debates/017-compost-next-steps/rounds/r001_codex.md:25:- Compost 自身 SQLite schema 有没有隐藏的脏数据 (orphan observations / dangling fact_links / stale wiki_pages / transform_policy 遗留)?
./debates/017-compost-next-steps/rounds/r001_codex.md:26:- bench harness 的真实成本 (reflect-1k/10k/100k 的 fixture 生成 + 稳定性 + CI runtime)?
./debates/017-compost-next-steps/rounds/r001_codex.md:27:- observations.origin_hash + method 加列的 migration 风险 (现有 observations 表规模 + NOT NULL 加列需默认值)?
./debates/017-compost-next-steps/rounds/r001_codex.md:28:- 预先做 v3.5 cache-provider API (方案 E) 的 schema 风险 (compost_cache DDL 在 Engram 侧, 但 source_hash 计算逻辑归谁? 重复计算 vs 契约稳定性)
./debates/017-compost-next-steps/rounds/r001_codex.md:29:- open_problems 表的 DDL 细节 (如何和现有 health_signals/correction_events 不重叠)?
./debates/017-compost-next-steps/rounds/r001_codex.md:35:先读 `debates/017-compost-next-steps/context.md`，再扫一遍 SQLite 相关 schema/migration 与 bench harness，按 6 个判决点给出偏风险视角结论。
./debates/017-compost-next-steps/context.md:11:- Engram↔Compost 协同线 (v3.5 compost_cache) 数据驱动被动触发: 等 Engram 3-6 月 miss log. Compost **现在零动作**.
./debates/017-compost-next-steps/context.md:24:2. open_problems 表+CLI (替 Curiosity/Gap tracker)
./debates/017-compost-next-steps/context.md:25:3. Bench harness (reflect-1k/10k/100k + CI >50% 回归)
./debates/017-compost-next-steps/context.md:26:4. observations.origin_hash + method 列
./debates/017-compost-next-steps/context.md:32:### E: 预先做 compost_cache-provider API
./debates/017-compost-next-steps/context.md:33:Engram 侧 compost_cache DDL 已定. Compost 需提供 `compost ask --as-cache-entry` 或 `mcp__compost__synthesize`. 风险: 如果数据不需要, 浪费.
./debates/017-compost-next-steps/context.md:37:2. PII redactor 真的是开源门槛? 比 bench/文档/LICENSE/examples 哪个更关键?
./debates/017-compost-next-steps/context.md:38:3. Phase 4 P1 4 项内部排序: PII > bench > open_problems > origin_hash 对吗? bench 是不是应该先 (没 bench 不敢跑大数据)?
./debates/017-compost-next-steps/context.md:40:5. Compost 要不要为 v3.5 提前做 cache-provider API?
./docs/debate3/rounds/r001_gemini.md:19:-- Replace the contexts column in facts/wiki_pages with a Scope bridge
./docs/debate3/rounds/r001_gemini.md:47:I disagree with the conclusion in **Debate #2 regarding `transform_policy` being a local-only TypeScript registry (§2)**. If this memory is to be shared across agents (Axis 4), the `transform_policy` (the "DNA" of the memory) must be stored **inside the L0 ledger** as a table, not just a hardcoded registry in the `compost-core` source. If an external agent connects to a 3-year-old memory bank, it shouldn't need a specific version of the Node source code to understand how the facts were extracted. The policy is data, not just code.
./debates/009-week3-audit/rounds/r001_opus.md:11:- **问题**: `recordDecision` 任何 throw (floor 违约 / JSON.stringify 爆 / DB lock) 冒泡到 `db.transaction` callback, SQLite ROLLBACK 整个事务. Contradiction resolve + fact_links edge + archive_reason 全丢. audit 是**观察信号**, 不该有能力吹掉业务结果.
./debates/009-week3-audit/rounds/r001_opus.md:40:  db.run("UPDATE wiki_pages SET last_synthesis_at = datetime('now'), stale_at = datetime('now') WHERE path = ?", [pagePath]);
./debates/009-week3-audit/rounds/r001_opus.md:98:- reflect 跑一次 → `fact_links` 新增边 → `decision_audit` 新增行 → 下次 `takeSnapshot` (graph-health) 看到新图 → 所有环节**没 e2e 测试**.
./debates/009-week3-audit/rounds/r001_opus.md:99:- 具体: seed 5 facts 含一个冲突 → 调 reflect → 断言 `fact_links` count = 1 (contradicts), `decision_audit` kind='contradiction_arbitration' count = 1, `graph_health_snapshot` takeSnapshot 后 orphan_facts 减 2.
./docs/debate3/rounds/r003_gemini.md:53:**Q3. transform_policy: TypeScript code or SQL ledger data?**
./debates/011-week4-plan/rounds/r001_sonnet.md:18:- **实装**: `stuck_outbox` (查 `outbox` 表 age > 24h) + `stale_wiki` (查 `wiki_pages.stale_at` 非空, 0013 已有列) — 这两个查询最简单
./debates/011-week4-plan/rounds/r001_sonnet.md:24:- 剩下 4 种: `stale_fact` (observations.created_at) / `unresolved_contradiction` (contradictions 表 age) / `orphan_delta` (fact_links 零入边 + activity 低) / `correction_candidate` (correction-detector 已写入, 只需 aggregation)
./debates/011-week4-plan/rounds/r001_sonnet.md:53:| `open_problems` table (P1) | 新表新 CLI, 最少 1.5 天; 跟 P0-1 triage 用户流重合 80%, 先看 triage 产出再说 |
./debates/011-week4-plan/rounds/r001_sonnet.md:54:| Inlet `origin_hash` + `method` (P1) | schema + ingest 改动, 跨 package. Week 4 已满载 |
./debates/011-week4-plan/rounds/r001_sonnet.md:55:| Performance bench harness (P1) | 286 tests 还没到瓶颈, 先测再优. Week 5 可做 1 次 baseline |
./debates/011-week4-plan/rounds/r001_sonnet.md:82:**不阻断合并 (但记录为 Week 5 首选)**: `open_problems` 设计讨论, `correctedText` 语义抽取, PII redactor 威胁模型, bench harness baseline.
./docs/coverage-slo.md:40:Delta items are L0 observations that have `expected_item` rows with no matching `captured_item`. These are candidates for manual review or a re-ingest run.
./docs/coverage-slo.md:42:The reconcile command also runs a policy audit: verifies no `observations.transform_policy` tag references a policy key absent from `packages/compost-core/src/policies/registry.ts`.
./docs/coverage-slo.md:60:  observe_id  TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./debates/007-week3-plan-audit/rounds/r001_gemini.md:20:- **现状**: `wiki.ts` 的 `synthesizePage` 成功生成 Markdown 后更新了 `wiki_pages` 表，但没有记录审计。
./debates/007-week3-plan-audit/rounds/r001_codex.md:15:- wiki fallback 不标脏 -> `ask.ts` 继续读旧页；补 `wiki_pages.stale_at` + banner。
./debates/007-week3-plan-audit/rounds/r001_codex.md:25:2. 先补 `wiki_pages.stale_at` 和 breaker site-key。
./packages/compost-core/src/schema/0009_phase3_contradiction_and_wiki_versions.sql:8:  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
./debates/011-week4-plan/synthesis.md:42:  - `stale_wiki`: `wiki_pages.stale_at IS NOT NULL` 聚合
./debates/011-week4-plan/synthesis.md:47:- 剩 4 scan: `stale_fact` / `unresolved_contradiction` / `orphan_delta` / `correction_candidate` (后者从 `correction_events` 聚合, 最便宜; `orphan_delta` 用 `fact_links` 零入边)
./debates/011-week4-plan/synthesis.md:72:| Phase 4 P1 (open_problems / origin_hash / bench / PII) 4 项 | 非 Week 4 路径依赖; scope creep |
./docs/debate3/rounds/r002_gemini.md:15:However, **this does not fix the cross-machine rebuild story**. Codex's `derivation_run` relies on a random `derivation_id` PK. If my laptop and desktop both sync the same L0 observations and run the identical `transform_policy`, Codex's schema generates two *different* derivation runs for the exact same deterministic output. This creates split-brain L1/L2 states across machines. For a true multi-machine ecosystem, derivation identity must be a deterministic hash of `(observe_id, layer, transform_policy_hash, model_id)`—not a random UUID. Without cross-machine identity, Codex has merely formalized the local-only silo.
./docs/debate3/rounds/r002_gemini.md:25:My R1 thesis argued that `transform_policy` must live in the L0 ledger as data, not as TypeScript code. Codex's `derivation_run` schema highlights exactly why: it stores `transform_policy` as a text string (e.g., "tp-2026-04-02"). This is a foreign key to nowhere. If an agent syncs the L0 ledger, it sees "tp-2026-04-02" but has *no idea* what the chunk size or prompt was, because the policy is locked in the first machine's `compost-core` TypeScript source. The policy *must* be an explicit table (`policies(policy_id, chunk_size, prompt_template, model_id)`) synced via the ledger, so any agent on any machine can deterministically re-derive it.
./docs/debate3/synthesis.md:31:1. **`derivations` PK bug is real.** `(observe_id, layer, model_id)` cannot represent two rows differing only in `transform_policy`. Policy-only revisions (chunk overlap change, prompt version bump) collide. The entire rebuild story depends on fixing this. Credit: Codex R1.
./docs/debate3/synthesis.md:39:5. **`wiki_pages.contributing_observes` JSON array breaks L3 freshness at scale.** Full table scans with no index path. Credit: Sonnet R1.
./docs/debate3/synthesis.md:59:### Q3. transform_policy: TypeScript code or SQL ledger data?
./docs/debate3/synthesis.md:98:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./docs/debate3/synthesis.md:100:  transform_policy TEXT NOT NULL,
./docs/debate3/synthesis.md:112:    observe_id || ':' || layer || ':' || transform_policy || ':' ||
./docs/debate3/synthesis.md:119:  ON derivation_run(observe_id, layer, transform_policy, model_id,
./docs/debate3/synthesis.md:127:-- (2) transform_policy as ledger-resident data
./docs/debate3/synthesis.md:151:-- Remove `contexts TEXT` from facts, source, wiki_pages; replace with join tables:
./docs/debate3/synthesis.md:170:  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
./docs/debate3/synthesis.md:171:  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
./docs/debate3/synthesis.md:176:-- Remove wiki_pages.contributing_observes column (migration recreates wiki_pages)
./docs/debate3/synthesis.md:209:1. Seed 3 deterministic observations from committed fixtures
./docs/debate3/synthesis.md:210:2. Run extraction under fixed `transform_policy = 'tp-2026-04'`
./docs/debate3/synthesis.md:232:  "transform_policy": "tp-2026-04",
./docs/debate3/synthesis.md:240:**Idempotency**: `observations.(adapter, source_id, idempotency_key)` UNIQUE constraint stays context-blind. Same Slack message captured in two contexts = ONE observation row, TWO derivation_run rows, TWO L1 artifact sets.
./docs/debate3/synthesis.md:248:Strongest contribution: forced the group to confront cross-machine identity (`content_hash` convergence), `transform_policy` as ledger data (not TypeScript code), and the strategic observation that Phase 0 is building a "local-only silo" unless these are addressed. Lost Q1 (hierarchy) and Q4 (extractor context) but got the essential concerns baked in through Sonnet's bridge compromises. The "strategic dead end" framing sharpened everyone else's thinking even when Gemini's specific fixes were rejected as over-engineering for Phase 0.
./docs/debate3/synthesis.md:258:Strongest contribution: the unifying compromises in R2/R3. Where Gemini and Codex pulled in different strategic directions, Sonnet found the bridges: (a) UUID PK + generated content_hash column, (b) SQL policies table populated via TypeScript upsert, (c) flat context now with hierarchical-path-safe IDs for Phase 2 backfill. Also the two most grounded risk finds: `wiki_pages.contributing_observes` JSON as a scaling cliff, and the observation that Step 13b rebuild test must pin policy name explicitly (otherwise rebuild auto-selecting newer policy makes assertion trivially pass). Conceded fully to Codex R1 on the derivations bug.
./docs/debate3/synthesis.md:294:| Full `transform_policy` ledger-sync (not just upsert) | ⏸ Phase 2 |
./docs/debate3/synthesis.md:308:- **§1.7**: remove `contributing_observes TEXT` from `wiki_pages`; add reference to `wiki_page_observe` join
./debates/007-week3-plan-audit/rounds/r001_opus.md:78:- **问题**: ARCHITECTURE.md 提到 `source.kind == 'wiki-rebuild'` 但 `source.kind` CHECK enum 不含此值. 要么 migration 加 enum 要么 drop 规则. Wiki.ts **写 markdown 到磁盘**, 不 create observations — 所以"upstream source.kind" 路径不存在.
./debates/007-week3-plan-audit/rounds/r001_opus.md:105:- **决议**: `talking_profile` 不存在 (实际是 tp-xxx 字符串 id in observations.transform_policy). 加 provider 列需要先建 profile table, 这是 Phase 5 规模. Week 3 不做.
./debates/007-week3-plan-audit/rounds/r001_opus.md:117:- **预防**: 接受. Week 3 不持久化 breaker state. Week 5+ 如果 observe 到"重启 storm", 再加 health_signals.stuck_llm kind 记录.
./debates/011-week4-plan/rounds/r001_opus.md:12:  audit 行写入, (b) 注入 `mode:"error"` 后 `wiki_pages.stale_at` 被 set.
./debates/011-week4-plan/rounds/r001_opus.md:22:  `low_coverage`. 确认 `health_signals` CHECK constraint 覆盖这 5 个 (migration
./debates/011-week4-plan/rounds/r001_opus.md:27:  - `scanCorrectionCandidate` → 从 `correction_events` 直接聚合
./debates/011-week4-plan/rounds/r001_opus.md:28:  - `scanStaleWiki` → `SELECT * FROM wiki_pages WHERE stale_at IS NOT NULL`
./debates/011-week4-plan/rounds/r001_opus.md:39:  `health_signals` (kind='stale_wiki', target_id=pagePath). 这把 debate 010
./debates/011-week4-plan/rounds/r001_opus.md:41:- 测试: CLI test + wiki fallback test 加一个 assertion 验证 `health_signals`
./debates/011-week4-plan/rounds/r001_opus.md:48:  先按 `question` slug (小写+连字符) 查 `wiki_pages.path` — 若 match, 加载
./debates/011-week4-plan/rounds/r001_opus.md:75:- **Phase 4 P1** (open_problems / origin_hash / bench / PII): 全部 P1, 与
./debates/011-week4-plan/rounds/r001_opus.md:91:`scanOrphanFact` / `scanStaleCluster` 要 JOIN `facts` + `fact_links` +
./debates/011-week4-plan/rounds/r001_opus.md:92:`graph_health_snapshot`. 当前 dogfood 数据集小, 但 bench harness 没上
./debates/011-week4-plan/rounds/r001_opus.md:95:bench 到 Week 5.
./debates/011-week4-plan/rounds/r001_opus.md:109:- [ ] `health_signals` 在 `stale_wiki` 路径真正写入 (code + test)
./debates/011-week4-plan/contract.md:11:The 6 kinds, aligned with migration 0010 `health_signals.kind` CHECK + 0012
./debates/011-week4-plan/contract.md:19:| `orphan_delta` | `fact_links` in-degree + out-degree = 0 AND no `access_log` hit in `orphanAccessDays` (default 30) AND created before the window | `scanOrphanDelta` | `facts` + `fact_links` + `access_log` |
./debates/011-week4-plan/contract.md:20:| `stale_wiki` | `wiki_pages.stale_at IS NOT NULL` OR `last_synthesis_at IS NULL` OR `last_synthesis_at < now - staleWikiDays` | `scanStaleWiki` | `wiki_pages` |
./debates/011-week4-plan/contract.md:21:| `correction_candidate` | One row per `correction_events` entry; **no scanner** — written directly by `correction-detector.scanObservationForCorrection` during the drain hook (debate 006 Pre-Week-2 Fix 5). `triage()` only aggregates it into the report. | drain-hook producer | `correction_events` |
./debates/011-week4-plan/contract.md:25:- Surface-only: scanners NEVER mutate `facts` / `fact_links` / any business table.
./debates/011-week4-plan/contract.md:68:- `open_problems` / `origin_hash` / bench / PII redactor (Phase 4 P1)
./debates/011-week4-plan/rounds/r001_codex.md:4:- Day1：锁 P0-1：`triage list --kind --limit`、surface-only、`stale_wiki<-wiki_pages.stale_at`、`correction_candidate` 不改 `facts.confidence`。随后先并 `daemon/main.ts:82` 与 `daemon/mcp-server.ts:53,210-214`。并行：删 `core/schema/0010_phase4_myco_integration.sql:82` 注释、整 `daemon/scheduler.ts:1-15,449-455` import。
./debates/018-length-check-threshold/r001_codex.md:7:## Q1 (2000 字依据): 没有看到可信硬依据；从 SQLite/FTS5 官方行为看，FTS5 `bm25` 按 token 长度归一而不是按字符阈值工作，SQLite 行溢出也取决于 page size 与整行字节数而不是 `2000` 这个常数，所以 `2000` 最多只是经验值，不应当被当作不可违背的 schema 常量（https://sqlite.org/fts5.html, https://sqlite.org/fileformat.html）。另，Engram 当前并没有做过 2K vs 4K 的真实召回 benchmark，因此“2K 有明显检索优势”这件事未验证。
./debates/011-week4-plan/prompt.md:24:- **P0-1 `compost triage` CLI + `health_signals` 5 种信号扫描** — 核心 Week 4 任务
./debates/011-week4-plan/prompt.md:31:- `open_problems` table + CLI (curiosity/gap replacement)
./debates/011-week4-plan/prompt.md:32:- Inlet `origin_hash` + `method` columns on `observations`
./debates/011-week4-plan/prompt.md:33:- Performance benchmark harness (`bench/reflect-1k/10k/100k.bench.ts`)
./debates/007-week3-plan-audit/synthesis.md:69:### Lock 6 (MEDIUM, Codex unique): 加 `wiki_pages.stale_at` migration 0013
./debates/007-week3-plan-audit/synthesis.md:71:- **修复**: migration 0013 加 `ALTER TABLE wiki_pages ADD COLUMN stale_at TEXT`. wiki.ts fallback 时设 stale_at = now. ask.ts 读时若 stale_at IS NOT NULL 加 `[stale wiki: {date}]` 前缀.
./debates/007-week3-plan-audit/synthesis.md:86:| wiki_pages.stale_at migration | — | — | **Gap (unique)** | — |
./debates/007-week3-plan-audit/synthesis.md:111:- migration 0013 加 `wiki_pages.stale_at` + wiki.ts fallback 设置它
./debates/007-week3-plan-audit/state.json:19:    "migration 0013: wiki_pages.stale_at + wiki.ts fallback + ask.ts stale-read prefix"
./debates/007-week3-plan-audit/state.json:27:      "added": ["wiki_pages.stale_at migration", "ask.ts stale read prefix", "createLLMServiceFromEnv helper for mcp-server.ts:201 refactor"],
./debates/009-week3-audit/synthesis.md:49:- **位置**: `reflect.ts:244-256` — `recordDecision` 调用在 `db.transaction` 内, throw 会回滚 contradiction arbitration + fact_links edges.
./packages/compost-core/src/schema/0013_wiki_stale_at.sql:3:-- Adds `wiki_pages.stale_at` to support the P0-6 wiki circuit-breaker fallback.
./packages/compost-core/src/schema/0013_wiki_stale_at.sql:7:--      keeps the existing markdown on disk BUT marks wiki_pages.stale_at = now.
./packages/compost-core/src/schema/0013_wiki_stale_at.sql:18:ALTER TABLE wiki_pages ADD COLUMN stale_at TEXT;
./packages/compost-core/src/schema/0013_wiki_stale_at.sql:20:CREATE INDEX IF NOT EXISTS idx_wiki_pages_stale
./packages/compost-core/src/schema/0013_wiki_stale_at.sql:21:  ON wiki_pages(stale_at) WHERE stale_at IS NOT NULL;
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:37:### B3. `v_graph_health` stub 暴露给 scheduler 但 fact_links 表不存在 [高]
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:43:**影响**: 每次 snapshot 任务失败并写入 health_signals error, 产生噪音循环.
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:45:**最小修复**: `graph_health_snapshot` 的 `orphan_facts / density / cluster_count` 加 `DEFAULT 0` 或改为 `NULLABLE`; 或 snapshot 代码在 fact_links 不存在时跳过. 一行 SQL 修复, 在 migration 0010 或 0011 中.
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:57:**影响**: 矛盾仲裁结果被 import 覆盖, correction_events / decision_audit 链断裂.
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:73:**最小修复**: Phase 4 P1 阶段加一个 `compost bench` 子命令, 生成 N=1K/10K/100K 合成 facts 并测量 reflect / query / ask 耗时. 不需要优化, 只需要数据.
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:84:[fact_links 表] ──────────────────────────────────────────────────────────┐
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:86:[P0-4 archive_reason] → [P0-2 decision_audit] → [P0-1 health_signals] → [P0-3 graph_health]
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:88:                        [P0-5 correction_events]
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:94:2. **P0-5 并行** (`hook-shim` 扩展): 与其他 P0 无依赖, 独立实现 correction_events 捕获.
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:96:4. **fact_links 表** (Phase 3 carried, 但 P0-3 的真实前置条件): 必须在 P0-3 TS 实现前落地.
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:97:5. **P0-3 最后** (`graph-health.ts`): 依赖 fact_links. 当前 v_graph_health stub 已在 DB, TS 层推迟实现完全没问题.
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:100:### 特别裁决: P0-3 是否应先做 fact_links?
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:102:**是的, fact_links 必须先于 P0-3 TS 实现落地.**
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:104:理由: `graph_health_snapshot` 的 `orphan_facts / density / cluster_count` 三列在 fact_links 不存在时无法填充真实值. 当前 0010 migration 的 stub view 返回 NULL, 这对 schema 是安全的, 但 P0-3 的 TS 实现如果在 fact_links 前写入 snapshot, 将产生全零/NULL 快照, 污染历史数据. 建议: fact_links 表 migration (0011) 先 merge, P0-3 TS 实现与 fact_links 功能捆绑同一 PR, 不单独发 P0-3.
./debates/002-roadmap-gap-audit/rounds/r001_sonnet.md:126:**替代**: 先做 B5 建议的 `compost bench`, 建立 chunk quality 指标 (如 average fact count per chunk, retrieval hit rate per chunk type). 有数据后若 heading-based 明显不足再引入. 不做承诺的 "P1 carried" 比 Reject 更危险 — 它占据 Phase 4 的心智带宽.
./debates/013-week4-audit/synthesis.md:22:| TD | resolveSignal 无 TTL / health_signals 无界增长 | D3 | T1/T2 | — | — | tech debt |
./debates/013-week4-audit/synthesis.md:94:   新建 wiki_pages 行没 synth 过的情况能被 surface.
./debates/013-week4-audit/synthesis.md:101:| `upsertSignal` 24h 冷却窗口 | Opus D3 + Codex T2 | 观察到 health_signals 增长异常 |
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:9:### 盲点 1: P0-3 graph_health 的 fact_links 依赖未排序 (P4 P0)
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:10:- **描述**: migration 0010 创建了 `v_graph_health` view, 但 view body 注释明说 "stub. 实际指标 NULL until fact_links table exists". `cognitive/graph-health.ts` 三个函数全部 return null 或 throw. 而 fact_links 表是 Phase 4 carried 列表里 "Fact-to-fact links graph + recursive CTE traversal" — 没有 P0 标签.
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:11:- **触发条件**: 实现 P0 顺序时, 想做 graph_health 但发现 fact_links 不存在. 写 fact_links 是中等工程 (设计 edge schema + 双向 vs 单向 + 边类型枚举 + 递归 CTE 测试 + 反向索引), 至少 2-3 天.
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:27:- **最小修复**: 加 `bench/` 目录, 至少 3 个 benchmark: `reflect-1k.bench.ts`, `reflect-10k.bench.ts`, `reflect-100k.bench.ts`. 每个 PR 跑一次, 写入 `benchmarks.json`. 回归 > 50% 报警.
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:31:- **描述**: hook-shim 捕获 Claude Code 的所有 tool use payload. 用户在 chat 里 paste API key / 信用卡号 / 密码 → 全部进 observations 表 → embedding → 永久存储. Compost 反而成为信用卡泄漏中心.
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:51:  1. fact_links 表 + 双向 link API (盲点 1, 原 carried 提到 P0-0): 解锁 P0-3
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:56:                    输出: health_signals 表, signals → audit
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:61:  6. P0-5 correction_events → 依赖: hook-shim (已有)
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:63:  7. P0-3 graph_health → 依赖: fact_links 表 (Pre-P0 #1)
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:67:  8. open_problems (consolidates 旧 curiosity + gap)
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:72:**关键裁决**: fact_links 必须在 P0-3 之前 land. ROADMAP 里 carried 列表的"fact-to-fact links graph + recursive CTE"应明确标记 **prerequisite for P0-3**, 否则 P0-3 是 stub.
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:105:### New 2: Performance Benchmark Harness (盲点 3, P4 P1)
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:106:- `bench/` 目录 + bun:test 兼容的 `*.bench.ts`
./debates/002-roadmap-gap-audit/rounds/r001_opus.md:109:- 写入 `benchmarks.json` 跟踪趋势
./debates/005-cumulative-review/rounds/r001_sonnet.md:13:**问题**: `SignalKind` union 仍只有 5 个成员，缺少 `'correction_candidate'`。`correction-detector.ts` 在注释里写了"结果通过 `health_signals` (kind='correction_candidate') 流向 triage"（`correction-detector.ts:88`），但 `triage.ts` 的 `byKind` 字段的键类型是 `Record<SignalKind, number>`。当 correction-detector 实际写入数据库后，`triage()` 将无法在 `byKind` 里统计该 kind。更糟的是，TypeScript 不会报错——`byKind` 只是运行时的 SQL GROUP BY 结果映射，编译器不感知。
./debates/005-cumulative-review/rounds/r001_sonnet.md:77:**file:line**: `cognitive/graph-health.ts:7-10` (接口), `schema/0011_fact_links_and_health_fix.sql:45-52` (重建表定义)
./debates/005-cumulative-review/rounds/r001_sonnet.md:89:-  orphanFacts: number | null;        // null until fact_links table exists
./debates/005-cumulative-review/rounds/r001_sonnet.md:109:### P4. `fact_links` 表已落地，`reflect.ts` 矛盾仲裁写 `superseded_by` 但从不写 `contradicts` 边 — 图永远缺少最有价值的边类型
./debates/005-cumulative-review/rounds/r001_sonnet.md:111:**file:line**: `cognitive/reflect.ts:223-238` (supStmt 写路径), `cognitive/fact-links.ts:50` (addLink API), `schema/0011_fact_links_and_health_fix.sql:23` (`contradicts` kind)
./debates/005-cumulative-review/rounds/r001_sonnet.md:113:**问题**: `fact_links` 的 `contradicts` kind 是图谱中语义最强的边——"这个事实推翻了那个"。`reflect.ts` 矛盾仲裁已知道 winner/loser 对，却只写 `facts.superseded_by`，没有调用 `addLink(db, winnerId, loserId, 'contradicts')`。`v_graph_health` 的 density 计算、`findOrphans`、`connectedComponents` 全部依赖 fact_links 边。没有 `contradicts` 边，经过仲裁的 loser 仍然算 orphan，density 被低估，图结构误导 P0-3 指标。
./debates/005-cumulative-review/rounds/r001_sonnet.md:134:**file:line**: `schema/0010_phase4_myco_integration.sql:72`, `schema/0011_fact_links_and_health_fix.sql:51`, `cognitive/fact-links.ts:353-376` (graphStats 不含 stale_cluster)
./debates/005-cumulative-review/rounds/r001_sonnet.md:183:`fact-links.ts:findOrphans` (line 259-280) 和 `0011:v_graph_health` (line 76-81) 都实现了"active fact + no fact_links edge + age > threshold"逻辑，两者 SQL 结构几乎相同但 view 用 24h 硬编码而 `findOrphans` 接受参数。
./debates/005-cumulative-review/rounds/r001_sonnet.md:201:2. **`reflect.ts` 矛盾仲裁调用 `addLink('contradicts', ...)`** (问题 P4)。`addLink` 已完全实现，reflect 已知 winner/loser 对，两行 import+调用即可修复。不修复则 fact_links 表的 `contradicts` 边在整个系统生命周期内一直为空，P0-3 所有图指标失真。
./debates/005-cumulative-review/rounds/r001_sonnet.md:219:7 个 commit 作为整体看，骨架扎实但存在三条断掉的闭环: `SignalKind` 类型与 0012 SQL 脱节、`decision_audit` 合同在 reflect 写路径缺调用、`fact_links` 的 `contradicts` 边永远不会被填充——三者都是已实现代码之间的连接缺失，不是 stub 问题，Week 2 前修完代价极低但不修则会在 P0 验收时集体爆发。
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:5:-- P0-1: health_signals — boot-time triage surface (6 signal kinds with 0012 amendment, no auto-execute)
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:9:-- P0-5: correction_events — explicit self-correction signal capture
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:12:-- P0-1: health_signals (compost triage surface)
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:14:CREATE TABLE IF NOT EXISTS health_signals (
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:21:    'stale_wiki'                   -- wiki_pages.last_synthesis_at past threshold
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:31:CREATE INDEX IF NOT EXISTS idx_health_signals_unresolved
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:32:  ON health_signals(created_at) WHERE resolved_at IS NULL;
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:33:CREATE INDEX IF NOT EXISTS idx_health_signals_kind
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:34:  ON health_signals(kind, created_at);
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:69:  orphan_facts INTEGER NOT NULL,             -- facts older than 24h with no fact_links edges
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:70:  density REAL NOT NULL,                     -- edges / nodes (Phase 4 fact_links graph)
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:77:-- once fact_links table from Phase 4 fact-graph subtask lands.
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:82:  NULL AS orphan_facts,           -- stub; superseded by migration 0011 (fact_links-backed view)
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:112:-- P0-5: correction_events (self-correction signal capture)
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:114:CREATE TABLE IF NOT EXISTS correction_events (
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:125:CREATE INDEX IF NOT EXISTS idx_correction_events_unprocessed
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:126:  ON correction_events(created_at) WHERE processed_at IS NULL;
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:127:CREATE INDEX IF NOT EXISTS idx_correction_events_session
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql:128:  ON correction_events(session_id, created_at);
./debates/017-execution-checklist/context.md:17:   - 用来决定迁移策略（truncate / 降级到 compost_cache / fail-fast）
./debates/017-execution-checklist/context.md:29:   - compost_cache 表 (DDL 先建空, 数据层 v3.5 再做)
./debates/014-roadmap-direction/rounds/r001_sonnet.md:7:3. **bench harness** — 没 baseline 谈不上回归. 但只有发现真的慢才值得做, 优先级低于 1+2.
./debates/014-roadmap-direction/rounds/r001_sonnet.md:8:4. **open_problems** — 用过 triage 才知道 gap tracker 长什么样, 现在做就是二次发明.
./debates/014-roadmap-direction/rounds/r001_sonnet.md:9:5. **origin_hash** — 纯 schema 加列, 没 query 消费者, 最后做.
./debates/014-roadmap-direction/rounds/r001_sonnet.md:25:1. **Eval harness**: 没指标判断 ask() 答得对不对. 改 ranking_profile / 换 LLM / 加多查询 全凭感觉. 比 bench 更紧迫 — bench 测速度, eval 测正确性.
./debates/002-roadmap-gap-audit/rounds/r002_codex.md:2:- `fact_links`是P0-3前置。Sonnet说`snapshot`会撞约束，Opus说17项会膨胀，我R1已称其为假交付。
./debates/002-roadmap-gap-audit/rounds/r002_codex.md:3:- Batch D多项仍是stub。Sonnet砍dashboard，Gemini要`correction_events`先进triage，不应直改事实。
./debates/002-roadmap-gap-audit/rounds/r002_codex.md:8:- 反对Gemini先做`triage`；没有`archive_reason`/`decision_audit`/`fact_links`，它只读空信号。
./debates/002-roadmap-gap-audit/rounds/r002_codex.md:12:- B: `graph_health`后移，`fact_links`升P0-0。
./debates/002-roadmap-gap-audit/rounds/r002_codex.md:16:1. `fact_links`
./debates/002-roadmap-gap-audit/rounds/r002_codex.md:20:5. `correction_events`
./debates/005-cumulative-review/rounds/r001_opus.md:9:### Issue 1 (HIGH): fact_links 是空表, reflect 没写, 没人写
./debates/005-cumulative-review/rounds/r001_opus.md:11:- **问题**: 0011 migration 创建了 `fact_links` 表, 1370ba6 landed TS API. 但 grep 整个 src/ 发现**没有任何调用路径写入 fact_links**. reflect.ts 的 contradiction step 自然是最合适的 caller (loser→winner 是 `contradicts` 边), 但 a4efbe2 只写 superseded_by + replaced_by_fact_id, 没调 `addLink`.
./debates/005-cumulative-review/rounds/r001_opus.md:13:- **影响**: Week 2 P0-3 graph_health 会基于**永远为空的 fact_links** 计算信号. `v_graph_health` 返回 density=0, orphan_count=所有 active facts. Triage 的 orphan_delta 信号会全触发, 产生噪音洪水.
./debates/005-cumulative-review/rounds/r001_opus.md:18:  需 import `addLink` from `../cognitive/fact-links`. 加 1 个测试: reflect 跑完后 `fact_links WHERE kind='contradicts'` 有行.
./debates/005-cumulative-review/rounds/r001_opus.md:39:  // `source: { fact_ids: string[], wiki_pages: string[] }` hash.
./debates/005-cumulative-review/rounds/r001_opus.md:44:- **文件**: `schema/0010_phase4_myco_integration.sql`, `schema/0011_fact_links_and_health_fix.sql`, `schema/0012_correction_signal_kind.sql`
./debates/005-cumulative-review/rounds/r001_opus.md:45:- **问题**: 0010 创建 `graph_health_snapshot` 用 NOT NULL 无 DEFAULT (bug), 然后 0011 DROP + recreate 修. 0010 创建 `health_signals` CHECK 缺 `correction_candidate` (bug), 然后 0012 DROP + recreate 修. 新 clone 的人 apply 12 个 migrations 时一切正常, 但读 schema 历史的人会迷惑.
./debates/005-cumulative-review/rounds/r001_opus.md:118:**跨 commit 审暴露 2 个 contract-reality 漂移** (fact_links 永空 / decision_audit 永空), 但无功能性 runtime bug. 补 1 行 addLink + 2 处文档诚实化即可进 Week 2.
./debates/013-week4-audit/prompt.md:48:- Phase 4 P1 (open_problems / origin_hash / bench / PII) → Week 5+
./debates/013-week4-audit/prompt.md:56:- surface-only: scanner 有没有意外 mutate facts / fact_links?
./debates/013-week4-audit/prompt.md:59:`upsertSignal` 只去重 **unresolved** 信号. `resolveSignal` 后再 triage, 会写新信号 (代码注释说是 "correct surfacing behavior"). 但测试 `triage P0-1 aggregate + resolveSignal > resolveSignal flips a row to resolved; subsequent triage re-emits for still-stuck target` 验证了 target_ref 产生 2 行 (1 resolved + 1 new unresolved). 生产环境一个 stuck outbox 永远修不好 (e.g. poison pill), 会导致 health_signals 表无限增长吗?
./debates/013-week4-audit/prompt.md:64:- `scanOrphanDelta`: NOT EXISTS 双 join (fact_links + access_log), 单表扫描 facts. 大表 (100k+) 性能?
./debates/003-p0-readiness/rounds/r001_sonnet.md:15:schema 基础扎实。0010 + 0011 两个 migration 覆盖所有 P0 必需表: `health_signals`, `decision_audit`, `graph_health_snapshot`, `fact_links`, `correction_events`, 以及 `facts` 三列扩展。0011 正确修复了我在 debate 002 B3 发现的 NOT NULL bug (DROP/recreate + DEFAULT 0)，并且把 `v_graph_health` 从空壳 view 升级为 fact_links 驱动的实现。
./debates/003-p0-readiness/rounds/r001_sonnet.md:26:`hook-shim/src/index.ts` 验证: 纯 SQLite outbox append，没有对 correction_events 或 triage 的调用。P0-5 加入 correction 检测时需要在 **daemon post-drain** 路径挂，不是在 shim 里，合规。
./debates/003-p0-readiness/rounds/r001_sonnet.md:31:2. **P0-0 fact_links 的 recursive CTE API 需要事先确定接口签名**: `graph-health.ts` 的 `delta()` 依赖它，P0-3 紧跟。接口未定就开始 P0-3 TS 实现会引入协调浪费。
./debates/003-p0-readiness/rounds/r001_sonnet.md:32:3. **`correction-detector.ts` 的 `health_signals` 写入路径在 P0-5 完成前必须明确**: 目前 `findRelatedFacts()` 返回 `string[]` 但 comment 说"流入 triage"，然而 `health_signals` 的 CHECK constraint 没有 `correction_candidate` kind。写入前必须确认是加新 kind 还是复用 `unresolved_contradiction`。
./debates/003-p0-readiness/rounds/r001_sonnet.md:40:### 风险 A: correction_kind 不在 health_signals CHECK 约束
./debates/003-p0-readiness/rounds/r001_sonnet.md:43:- **触发场景**: P0-5 实现 `recordCorrection` 后，调用 `findRelatedFacts()` 把结果写入 `health_signals`，但 `kind` CHECK 只允许 5 个值，没有 `correction_candidate`。
./debates/003-p0-readiness/rounds/r001_sonnet.md:67:**Week 1**: P0-7 (Day 1 优先，生产有数据后立即) + P0-0 (fact_links migration + CTE API 接口定稿)
./debates/003-p0-readiness/rounds/r001_sonnet.md:75:**Week 4**: P0-1 (triage 整合全部信号源，P0-3/P0-5 提供信号) + 集成测试 + benchmark fixture
./debates/003-p0-readiness/rounds/r001_sonnet.md:77:> **调整**: P0-1 放 Week 4 正确，因为它消费所有其他 P0 产出的信号。Week 4 benchmark 应与 P0-1 并行，不是 P0-1 完成后。
./debates/003-p0-readiness/rounds/r001_sonnet.md:87:### 盲点 2: correction_events processed_at 消费路径无测试
./debates/003-p0-readiness/rounds/r001_sonnet.md:88:- **位置**: `correction-detector.ts` 的 `findRelatedFacts()` 输出"流入 triage"，但 triage.ts 当前不消费 correction_events。两者之间的管道完全没有集成测试。
./debates/003-p0-readiness/rounds/r001_sonnet.md:91:### 盲点 3 (额外): fact_links ON DELETE CASCADE 行为未验证
./debates/003-p0-readiness/rounds/r001_sonnet.md:99:### 条件 1: fact_links recursive CTE 在 5K facts 时阻塞 > 200ms
./debates/003-p0-readiness/rounds/r001_sonnet.md:101:- **动作**: 暂停 P0-3 的 cluster_count 实现，退化到 view 中返回常量 0 (0011 已这样做)，把完整 CTE 推迟到 P1 benchmark harness 建立后评估。不阻塞其他 P0。
./debates/013-week4-audit/rounds/r001_opus.md:47:### D3 (MEDIUM) `upsertSignal` 对永不修复的 target 会让 health_signals 无界增长
./debates/013-week4-audit/rounds/r001_opus.md:51:behavior"). 一年内每日 resolve 一次 poison pill → 365 行 health_signals.
./debates/013-week4-audit/rounds/r001_opus.md:63:替代: (a) 取 question 第一 noun phrase (复杂), (b) FTS5 查 `wiki_pages`
./debates/013-week4-audit/rounds/r001_opus.md:87:dogfood 观察到 health_signals > 1k 行.
./debates/017-execution-checklist/r001_opus.md:56:3. **Schema DSL 未来扩展性**: 如果今天只写 memories_v2 的 DSL，明天加 compost_cache 就要扩展 DSL。建议 DSL 从 day 1 就支持多表声明，不要写死。
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:1:-- Migration 0011_fact_links_and_health_fix.sql
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:4:--   1. Promote `fact_links` to P0-0 (was Phase 3 carried) — prerequisite for P0-3 graph_health
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:6:--   3. Replace v_graph_health stub with real implementation backed by fact_links
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:9:-- Part 1: fact_links table (P0-0)
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:14:CREATE TABLE IF NOT EXISTS fact_links (
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:31:CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_links_unique
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:32:  ON fact_links(from_fact_id, to_fact_id, kind);
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:33:CREATE INDEX IF NOT EXISTS idx_fact_links_from ON fact_links(from_fact_id);
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:34:CREATE INDEX IF NOT EXISTS idx_fact_links_to ON fact_links(to_fact_id);
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:35:CREATE INDEX IF NOT EXISTS idx_fact_links_kind ON fact_links(kind, created_at);
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:55:-- Part 3: Replace v_graph_health stub with fact_links-backed view
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:66:  SELECT from_fact_id AS fact_id FROM fact_links
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:68:  SELECT to_fact_id AS fact_id FROM fact_links
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql:85:    ELSE CAST((SELECT COUNT(*) FROM fact_links) AS REAL)
./debates/008-tier-shape-questions/rounds/r001_opus.md:28:- 理由: wiki rebuild 的直接输入是**facts**, 不是 observations. observe_ids 是一层间接, audit 读者若要知道 "用了哪些 observation" 总能 `JOIN facts ON fact_id → observe_id`. 存 both 是 1.5× storage 冗余 (典型 wiki 页 20-50 facts).
./debates/003-p0-readiness/rounds/r001_opus.md:37:- **触发**: fact_links 实施完, 用户 dogfood 累积 10K+ facts + 50K+ links. `v_graph_health` 的 orphan 计算用 LEFT JOIN + WHERE created_at < 24h, 在大表上是全表扫. 触发 `compost triage` (P0-1 每次调用)就 200ms+.
./debates/003-p0-readiness/rounds/r001_opus.md:39:- **预防**: P0-3 实施时给 fact_links 加 covering index `(from_fact_id, to_fact_id)`, 给 facts 加 `(archived_at, created_at)` partial index. 写 benchmark fixture 验证 < 50ms @ 10K facts.
./debates/003-p0-readiness/rounds/r001_opus.md:44:- **预防**: PII redact (P1) 必须有性能 benchmark gate, 必须 < 5ms 增量. 否则不允许进 hook-shim, 改在 daemon drain 阶段 (但失去拦截价值, 退而求其次只能 redact 已存的).
./debates/003-p0-readiness/rounds/r001_opus.md:54:  P0-0 fact_links migration 已 land (commit 8f3100a). 实际 Week 1 是写
./debates/003-p0-readiness/rounds/r001_opus.md:55:       fact_links **API + recursive CTE TS 实现** (packages/compost-core/src/cognitive/fact-links.ts
./debates/003-p0-readiness/rounds/r001_opus.md:63:  P0-5 correction_events 捕获 (独立, 与上面并行)
./debates/003-p0-readiness/rounds/r001_opus.md:70:  集成测试 + benchmark fixture (P1 启动)
./debates/003-p0-readiness/rounds/r001_opus.md:97:fact_links 估算 M (3-5 天). 如果 Week 1 结束 fact_links 仍未通过测试 (recursive CTE 实现卡 / FK CASCADE 与现有 facts 表冲突 / API 设计反复改), **暂停**. 评估: 是不是 fact-graph 不该走 SQLite 应该走专门的 graph 库 (LanceDB graph extension / sqlite-vec)?
./debates/003-p0-readiness/rounds/r001_opus.md:99:### 撤退条件 2: P0-3 benchmark > 200ms @ 10K facts
./debates/005-cumulative-review/rounds/r001_gemini.md:8:- **影响**: 所有的 Phase 4 P0 模块虽然有了代码库，但在运行时均处于“死代码”状态。`correction_events` 表永远不会被写入，`health_signals` 永远不会生成。
./debates/005-cumulative-review/rounds/r001_gemini.md:11:### [P0] `reflect.ts` 冲突解决未持久化 `fact_links`
./debates/005-cumulative-review/rounds/r001_gemini.md:27:- **修复**: Python 提取器在 LLM 失败时应向 stderr 输出特定标记，TS 侧 `startIngestWorker` 捕获后生成 `health_signals` (kind='stuck_outbox')。
./debates/005-cumulative-review/rounds/r001_gemini.md:37:- **统一信号生成器**: `triage.ts` 应作为 `health_signals` 的唯一权威源。目前的 `correction-detector.ts` 和 `scheduler.ts` 散落在各处尝试写入信号。建议将所有“扫描异常”的逻辑收拢到 `triage(db)` 的定期全量/增量扫描中。
./debates/005-cumulative-review/rounds/r001_gemini.md:47:2. **Correction Loop**: 在 `startDrainLoop` 中调用 `detectCorrection`，确保 `correction_events` 有数据流。
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:5:### 共识 1: `fact_links` 是 P0-3 的隐性必修前置 (4/4)
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:6:- Opus R1 §盲点 1: "P0-3 是 stub until fact_links exists"
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:7:- Sonnet R1 §B3: "v_graph_health stub 暴露但 fact_links 不存在 → snapshot 写入会爆 NOT NULL constraint"
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:8:- Codex R1 §1: "graph_health 是假交付, 必须先做 fact_links + 双 ON DELETE CASCADE"
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:9:- Gemini R1 §2: "必须先做 fact_links, 没有边的图是统计列表"
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:11:**根因**: ROADMAP 把 fact_links 列在 carried (无 tier), Batch D 把 graph_health 标 P0. 这是一个**隐性循环依赖**, 必须在 ROADMAP 里显式画出.
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:46:- **Sonnet 顺序**: P0-4 → P0-5 并行 → P0-2 → fact_links → P0-3 → P0-1
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:47:- **Codex 顺序**: fact_links → audit → archive_reason → correction → graph_health → triage
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:48:- **Gemini 顺序**: triage 先 ("感知层入口") → archive_reason → fact_links → graph_health → audit → correction
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:49:- **Opus R1**: backup + fact_links + PII redact pre-P0, 然后 triage → audit → archive_reason → correction → graph_health
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:65:- **保留**: Batch D 5 P0 (含 backup + fact_links 修正后 = 7 P0)
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:66:- **保留 P1**: open_problems, compression_pressure, shareable export, inlet provenance opt-in (4 项)
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:69:- **新增 P0**: backup, fact_links, LLM provider abstraction (Sonnet+Opus+Gemini 共识), graph_health bug fix (Sonnet B3)
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:72:### 悬案 B: P0-3 graph_health 推迟? 还是 fact_links 提到 P0-0?
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:73:**裁决: fact_links 提到 P0-0 (prerequisite), P0-3 graph_health TS 实现与 fact_links 同 PR**.
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:75:理由 (合并 Sonnet + Codex): fact_links migration 0011 必须在 P0-3 TS 实现前 land. 单独发 P0-3 没意义. 同时 fix Sonnet B3 指出的 NOT NULL 约束 bug — 在 0011 同时 ALTER `graph_health_snapshot` 加 DEFAULT 0.
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:88:| P0-0 | `fact_links` 表 + 双向 link API | NEW (从 carried 提升) | 4/4 共识依赖 |
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:89:| P0-1 | `compost triage` + health_signals (修 NOT NULL bug) | 现有 | Batch D |
./debates/002-roadmap-gap-audit/rounds/r002_opus.md:93:| P0-5 | `correction_events` (信号挂 triage 不直接改 confidence — Gemini §1.5) | 现有 (修正) | Batch D |
./debates/014-roadmap-direction/rounds/r001_opus.md:19:3. **Bench harness + eval 合一** (Q3 扩展, 见下). 有 bench 才敢动 reflect /
./debates/014-roadmap-direction/rounds/r001_opus.md:20:   extractor / ranking. 没 bench 每次优化都赌.
./debates/014-roadmap-direction/rounds/r001_opus.md:22:4. **open_problems** — 放在最后. 现在 `ask()` 能答, `triage` 能提示,
./debates/014-roadmap-direction/rounds/r001_opus.md:23:   `audit` 能追溯. `open_problems` 的价值 (好奇心追踪) 靠用户自己手工记
./debates/014-roadmap-direction/rounds/r001_opus.md:26:**`origin_hash`** 不排名 — 是 Phase 5 / Phase 6 引入多 adapter 时才需要,
./debates/016-roadmap-revalidation/rounds/r001_opus.md:39:- 新建 `engram_compost_cache` 表（独立 schema，独立 MCP tool `recall_compost_cache`），**不进** `recall()` 的默认结果，不参与 `effective_score` 排序。
./debates/016-roadmap-revalidation/rounds/r001_opus.md:106:- 两个系统之间**只有一条耦合**（v3.5 writeback），写清楚"Engram 在没有 Compost 时必须 100% 功能可用"（kill Compost 时删掉 `engram_compost_cache` 表即可）。
./debates/017-execution-checklist/execution-checklist.md:24:- compiled 行策略：`pinned=0` + 保留 (临时) / 移到 compost_cache / DELETE
./debates/017-execution-checklist/execution-checklist.md:25:- length>2000 行策略：truncate / 移到 compost_cache / DELETE
./debates/017-execution-checklist/execution-checklist.md:96:-- 7. 新增 compost_cache 表（DDL only，数据层 v3.5 再做）
./debates/017-execution-checklist/execution-checklist.md:97:CREATE TABLE IF NOT EXISTS compost_cache (
./debates/017-execution-checklist/execution-checklist.md:124:  - `compost_cache` 表存在 + `origin='compiled'` CHECK
./debates/017-execution-checklist/synthesis.md:57:2. 违规行处理策略已书面选定（truncate / drop / downgrade compost_cache）
./debates/012-correctedtext-scoping/rounds/r001_opus.md:6:`storeCorrectionEvent` INSERT 到 `correction_events.corrected_text`
./packages/compost-core/src/schema/0002_debate3_fixes.sql:9:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./packages/compost-core/src/schema/0002_debate3_fixes.sql:11:  transform_policy TEXT NOT NULL,
./packages/compost-core/src/schema/0002_debate3_fixes.sql:22:    observe_id || ':' || layer || ':' || transform_policy || ':' ||
./packages/compost-core/src/schema/0002_debate3_fixes.sql:29:  ON derivation_run(observe_id, layer, transform_policy, model_id,
./packages/compost-core/src/schema/0002_debate3_fixes.sql:36:-- transform_policy table (populated from TypeScript registry at daemon startup)
./packages/compost-core/src/schema/0002_debate3_fixes.sql:77:-- Replace wiki_pages.contributing_observes TEXT with join
./packages/compost-core/src/schema/0002_debate3_fixes.sql:81:  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
./packages/compost-core/src/schema/0002_debate3_fixes.sql:82:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./debates/013-week4-audit/rounds/r001_gemini.md:34:| `ask.ts:54, 185` | Low | 将 LLM/CircuitBreaker 失败从 `console.warn` 转移到 `health_signals` (kind: `llm_failure`)，提高系统自愈可观测性。 | 信号量达到 >1k/day 导致日志洪泛时 |
./debates/005-cumulative-review/synthesis.md:12:- `fact_links` 表永空 (没人调 addLink)
./debates/005-cumulative-review/synthesis.md:23:### Fix 1 (HIGH): reflect.ts 写 `fact_links` contradicts 边
./debates/005-cumulative-review/synthesis.md:123:| fact_links contradicts edges 不写 | ✅ Issue 1 | ✅ P4 | ✅ #1 | ✅ P2 | **4/4 Must Fix** |
./debates/005-cumulative-review/synthesis.md:136:1. **单 commit 视角漏 4 人一致的主题**: debate 004 per-commit review 没抓到 fact_links-never-written 和 decision_audit-never-wired — 因为这些是**跨 commit 的合约-现实漂移**, 每个 commit 单看都"完成了它该做的".
./debates/005-cumulative-review/synthesis.md:157:Commit: "fix(phase4-d): wire fact_links + doc honesty (debate 005)"
./debates/005-cumulative-review/rounds/r001_codex.md:2:1. `reflect.ts:136-247` 从不调 `fact-links.ts:50-91 addLink('contradicts')`，`fact_links` 仍是死表。004 漏因: P0-0/P0-4 分审。修: `reflect.ts:236` 前补 `addLink(loser,winner,'contradicts')`。
./debates/005-cumulative-review/rounds/r001_codex.md:4:3. `0011_fact_links_and_health_fix.sql:59-91` 已有 `v_graph_health`，但 `graph-health.ts:17-51` 仍 stub，`scheduler.ts:397-508` 未调 `takeSnapshot()`。漏因: SQL/TS/scheduler 跨 commit。修: `currentSnapshot()` 查 view，daemon 加 daily snapshot。
./debates/002-roadmap-gap-audit/rounds/r002_gemini.md:5:*   **事实链接 (fact_links) 的前置性：** Codex、Sonnet 和 Opus 均指出，在没有建立实体间显性引用的情况下，`graph_health` 和 `contradiction_detector` 只是空中楼阁。没有 link，所谓的冲突检测只是 LLM 的幻觉推断，而非 graph 结构的逻辑推演。
./debates/002-roadmap-gap-audit/rounds/r002_gemini.md:23:*   **操作：** 接受 Codex 和 Sonnet 的意见。将 `fact_links_engine` 提升至 P0。在没有定义“什么是链接”之前，无法定义“什么是健康的图”。`graph_health` 将作为 P1 任务，依赖于 P0 的链接定义。
./debates/002-roadmap-gap-audit/rounds/r002_gemini.md:31:1.  **fact_links_engine (新增):** 定义实体间的硬链接与引用标准（P0 的基石）。
./debates/003-p0-readiness/rounds/r002_opus.md:5:### C1: `correction_candidate` kind 缺失于 `health_signals` CHECK (Sonnet + Codex)
./debates/003-p0-readiness/rounds/r002_opus.md:7:- Codex R1 §条件 1: "先冻结 `health_signals` 与 correction signal 的枚举契约"
./debates/003-p0-readiness/rounds/r002_opus.md:32:- **Opus 我的裁决**: **Sonnet 对**. Codex 把 P0-0 当成"还没写", 实际 fact_links migration 已 land (commit 8f3100a). P0-0 剩下的是 TS API (`cognitive/fact-links.ts` 新建 — recursive CTE 查询函数). P0-3 是另一个新文件 (`cognitive/graph-health.ts` 改写实现). 两个 TS 模块独立, 应分两个 PR.
./debates/003-p0-readiness/rounds/r002_opus.md:48:1. **修 `correction_candidate` schema 缺失**: 写 migration 0012, ALTER `health_signals.kind` CHECK 加入 `correction_candidate` (Sonnet C1 + Codex C1)
./debates/003-p0-readiness/rounds/r002_opus.md:82:  - 集成测试 + benchmark fixture (P1 启动)
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:34:- **描述**: P0-5 的 `correction_events` 依赖正则捕获。过于激进的正则可能将正常的对话修正误判为对事实的否定。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:37:- **最小修复**: 纠错信号不直接修改 `facts.confidence`，而是先作为 `health_signals` 挂载到 triage，由用户在 `compost triage` 中确认。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:44:针对 `graph_health` 与 `fact_links` 的依赖悬案，我的裁决是：**必须先做 `fact_links`（或将其并入 P0-3）**。没有边的图（Graph）只是一个统计列表，`v_graph_health` 将毫无意义。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:48:1. **P0-1: `compost triage` (health_signals)** — 依赖: 无。这是感知层的入口，必须最先落地以观察后续变更。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:50:3. **Carried-P3: `fact_links` 表** — 依赖: 无。这是 P0-3 的前置。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:51:4. **P0-3: `v_graph_health` + Snapshot** — 依赖: `fact_links`。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:53:6. **P0-5: `correction_events`** — 依赖: `hook-shim` 更新。属于外部信号捕获，优先级排在内核感知之后。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:67:- **理由**: 在 `archive_reason` 和 `triage` 尚未在大规模数据集验证前，单纯定义“压缩压力”是一个玄学指标。建议先让 `health_signals` 跑通，通过 `stale_fact` 的堆积来感知压力，而不是专门做一个 view。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:74:- **理由**: 所有的 P0 审计和健康检查都建立在 SQLite 正常的基础上。作为单机软件，断电导致的 WAL 损坏是高频风险。应增加 `compost backup` 和基于 `observations` 重新提取 `facts` 的灾后重建脚本。
./debates/002-roadmap-gap-audit/rounds/r001_gemini.md:87:**长期风险 (12+ 个月)**：Compost 可能会从“事实库”演变为一个“由 LLM 生成、并由 LLM 持续强化的虚构世界”。我们必须在 `observations` 层级强行禁止任何来自 `wiki/` 目录的再摄入，并严格区分“事实事实”与“合成事实”。
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:9:**C1. fact_links 是 P0-3 的真实阻断前置条件**
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:10:Codex: "应先做 fact_links, 否则 P0-3 只是返回 NULL 的占位 view." Gemini: "没有边的图只是统计列表, v_graph_health 将毫无意义." Opus: "把 fact-to-fact links graph 从 carried 提到 P0-0 (prerequisite)." Sonnet R1: "P0-3 TS 实现与 fact_links 功能捆绑同一 PR." 四方一致, 这是最强共识, 无争议.
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:13:Opus: "所有 Phase 0-6 投入的工程价值在数据丢失瞬间归零. 这是 second brain 的信任契约." Codex: "加 doctor backup/verify/restore + 恢复测试." Gemini: "增加 compost backup 和基于 observations 重新提取 facts 的灾后重建脚本." Sonnet R1: "compost backup 底层调用 VACUUM INTO, 每日自动备份." 四方都提到, root 问题: SQLite 是唯一真相源但没有保护层.
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:16:Codex: "先补 benchmark fixture + CI 阈值." Gemini: "应在 P4 引入 performance_telemetry 表." Opus: "至少 3 个 benchmark: reflect-1k/10k/100k.bench.ts, 回归 > 50% 报警." Sonnet R1: "compost bench 子命令, 生成合成 facts 并测量耗时." 四方一致, root 问题: 路线图目标 100 万 facts 但从不测量.
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:43:2. `crawl_queue` (P1 → Reject): Codex 明确 Reject, first-party 原则下这是 open_problems 的重复.
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:47:保留 17 - 4 = 13 项. 同时新增 3 项 (Backup + bench + PII redact) 净变化 = 13 + 3 = 16 项, 但原 P0/P1 各减负, 可接受.
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:49:**悬案 B: P0-3 graph_health 推迟? 或 fact_links 提到 P0-0?**
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:51:裁决: **fact_links 提到 P0-0 (prerequisite), P0-3 不推迟但捆绑实现.**
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:53:理由: 推迟 P0-3 会让 triage 的 orphan_delta 信号永远缺席, 影响 Phase 4 整体健康监控价值. 正确做法是: fact_links 表 migration (0011) 作为 P0-0 prerequisite 先 merge; P0-3 的 TS 实现与 fact_links API 捆绑同一 PR 交付, 不允许单独先发 P0-3 stub 实现. Gemini 的 "没明确表态" 反而说明这个问题的答案没有歧义 — 四方中三方明确说 fact_links 必须先, Gemini 隐含同意. P0-3 本身不推迟, 但其 TS 实现依赖 fact_links 落地.
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:67:| P0-0 | `fact_links` 表 + 双向 FK + ON DELETE CASCADE | 无 | prerequisite for P0-3; 从 carried 提升 |
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:68:| P0-1 | `compost triage` (health_signals) | 0009/0008/0007 | 原列表, 保留 |
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:70:| P0-3 | `v_graph_health` TS 实现 + snapshot | P0-0 | 捆绑 fact_links PR, 原列表 |
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:72:| P0-5 | `correction_events` 捕获 | hook-shim | 原列表, 保留 |
./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:76:共 8 项 (原 5 + 新增 3: P0-0 fact_links 升级 + P0-6 LLM 降级 + P0-7 backup). 上限 8 项, 刚好.
./debates/017-execution-checklist/r001_codex.md:15:If Q4's scope is the inclusive list at lines 65-67, `~250 LoC` is materially low because it omits the real cost of atomic migration scaffolding, rollback, explicit FTS rebuild, CLI/MCP wiring, and benchmark/test code.
./debates/017-execution-checklist/r001_codex.md:17:Move WAL tuning, cold-cache benchmarking, Repository abstraction, kind-lint changes, and recall-miss logging into later slices with their own budgets.
./debates/017-execution-checklist/r001_codex.md:22:Treat README/CONTRIBUTING updates, Repository abstraction, and WAL benchmarks as exit criteria or follow-up steps, and if a checkpoint is desired in WAL mode run `PRAGMA wal_checkpoint(TRUNCATE)` only after the migration commits, not as a precondition.
./debates/012-correctedtext-scoping/synthesis.md:14:- **P0-5 surface-only 契约 (debate 006) 不残缺**: `retracted_text` + `health_signals.correction_candidate` 已充分表达 "发生了一次 correction". `corrected_text` 是 optional by design (`:118` 注释 "may be on later turn").
./packages/compost-core/src/schema/0001_init.sql:3:-- Creates: source, observations, ingest_queue, expected_item, captured_item, facts, wiki_pages
./packages/compost-core/src/schema/0001_init.sql:22:-- Observations: immutable append-only ledger (the rebuild anchor)
./packages/compost-core/src/schema/0001_init.sql:23:CREATE TABLE observations (
./packages/compost-core/src/schema/0001_init.sql:38:  transform_policy TEXT NOT NULL,
./packages/compost-core/src/schema/0001_init.sql:43:CREATE INDEX idx_obs_source ON observations(source_id, captured_at);
./packages/compost-core/src/schema/0001_init.sql:44:CREATE INDEX idx_obs_content_hash ON observations(content_hash);
./packages/compost-core/src/schema/0001_init.sql:48:-- can hard-delete observations without RESTRICT-blocking on pending queue rows.
./packages/compost-core/src/schema/0001_init.sql:49:-- Sensory observations that still have pending queue rows are GC-eligible:
./packages/compost-core/src/schema/0001_init.sql:53:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./packages/compost-core/src/schema/0001_init.sql:75:-- Losing captured_item rows for aged sensory observations is acceptable -- SLO tracking
./packages/compost-core/src/schema/0001_init.sql:81:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./packages/compost-core/src/schema/0001_init.sql:86:-- NOTE: ON DELETE CASCADE on observe_id. Facts derived from sensory observations (which
./packages/compost-core/src/schema/0001_init.sql:87:-- expire after 7 days) are cascade-deleted. Facts derived from non-sensory observations
./packages/compost-core/src/schema/0001_init.sql:97:  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
./packages/compost-core/src/schema/0001_init.sql:109:CREATE TABLE wiki_pages (
./debates/014-roadmap-direction/rounds/r001_gemini.md:8:2.  **Perf benchmark harness**: **第二优先级**。对于 MCP 和 Hook 场景，30ms 的延迟是及格线，但随着数据量增长，`reflect` 和 `query` 的性能退化是隐形杀手。没有基准测试的优化是盲目的。
./debates/014-roadmap-direction/rounds/r001_gemini.md:10:4.  **open_problems 表 + CLI**: **最低优先级**。这属于“好用的功能”而非“必要的基础设施”。在系统性能和安全性未得到量化保证前，不应继续扩张 schema 复杂度。
./debates/003-p0-readiness/synthesis.md:25:| 4 | **`correction_candidate` schema 缺失** — 写 migration 0012 给 `health_signals.kind` CHECK 加该值, OR 在 ARCHITECTURE.md 决策复用 `unresolved_contradiction` | Sonnet R1 风险 A + Codex R1 C1 (确定性 bug, 不修则 P0-5 运行时 constraint violation) | 1 hour |
./debates/003-p0-readiness/synthesis.md:36:- Codex C1: "先冻结 `health_signals` 与 correction signal 的枚举契约"
./debates/003-p0-readiness/synthesis.md:92:  ├─ #4 migration 0012: correction_candidate kind in health_signals CHECK
./debates/003-p0-readiness/synthesis.md:102:  ├─ P0-3  graph-health.ts 实现 + snapshot (依赖 P0-0, 含 benchmark gate)
./debates/003-p0-readiness/synthesis.md:103:  └─ P0-5  correction_events 捕获 (daemon post-drain, 非 hook 路径)
./debates/003-p0-readiness/synthesis.md:111:  └─ P1 启动: benchmark fixture (1K/10K/100K reflect/triage/graph CTE 基线)
./debates/003-p0-readiness/synthesis.md:121:| 2 | **graph-health.ts cluster_count CTE 在 10K facts 阻塞 SQLite writer** (P0-3) | 中 | 高 | benchmark gate (acceptance criterion); 必要时分批 + LIMIT |
./debates/003-p0-readiness/synthesis.md:132:3. **P0-3 benchmark 在 10K facts/50K links > 200ms** — 触发 graph_health 重设计 (incremental update vs query-time scan)
./debates/003-p0-readiness/synthesis.md:144:- benchmark: 1K / 10K nodes 性能基线
./debates/003-p0-readiness/synthesis.md:148:- benchmark gate: < 200ms @ 10K facts (撤退条件 3)
./debates/013-week4-audit/rounds/r001_codex.md:10:- `packages/compost-core/src/cognitive/triage.ts:72-77`, `packages/compost-core/src/schema/0012_correction_signal_kind.sql:29-32`：upsert 查 `(kind,target_ref,resolved_at)`，但无对应 partial index。cost `S`；benefit 是 `health_signals` 过万行后仍可稳定去重；trigger：poison pill / chronic stale target。
./debates/012-correctedtext-scoping/prompt.md:9:- P0-5 surface-only 契约已 land: `correction_events` + `health_signals.correction_candidate` 走 4 步事务 (debate 006 Pre-Week-2 Fix 5). 不 mutate `facts.confidence`.
./debates/012-correctedtext-scoping/prompt.md:11:- 一个 P0-1 triage scanner (`scanCorrectionCandidate`) 在 Week 4 Day 3 只是**聚合** `correction_events` 行数, 不需要 `correctedText` 非空.
./debates/012-correctedtext-scoping/prompt.md:23:3. **推 Week 5 的反对理由**: "什么都不做" 是不是让 correction_events 永远残缺?
./debates/003-p0-readiness/rounds/r002_sonnet.md:14:Codex: "10K facts snapshot 仍 >1s" 作为撤退条件。Opus: "P0-3 benchmark >200ms @10K facts" 作为撤退条件 2。Gemini: 递归 CTE 在复杂网络中内存溢出风险。我 R1 风险 B: 5K facts 阻塞 >200ms 触发暂停。四方均独立收敛到同一点——cluster_count CTE 必须在 P0-3 合并前有基准测试 gate。
./debates/003-p0-readiness/rounds/r002_sonnet.md:55:4. **`correction_kind` 与 health_signals CHECK 约束对齐**: 决策 P0-5 写入走新 kind `correction_candidate` 还是复用 `unresolved_contradiction`，在 0012 migration stub 里锁定，避免 P0-5 实现时运行时 constraint violation（我 R1 风险 A，确定必踩）。
./debates/003-p0-readiness/rounds/r002_sonnet.md:68:  P0-0  fact_links migration + CTE API 接口定稿
./debates/003-p0-readiness/rounds/r002_sonnet.md:72:  P0-3  graph-health TS 实现 (依赖 P0-0 merge，含 benchmark gate)
./debates/003-p0-readiness/rounds/r002_sonnet.md:73:  P0-5  correction_events 捕获 (条件: correction_kind 已对齐 CHECK)
./debates/003-p0-readiness/rounds/r002_sonnet.md:80:  P0-1  triage 整合全部信号源 + e2e 集成测试 + benchmark fixture
./debates/014-roadmap-direction/rounds/r001_codex.md:7:3. `bench harness`：先拿到 `reflect/query/ask` 基线，再谈下一轮优化，不然性能讨论都在猜。
./debates/014-roadmap-direction/rounds/r001_codex.md:8:4. `observations.origin_hash + method`：有价值，但它主要服务追责与去重，优先级低于安全、便携、测量。
./debates/014-roadmap-direction/rounds/r001_codex.md:9:`open_problems` 暂缓，两周真实 dogfood 后再决定是否值得升成一等数据结构。
./debates/001-myco-integration/synthesis_v2.md:14:| 1 | `compost triage` (health_signals) | 4/4 P0/accept |
./debates/001-myco-integration/synthesis_v2.md:59:- `observations` 表加 `origin_hash TEXT NULL` (sha256 of upstream source) + `method TEXT NULL` (enum: `claude-hook`, `cli-manual`, `import-file`, `crawl`)
./debates/001-myco-integration/synthesis_v2.md:62:- 冲突仲裁时 origin_hash 存在的 fact 权重更高, 不存在时 fallback 到 confidence
./debates/001-myco-integration/synthesis_v2.md:85:| 1 | `compost triage` — health_signals table + 5 signal sources | M | `cognitive/triage.ts`, migration 0010 |
./debates/001-myco-integration/synthesis_v2.md:89:| 5 | Self-correction event capture (regex) | S | `hook-shim`, `correction_events` table |
./debates/001-myco-integration/synthesis_v2.md:99:| `open_problems` 表 + CLI | 4/4 P0/P1 | 盲点登记 (≠ backlog); `compost problems add/list/resolve` |
./debates/001-myco-integration/synthesis_v2.md:158:- self-correction + open_problems (P1) → 失败 5 (缺口追踪)
./debates/001-myco-integration/synthesis_v2.md:168:**Myco 的 identity 文档比代码值钱**. 它的 `identity.md` / `open_problems.md` / `vision_recovery_craft` 三份文档有长期价值 — 读完就能用, 不留 Myco 代码 / MCP / YAML. 让 Compost 被这五个失败模式教育过后, 留下 schema 和 view 就够了.
./debates/001-myco-integration/synthesis_v2.md:185:CREATE TABLE health_signals (
./debates/001-myco-integration/synthesis_v2.md:219:CREATE TABLE correction_events (
./debates/001-myco-integration/synthesis_v2.md:270:| open_problems | P1 | P0 候补 | P1 | P0 | **P1** (2P0/2P1) |
./debates/003-p0-readiness/rounds/r001_gemini.md:5:**Go.** 核心结构依赖已在 Migration 0011 中补齐，特别是 P0-0 (fact_links) 的提升解决了 P0-3 (graph_health) 的逻辑悬空问题。P0-7 (backup) 的加入为本阶段的高频数据变动提供了必要的安全边界。
./debates/003-p0-readiness/rounds/r001_gemini.md:13:    - **触发**：事实图 (fact_links) 密度过高，且 `triage` 或 `reflect` 运行深度优先搜索时。
./debates/003-p0-readiness/rounds/r001_gemini.md:23:- **Week 1**: **P0-0** (fact_links 基础设施) + **P0-7** (数据安全备份)
./debates/002-roadmap-gap-audit/rounds/r001_codex.md:2:1. **描述**: `graph_health` 是假交付。**触发条件**: 跑 `triage`/快照。**影响**: `v_graph_health` 关键列是 `NULL`，`orphan_delta` 无意义。**最小修复**: 先做 `fact_links`+双 `ON DELETE CASCADE`。**应放入**: 跨 phase
./debates/002-roadmap-gap-audit/rounds/r001_codex.md:6:5. **描述**: 性能 gate 只测 hook。**触发条件**: facts 到 10K+ 后跑 triage、reflect、graph CTE。**影响**: 延迟悬崖会在 Phase 5 前先爆。**最小修复**: 先补 benchmark fixture + CI 阈值。**应放入**: P4 P1
./debates/002-roadmap-gap-audit/rounds/r001_codex.md:9:0. `fact_links` — 依赖: 无；必须先于 P0-3，且两端 FK 都要 `ON DELETE CASCADE`
./debates/002-roadmap-gap-audit/rounds/r001_codex.md:13:4. `graph_health` — 依赖: `fact_links`
./debates/002-roadmap-gap-audit/rounds/r001_codex.md:15:裁决: **应先做 `fact_links`**；否则 P0-3 只是返回 `NULL` 的占位 view。
./debates/002-roadmap-gap-audit/rounds/r001_codex.md:19:- `crawl_queue`｜P1 → Reject｜在 first-party 原则下只是“待办表”；替代: `open_problems` + 手动 `compost add <url>`
./debates/003-p0-readiness/state.json:14:    "correction_candidate kind missing in health_signals CHECK (Codex+Sonnet)",
./debates/003-p0-readiness/state.json:32:    "P0-3 benchmark > 200ms @ 10K facts",
./debates/005-cumulative-review/state.json:13:    "fact_links contradicts edges never written (Opus/Sonnet/Codex/Gemini)",
./debates/003-p0-readiness/rounds/r001_codex.md:5:- 冻结 `health_signals` / correction signal 枚举
./debates/003-p0-readiness/rounds/r001_codex.md:9:- **风险**: P0-1/P0-5 契约冲突。**触发条件**: correction 写入 `health_signals`。**损失**: schema 返工、漏报。**预防措施**: 先补 migration+测试。
./debates/003-p0-readiness/rounds/r001_codex.md:21:- 缺 `fact_links` + recursive CTE 的 graph-health 真值测试；加在 `P0-0/P0-3`
./debates/003-p0-readiness/rounds/r001_codex.md:26:- Week 2 结束前 correction signal 仍要改 `health_signals` CHECK 才能落地
./debates/014-roadmap-direction/prompt.md:25:- `open_problems` 表 + CLI (好奇心追踪 / gap tracker 合并)
./debates/014-roadmap-direction/prompt.md:26:- observations 加 `origin_hash` + `method` 列
./debates/014-roadmap-direction/prompt.md:27:- Perf benchmark harness (`bench/reflect-{1k,10k,100k}.bench.ts` + CI > 50% regression 报警)
./debates/014-roadmap-direction/prompt.md:55:- **切 bench harness**: 没 baseline 不知道哪里慢, 先量再优
./debates/003-p0-readiness/context.md:11:- Schema: 0010 (5 P0 tables) + 0011 (fact_links + bug fix + real v_graph_health view)
./debates/003-p0-readiness/context.md:19:| P0-0 | fact_links + recursive CTE API | M |
./debates/003-p0-readiness/context.md:24:| P0-5 | correction_events 捕获 (hook) | S |
./debates/003-p0-readiness/context.md:33:- `packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql`
./debates/016-roadmap-revalidation/synthesis.md:34:- 方案：**独立 `compost_cache` 表** + 独立 MCP tool + 不进 default recall + 不进 memories_fts
./debates/016-roadmap-revalidation/synthesis.md:161:**关键变更**: 不写回 memories 主表，独立 `compost_cache` 表
./debates/016-roadmap-revalidation/synthesis.md:165:CREATE TABLE compost_cache (
./debates/016-roadmap-revalidation/synthesis.md:178:CREATE INDEX idx_compost_cache_live
./debates/016-roadmap-revalidation/synthesis.md:179:  ON compost_cache(project, ttl_expires_at)
./debates/016-roadmap-revalidation/synthesis.md:184:- 不建 `compost_cache_fts`，不 join 到 `memories_fts`
./debates/016-roadmap-revalidation/synthesis.md:185:- 独立 MCP tool: `mcp__engram__recall_compost_cache`
./debates/016-roadmap-revalidation/synthesis.md:188:- 用户显式 opt-in: `recall(include_compost_cache=True)`
./debates/016-roadmap-revalidation/synthesis.md:193:- TTL GC daemon: `DELETE FROM compost_cache WHERE ttl_expires_at < datetime('now')`
./debates/016-roadmap-revalidation/synthesis.md:232:| compost_cache 条目数 | >500 | 考虑是否值得做，或回退到 Compost 端缓存 |
./packages/compost-core/src/policies/registry.ts:129:      `transform_policy \`${policyId}\` is not registered — add it to \`packages/compost-core/src/policies/registry.ts\` and restart the daemon`
./debates/002-roadmap-gap-audit/synthesis.md:20:- **根因**: 依赖 `fact_links` 表, 但 fact_links 在 ROADMAP 是 carried 项 (无 tier), 不在任何 P0 里
./debates/002-roadmap-gap-audit/synthesis.md:21:- **修正**: **fact_links 提到 `P0-0` (prerequisite)**, P0-3 TS 实现与 fact_links 同 PR
./debates/002-roadmap-gap-audit/synthesis.md:26:- **修正**: migration 0011 (与 fact_links 同) ALTER 这三列加 `DEFAULT 0`, 或改为 NULLABLE
./debates/002-roadmap-gap-audit/synthesis.md:45:- **修正**: P1 — `bench/` 目录, `reflect-1k/10k/100k.bench.ts`, CI 跑回归阈值 > 50% 报警
./debates/002-roadmap-gap-audit/synthesis.md:65:- **理由**: first-party 原则下是 open_problems 的重复 + 手动 `compost add <url>`
./debates/002-roadmap-gap-audit/synthesis.md:69:- **理由**: archive_reason + triage 未在大规模数据集验证前是玄学指标. 直接用 `health_signals` 中 `stale_fact` 堆积代理
./debates/002-roadmap-gap-audit/synthesis.md:103:| **P0-0** | `fact_links` 表 + 双向 FK + ON DELETE CASCADE + recursive CTE | 无 | 4/4 (从 carried 提升) | M (3-5d) |
./debates/002-roadmap-gap-audit/synthesis.md:104:| **P0-1** | `compost triage` (health_signals) — 修 Bug 2 (snapshot DEFAULT 0) | 0010 | 原 Batch D | M |
./debates/002-roadmap-gap-audit/synthesis.md:108:| **P0-5** | `correction_events` 捕获 (信号挂 triage, 不直接改 confidence — Gemini 1.5) | hook-shim | 原 Batch D (修正) | S |
./debates/002-roadmap-gap-audit/synthesis.md:120:| `open_problems` 表 + CLI | 原 Batch D P1, 保留 |
./debates/002-roadmap-gap-audit/synthesis.md:121:| `inlet_origin_hash` opt-in (机器必填) | 原 Batch D P1, 保留 |
./debates/002-roadmap-gap-audit/synthesis.md:122:| Performance benchmark harness (`bench/` 1K/10K/100K) | NEW, 4/4 共识 |
./debates/002-roadmap-gap-audit/synthesis.md:145:| `crawl_queue` (P1) | first-party 原则下重复, 用 open_problems + 手动 add |
./debates/002-roadmap-gap-audit/synthesis.md:182:Week 1: P0-0 (fact_links migration 0011 + recursive CTE API)
./debates/002-roadmap-gap-audit/synthesis.md:186:        P0-3 (graph_health TS, 与 fact_links 捆绑) [依赖 P0-0]
./debates/002-roadmap-gap-audit/synthesis.md:187:        P0-5 (correction_events 捕获) [并行]
./debates/002-roadmap-gap-audit/synthesis.md:193:        集成测试 + benchmark fixture (P1 启动)
./debates/002-roadmap-gap-audit/synthesis.md:205:4. **新增 `packages/compost-core/src/schema/0011_fact_links.sql`**: 为 P0-0 准备 (本 PR 可不写, 但 ROADMAP 提到)
./debates/002-roadmap-gap-audit/synthesis.md:228:3. **下周开工 P0-0 + P0-7 并行** — fact_links 是 critical path
./debates/002-roadmap-gap-audit/synthesis.md:235:1. **隐性依赖 = 隐性 P0**. ROADMAP 把 fact_links 列在 carried 是错误分类. 任何被多个 P0 引用的"基础设施"项必须自己也是 P0. Lesson: 写 ROADMAP 时画依赖图, 不只是列清单.
./debates/016-roadmap-revalidation/rounds/r001_codex.md:37:CREATE TABLE IF NOT EXISTS compost_cache (
./debates/016-roadmap-revalidation/rounds/r001_codex.md:50:CREATE INDEX IF NOT EXISTS idx_compost_cache_live
./debates/016-roadmap-revalidation/rounds/r001_codex.md:51:  ON compost_cache(project, ttl_expires_at)
./debates/016-roadmap-revalidation/rounds/r001_codex.md:56:- 不建 `compost_cache_fts`，更不 join 到 `memories_fts`。
./debates/016-roadmap-revalidation/rounds/r001_codex.md:57:- 独立 MCP/CLI：`recall_compost_cache` 或输出单独 section。
./debates/016-roadmap-revalidation/rounds/r001_codex.md:59:- 失效规则用 `source_hash` 比较；TTL GC 单独跑 `DELETE FROM compost_cache WHERE ttl_expires_at < datetime('now')`。
./debates/001-myco-integration/rounds/r002_sonnet.md:18:参赛者: Gemini. Item: "入口出处契约 (Inlet Provenance Contract)" — 强制 `origin_hash` + `method_fingerprint`.
./debates/001-myco-integration/rounds/r002_sonnet.md:19:为什么是 cargo cult: Gemini 将 Myco 的 `OPTIONAL_FIELDS` (inlet_origin, inlet_method) 升格为强制字段。Myco 原文标注的是 OPTIONAL——Gemini 在没有具体 use case 支撑下把它变成硬约束，同时承认"避免过度采集隐私元数据"，自相矛盾。对单用户本地第一大脑，`method_fingerprint` 的仲裁价值几乎为零：用户自己知道这条从哪来。
./debates/001-myco-integration/rounds/r002_sonnet.md:20:正确替代: 保持现有 `observations.source TEXT`。有具体溯源需求时 (多数据源 pipeline)，再在 schema migration 里按需加字段，不预埋。
./debates/001-myco-integration/rounds/r001_opus.md:24:- **Compost 落地点**: 新增 `packages/compost-core/src/cognitive/triage.ts` + CLI `compost triage`; 新表 `health_signals(id, kind, severity, message, created_at, resolved_at)`.
./debates/001-myco-integration/rounds/r001_opus.md:30:### 2. Open problems register (`docs/open_problems.md` 风格)
./debates/001-myco-integration/rounds/r001_opus.md:31:- **Myco 源**: `docs/open_problems.md` 整份. 关键: "诚实登记册 — 结构性 blind spots, 不是 feature backlog"
./debates/001-myco-integration/rounds/r001_opus.md:32:- **Compost 落地点**: 新表 `open_problems(id, title, description, entry_criteria, exit_criteria, confidence_floor, status, created_at)` + CLI `compost problems list/add/resolve`
./debates/001-myco-integration/rounds/r001_codex.md:4:3. 结构退化｜源 docs/open_problems.md:222-269｜落 reflect.ts+graph_snap｜法 CTE快照｜M｜代 看不到碎片化｜险 新fact误报  
./debates/001-myco-integration/state.json:22:    "sonnet": ["self-correction P2→P1", "open_problems P1→P0 候补"],
./packages/compost-core/src/cognitive/wiki.ts:3: * Writes to wiki_pages table + disk (~/.compost/wiki/).
./packages/compost-core/src/cognitive/wiki.ts:32:           SELECT wp.title FROM wiki_pages wp
./packages/compost-core/src/cognitive/wiki.ts:61:       JOIN observations o ON o.observe_id = f.observe_id
./packages/compost-core/src/cognitive/wiki.ts:99:    // failure. Keep the existing on-disk page (if any) but mark the wiki_pages
./packages/compost-core/src/cognitive/wiki.ts:105:      .query("SELECT path FROM wiki_pages WHERE path = ?")
./packages/compost-core/src/cognitive/wiki.ts:109:        "UPDATE wiki_pages SET stale_at = datetime('now') WHERE path = ?",
./packages/compost-core/src/cognitive/wiki.ts:128:    .query("SELECT path FROM wiki_pages WHERE path = ?")
./packages/compost-core/src/cognitive/wiki.ts:135:       VALUES (?, ?, (SELECT last_synthesis_model FROM wiki_pages WHERE path = ?))`,
./packages/compost-core/src/cognitive/wiki.ts:142:  // Write to wiki_pages table. On successful rebuild, clear stale_at so
./packages/compost-core/src/cognitive/wiki.ts:146:      `UPDATE wiki_pages SET title = ?, last_synthesis_at = datetime('now'),
./packages/compost-core/src/cognitive/wiki.ts:153:      `INSERT INTO wiki_pages (path, title, last_synthesis_at, last_synthesis_model)
./packages/compost-core/src/cognitive/wiki.ts:159:  // Link wiki page to source observations via wiki_page_observe
./packages/compost-core/src/cognitive/wiki.ts:177:  // Debate 009 Fix 3: audit is observability. At this point disk + wiki_pages
./debates/002-roadmap-gap-audit/context.md:16:- migration 0010 创建了: `health_signals`, `decision_audit`, `graph_health_snapshot`, `correction_events` 4 表 + `v_graph_health` view + facts 表三新列
./debates/002-roadmap-gap-audit/context.md:28:**Batch D — Myco P0 (5 项)**: triage / decision_audit / graph_health / archive_reason / correction_events
./debates/002-roadmap-gap-audit/context.md:30:**P1 (after P0)**: open_problems, compression_pressure, shareable export, crawl_queue, inlet provenance, four-layer dashboard
./debates/001-myco-integration/rounds/r002_codex.md:32:| open_problems | P1 | 记录未知 |
./debates/014-roadmap-direction/synthesis.md:11:| 2 | export/import | bench | PII redactor | PII redactor | **PII redactor** (4/4 前三位) |
./debates/014-roadmap-direction/synthesis.md:12:| 3 | bench | export/import | bench | bench+eval | **eval + bench 合一** |
./debates/014-roadmap-direction/synthesis.md:13:| 4 | origin_hash | open_problems | open_problems | open_problems | `open_problems` 待 dogfood 后决定 |
./debates/014-roadmap-direction/synthesis.md:17:- **`open_problems` + `origin_hash`** 全部 ≥ 第 4 位 — **不做**, 等 dogfood
./debates/014-roadmap-direction/synthesis.md:52:无进步. **Week 5 优先于 bench** (Sonnet 洞察: eval 测正确性, bench 测速度,
./debates/014-roadmap-direction/synthesis.md:93:2. **Eval harness** (3-5 天) — `packages/compost-eval/` + `bench/golden/*.json`
./debates/014-roadmap-direction/synthesis.md:106:- **`open_problems` / `origin_hash`** → dogfood 后决定是否仍要做
./debates/001-myco-integration/synthesis.md:25:- 新表 `health_signals(id, kind, severity, message, target_ref, created_at, resolved_at, resolved_by)`
./debates/001-myco-integration/synthesis.md:65:   LEFT JOIN fact_links l ON l.from_fact_id = f.id OR l.to_fact_id = f.id
./debates/001-myco-integration/synthesis.md:109:- 新表 `correction_events(id, session_id, retracted_text, corrected_text, related_fact_ids, created_at)`
./debates/001-myco-integration/synthesis.md:123:| `open_problems` 表 + CLI | Opus R2 P1 / Sonnet I-1 支持 | 诚实盲点登记 (≠backlog), 成本 S |
./debates/001-myco-integration/synthesis.md:129:| Inlet `origin_hash` 字段 (opt-in) | Gemini 提, Sonnet CC-3 反对强制 | **opt-in** 字段, 不强制, 仅多源 pipeline 启用 |
./debates/001-myco-integration/synthesis.md:166:- self-correction capture + open_problems (P1) → 失败模式 5 (缺口追踪)
./debates/001-myco-integration/synthesis.md:170:**更深一层, Myco 给我们的最大礼物不是代码, 是语言**: 它把"结构退化 / 审计链 / 缺口登记 / 压缩教条"这些模糊直觉明确命名. 这些概念读完就能用, 不需要借它的工程外壳. Compost 读完 Myco 的 identity.md / open_problems.md / vision_recovery_craft 之后, 可以把那几份文档永久归档 (不留 Myco MCP, 不留 YAML lint, 不留单文件巨型), 只保留被这五个失败模式教育过的 schema 和 view.
./packages/compost-core/src/cognitive/correction-detector.ts:38: * `observations.raw_bytes` for a `source.kind = 'claude-code'` row and
./packages/compost-core/src/cognitive/correction-detector.ts:45: * contain "actually, I..." deep inside) from flooding `correction_events`.
./packages/compost-core/src/cognitive/correction-detector.ts:73: * Insert a `correction_events` row plus a linked `health_signals` row in a
./packages/compost-core/src/cognitive/correction-detector.ts:77: *   1. INSERT correction_events (processed_at = NULL)
./packages/compost-core/src/cognitive/correction-detector.ts:78: *   2. INSERT health_signals (kind='correction_candidate',
./packages/compost-core/src/cognitive/correction-detector.ts:81: *   3. UPDATE correction_events SET processed_at = datetime('now') for the id
./packages/compost-core/src/cognitive/correction-detector.ts:85: * `idx_correction_events_unprocessed` index meaningful (rows with
./packages/compost-core/src/cognitive/correction-detector.ts:105:    // Step 1: INSERT correction_events (processed_at = NULL)
./packages/compost-core/src/cognitive/correction-detector.ts:107:      "INSERT INTO correction_events " +
./packages/compost-core/src/cognitive/correction-detector.ts:120:    // Step 2: INSERT health_signals linked to the correction_event
./packages/compost-core/src/cognitive/correction-detector.ts:128:      "INSERT INTO health_signals (kind, severity, message, target_ref) VALUES (?, ?, ?, ?)",
./packages/compost-core/src/cognitive/correction-detector.ts:137:    // Step 3: UPDATE correction_events.processed_at = now
./packages/compost-core/src/cognitive/correction-detector.ts:139:      "UPDATE correction_events SET processed_at = datetime('now') WHERE id = ?",
./packages/compost-core/src/cognitive/correction-detector.ts:163: * not direct mutations. The returned fact_ids feed into `health_signals`
./packages/compost-core/src/cognitive/correction-detector.ts:184:  // recordCorrection path is still useful -- health_signals carries the
./packages/compost-core/src/cognitive/correction-detector.ts:202: * Only runs for `source.kind = 'claude-code'` observations; other sources
./packages/compost-core/src/cognitive/correction-detector.ts:220:        "FROM observations o JOIN source s ON s.id = o.source_id " +
./debates/002-roadmap-gap-audit/state.json:15:    "fact_links 是 P0-3 的隐性必修前置 (4/4 共识)",
./debates/002-roadmap-gap-audit/state.json:26:    "下周开 P0-0 fact_links + P0-7 backup 并行",
./debates/001-myco-integration/rounds/r002_gemini.md:31:**撤回**: 撤回我 R1 的被动 Gap Tracker 建议，支持 Opus 的 `open_problems` 表设计，用于追踪系统性认知空洞。
./debates/001-myco-integration/rounds/r002_gemini.md:43:理由: 反驳 Sonnet 的 "opt-in" 建议。在第二大脑中，事实的"出处"不是可选元数据，而是矛盾仲裁（Contradiction Arbitration）的唯一法官。如果没有 `method_fingerprint`，系统无法在两个相互矛盾的事实中根据来源置信度做裁决。
./packages/compost-core/src/cognitive/reflect.ts:9:  sensoryObservationsDeleted: number;
./packages/compost-core/src/cognitive/reflect.ts:35:    sensoryObservationsDeleted: 0,
./packages/compost-core/src/cognitive/reflect.ts:48:      // Count observations and facts BEFORE the delete.
./packages/compost-core/src/cognitive/reflect.ts:52:          `SELECT COUNT(*) AS c FROM observations
./packages/compost-core/src/cognitive/reflect.ts:61:           JOIN observations o ON o.observe_id = f.observe_id
./packages/compost-core/src/cognitive/reflect.ts:69:      // Delete old sensory observations - FK CASCADE drops facts, ingest_queue,
./packages/compost-core/src/cognitive/reflect.ts:72:        `DELETE FROM observations
./packages/compost-core/src/cognitive/reflect.ts:77:      report.sensoryObservationsDeleted = obsCount.c;
./packages/compost-core/src/cognitive/reflect.ts:254:            // this, fact_links stays empty forever and graph-health metrics
./packages/compost-core/test/backup.test.ts:76:      // health_signals (added by 0010) must exist in snapshot too
./packages/compost-core/test/backup.test.ts:79:          "SELECT name FROM sqlite_master WHERE type='table' AND name='health_signals'"
./packages/compost-core/test/backup.test.ts:82:      expect(tbl.name).toBe("health_signals");
./packages/compost-core/test/backup.test.ts:287:  // ---- Cross-P0 integration: fact_links survive backup round-trip ----
./packages/compost-core/test/backup.test.ts:289:  test("fact_links data survives backup -> restore round-trip", () => {
./packages/compost-core/test/backup.test.ts:295:      "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','t',1,'user','i','tp-2026-04',NULL)"
./packages/compost-core/test/backup.test.ts:304:      "INSERT INTO fact_links(from_fact_id, to_fact_id, kind) VALUES ('f1','f2','contradicts')"
./packages/compost-core/test/backup.test.ts:308:    // Open the backup directly and verify fact_links row is there
./packages/compost-core/test/backup.test.ts:313:          "SELECT from_fact_id, to_fact_id, kind FROM fact_links WHERE from_fact_id = 'f1'"
./packages/compost-ingest/compost_ingest/schema.py:8:    "required": ["observe_id", "source_uri", "mime_type", "content", "transform_policy"],
./packages/compost-ingest/compost_ingest/schema.py:30:        "transform_policy": {
./packages/compost-ingest/compost_ingest/schema.py:44:        "transform_policy",
./packages/compost-ingest/compost_ingest/schema.py:61:        "transform_policy": {
./debates/001-myco-integration/rounds/r002_opus.md:9:**正确替代**: Signal → **Surface** (写入 health_signals 表, `compost triage` 查看), **不做 auto-action**. 用户或 agent 手动执行.
./debates/001-myco-integration/rounds/r002_opus.md:51:**Insight**: 在 observations 表加 `origin_hash + method_fingerprint`. 这点 Opus 和 Sonnet 都没提. Compost 现在 source 字段松散 (tool_name + payload hash), 没强制 provenance. 对**第二大脑**, 溯源是信任基石 — 没有它就不能做 contradiction arbitration 的公平仲裁.
./debates/001-myco-integration/rounds/r002_opus.md:69:| open_problems 表 | **P1** | 诚实盲点登记, S 成本 |
./README.md:60:    |      observations (L0)      |  <- immutable provenance ledger
./README.md:87:| **L0** | Provenance ledger | SQLite (append-only observations) | 0 |
./README.md:90:| **L3** | Wiki synthesis | Markdown on disk + wiki_pages table | 2 |
./README.md:106:| Sensory buffer | Raw observations < 7 days | Hard-deleted by `reflect` |
./README.md:136:| `compost.observe` | notification | 0 | Write observations (adapters use this) |
./packages/compost-core/src/cognitive/triage.ts:80:      "SELECT id FROM health_signals " +
./packages/compost-core/src/cognitive/triage.ts:87:    "INSERT INTO health_signals (kind, severity, message, target_ref) " +
./packages/compost-core/src/cognitive/triage.ts:226: * `orphan_delta`: active facts with no incoming/outgoing `fact_links` edges
./packages/compost-core/src/cognitive/triage.ts:245:           SELECT 1 FROM fact_links l
./packages/compost-core/src/cognitive/triage.ts:286:       FROM wiki_pages
./packages/compost-core/src/cognitive/triage.ts:318: * contract.md), inserts new health_signals rows for findings, returns
./packages/compost-core/src/cognitive/triage.ts:351:       FROM health_signals
./packages/compost-core/src/cognitive/triage.ts:405:       FROM health_signals
./packages/compost-core/src/cognitive/triage.ts:433:    "UPDATE health_signals " +
./debates/001-myco-integration/rounds/r001_gemini.md:72:- **Myco 源**: `src/myco/notes.py::OPTIONAL_FIELDS` (inlet_origin, inlet_method)
./debates/001-myco-integration/rounds/r001_gemini.md:73:- **Compost 落地点**: `observations` 表 (Schema 扩展)
./debates/001-myco-integration/rounds/r001_gemini.md:74:- **集成方式**: 直接移植。在 L0 观测层强制要求 `origin_hash` 和 `method_fingerprint`，确保每一条事实都能回溯到物理世界的源点。
./debates/010-week3-day4-audit/rounds/r001_codex.md:3:1. `packages/compost-core/src/query/ask.ts:123-131,170-171`：`ask()` 只从 `hits.subject` 反查 wiki；`hits.length===0` 直接返回 “not enough information”，已有 wiki 页与 `stale_at` 提示都会丢。我已本地复现：已有 `paris.md` 且 facts 全归档时，返回 `wiki_pages_used=[]`。009 漏掉它，因为 Day4 套件没覆盖 ROADMAP 已登记的 empty-hit 路径。修复：0-hit 时先按 `question/title/slug` 查 `wiki_pages`，再决定是否早退。  
./debates/010-week3-day4-audit/rounds/r001_codex.md:6:4. `docs/ARCHITECTURE.md:241`, `packages/compost-core/src/cognitive/wiki.ts:97-117`, `packages/compost-core/src/cognitive/triage.ts:55-71`：文档写的是 wiki 失败会 surface `stale_wiki` triage signal；代码只写 `wiki_pages.stale_at`，`triage()` 仍是 stub。009 漏掉它，因为修的是 fallback，不是 P0-1 契约回看。修复：补 signal 写入/扫描，或把文档降级为 future work。
./packages/compost-core/src/cognitive/fact-links.ts:6: * The `fact_links` table (migration 0011) stores directed edges between facts.
./packages/compost-core/src/cognitive/fact-links.ts:69:        "SELECT link_id, weight, observed_count FROM fact_links " +
./packages/compost-core/src/cognitive/fact-links.ts:78:        "UPDATE fact_links SET observed_count = observed_count + 1, weight = ? " +
./packages/compost-core/src/cognitive/fact-links.ts:87:    "INSERT INTO fact_links (from_fact_id, to_fact_id, kind, weight) VALUES (?, ?, ?, ?)",
./packages/compost-core/src/cognitive/fact-links.ts:111:    sql = "SELECT * FROM fact_links WHERE from_fact_id = ?";
./packages/compost-core/src/cognitive/fact-links.ts:114:    sql = "SELECT * FROM fact_links WHERE to_fact_id = ?";
./packages/compost-core/src/cognitive/fact-links.ts:118:      "SELECT * FROM fact_links WHERE from_fact_id = ? OR to_fact_id = ?";
./packages/compost-core/src/cognitive/fact-links.ts:158:    "DELETE FROM fact_links WHERE from_fact_id = ? AND to_fact_id = ? AND kind = ?",
./packages/compost-core/src/cognitive/fact-links.ts:214:      ? "JOIN fact_links fl ON fl.from_fact_id = visited.fact_id"
./packages/compost-core/src/cognitive/fact-links.ts:216:        ? "JOIN fact_links fl ON fl.to_fact_id = visited.fact_id"
./packages/compost-core/src/cognitive/fact-links.ts:217:        : "JOIN fact_links fl ON (fl.from_fact_id = visited.fact_id OR fl.to_fact_id = visited.fact_id)";
./packages/compost-core/src/cognitive/fact-links.ts:268:    LEFT JOIN fact_links fl
./packages/compost-core/src/cognitive/fact-links.ts:290: * facts; if benchmarks show otherwise we revisit at P0-3.
./packages/compost-core/src/cognitive/fact-links.ts:300:    .query("SELECT from_fact_id, to_fact_id FROM fact_links")
./packages/compost-core/src/cognitive/fact-links.ts:421:    .query("SELECT COUNT(*) AS c FROM fact_links")
./packages/compost-ingest/compost_ingest/cli.py:105:        "transform_policy": payload["transform_policy"],
./packages/compost-core/src/pipeline/ingest.ts:30:  transform_policy: string;
./packages/compost-core/src/pipeline/ingest.ts:103:    transform_policy: policy.id,
./packages/compost-core/src/pipeline/ingest.ts:142:    `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
./packages/compost-core/src/pipeline/ingest.ts:154:      transform_policy: policy.id,
./packages/compost-core/src/pipeline/ingest.ts:201:      `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
./packages/compost-core/test/graph-health.test.ts:90:      "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','t',1,'user','i','tp-2026-04',NULL)"
./packages/compost-core/test/graph-health.test.ts:121:  test("takeSnapshot counts active facts + orphans via fact_links", () => {
./packages/compost-core/test/graph-health.test.ts:128:      "INSERT INTO fact_links (from_fact_id, to_fact_id, kind) VALUES ('a','b','supports')"
./packages/compost-core/test/graph-health.test.ts:192:      "INSERT INTO fact_links (from_fact_id, to_fact_id, kind) VALUES ('old1','old2','supports')"
./packages/compost-core/test/graph-health.test.ts:205:      "INSERT INTO fact_links (from_fact_id, to_fact_id, kind) VALUES ('old','recent','supports')"
./packages/compost-core/test/noteworthy.test.ts:103:      "content processing pipeline that ingests observations from multiple sources " +
./packages/compost-core/test/noteworthy.test.ts:113:      "content processing pipeline that ingests observations from multiple sources " +
./debates/010-week3-day4-audit/prompt.md:11:- P0-0 fact_links (Week 1)
./debates/010-week3-day4-audit/prompt.md:15:- P0-5 correction_events (Week 2)
./packages/compost-ingest/compost_ingest/extractors/markdown.py:124:    (re.compile(r"\b(api|endpoint|route|method|function|interface)\b", re.I), "exposes_api"),
./packages/compost-core/src/embedding/ollama.ts:47:        method: "POST",
./packages/compost-core/src/pipeline/web-ingest.ts:4: * with web-specific adapter and transform_policy.
./packages/compost-core/src/pipeline/web-ingest.ts:121:    transform_policy: policyId,
./packages/compost-core/src/pipeline/web-ingest.ts:153:    `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
./packages/compost-core/src/pipeline/web-ingest.ts:178:      transform_policy: policyId,
./packages/compost-core/src/pipeline/web-ingest.ts:204:      `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
./packages/compost-core/test/fact-links.test.ts:21: * fact_links FK constraints are satisfied without each test rewriting boilerplate.
./packages/compost-core/test/fact-links.test.ts:28:    "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','test',1,'user','idem','tp-2026-04',NULL)"
./packages/compost-core/test/fact-links.test.ts:78:      .query("SELECT COUNT(*) AS c FROM fact_links")
./packages/compost-core/test/fact-links.test.ts:90:        "SELECT observed_count, weight FROM fact_links WHERE link_id = ?"
./packages/compost-core/test/fact-links.test.ts:164:      .query("SELECT COUNT(*) AS c FROM fact_links")
./packages/compost-core/test/fact-links.test.ts:174:      .query("SELECT COUNT(*) AS c FROM fact_links")
./debates/010-week3-day4-audit/synthesis.md:57:| `ask()` hits=0 时查 wiki (Codex #1 / ROADMAP risk 3) | Week 4 | 1h | 按 question 做 wiki_pages title 查找, 决定是否 short-circuit |
./debates/010-week3-day4-audit/synthesis.md:58:| `stale_wiki` triage signal 未兑现 (Codex #4) | P0-1 triage 一起做 | 1h | 在 `synthesizeWiki` fallback 路径写 `health_signals` 行; 或文档降级为 "P0-1 dependency" |
./packages/compost-core/test/cross-p0-integration.test.ts:23: *        -> reflect() writes decision_audit + fact_links + archived loser
./packages/compost-core/test/cross-p0-integration.test.ts:34:  "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','payload',1,'user','idem','tp-2026-04',NULL)";
./packages/compost-core/test/cross-p0-integration.test.ts:77:  // Scenario A: reflect -> audit + fact_links + graph_health snapshot
./packages/compost-core/test/cross-p0-integration.test.ts:84:  test("reflect writes audit + fact_links + snapshot stays coherent", () => {
./packages/compost-core/test/cross-p0-integration.test.ts:107:    // P0-0: fact_links contradicts edge written from loser -> winner.
./packages/compost-core/test/cross-p0-integration.test.ts:161:      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
./packages/compost-core/test/cross-p0-integration.test.ts:183:    // wiki_pages.stale_at set; disk still holds the seeded content.
./packages/compost-core/test/cross-p0-integration.test.ts:185:      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
./packages/compost-core/test/cross-p0-integration.test.ts:214:    expect(askResult.wiki_pages_used).toContain("paris.md");
./packages/compost-core/test/cross-p0-integration.test.ts:224:      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
./packages/compost-core/test/cross-p0-integration.test.ts:246:      "UPDATE wiki_pages SET stale_at = datetime('now') WHERE title = 'berlin'"
./packages/compost-core/test/cross-p0-integration.test.ts:265:    expect(result.wiki_pages_used).toContain("berlin.md");
./packages/compost-core/test/cross-p0-integration.test.ts:268:    // builder, visible via the wiki_pages_used evidence.
./packages/compost-core/test/cross-p0-integration.test.ts:286:      .query("SELECT path FROM wiki_pages WHERE title = 'new york'")
./packages/compost-core/test/cross-p0-integration.test.ts:292:    // the BM25 banner to prove wiki_pages_used.
./packages/compost-core/test/cross-p0-integration.test.ts:300:    expect(result.wiki_pages_used).toContain("new-york.md");
./packages/compost-ingest/tests/test_schema_contract.py:17:TRANSFORM_POLICY: str = "tp-2026-04"
./packages/compost-ingest/tests/test_schema_contract.py:27:        "transform_policy": TRANSFORM_POLICY,
./packages/compost-ingest/tests/test_schema_contract.py:120:    bad_payload = {"observe_id": "x"}  # missing source_uri, mime_type, content, transform_policy
./packages/compost-ingest/tests/test_schema_contract.py:152:        "transform_policy": "tp-2026-04",
./packages/compost-core/test/self-consumption.test.ts:75:      transform_policy: "tp-2026-04",
./packages/compost-core/test/self-consumption.test.ts:104:      transform_policy: "tp-2026-04",
./packages/compost-core/test/self-consumption.test.ts:126:      transform_policy: "tp-2026-04",
./debates/010-week3-day4-audit/rounds/r001_gemini.md:18:- **修复**: `wiki.ts` 内部循环应有 try-catch，并在 `wiki_pages.stale_at` 中记录失败时间。
./packages/compost-core/test/query.test.ts:77:        transform_policy: "tp-2026-04",
./packages/compost-core/test/query.test.ts:110:      `INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),
./packages/compost-core/test/query.test.ts:228:    expect(topHit.provenance.transform_policy).toBe("tp-2026-04-03");
./packages/compost-core/test/pipeline.test.ts:63:      .query("SELECT * FROM observations WHERE observe_id = ?")
./packages/compost-core/test/pipeline.test.ts:67:    expect(obs.transform_policy).toBe(getActivePolicy().id);
./packages/compost-core/test/pipeline.test.ts:87:    expect(deriv.transform_policy).toBe(getActivePolicy().id);
./packages/compost-core/test/pipeline.test.ts:116:  test("ingestFile is idempotent (same file = no duplicate observations)", async () => {
./packages/compost-core/test/pipeline.test.ts:127:      .query("SELECT count(*) as cnt FROM observations")
./packages/compost-core/test/pipeline.test.ts:142:  test("ingestFile uses active transform_policy", async () => {
./packages/compost-core/test/pipeline.test.ts:147:      .query("SELECT transform_policy FROM observations WHERE observe_id = ?")
./packages/compost-core/test/pipeline.test.ts:148:      .get(result.observe_id!) as { transform_policy: string };
./packages/compost-core/test/pipeline.test.ts:149:    expect(obs.transform_policy).toBe(getActivePolicy().id);
./packages/compost-core/src/ledger/outbox.ts:21:  transform_policy: string;
./packages/compost-core/src/ledger/outbox.ts:41:      trust_tier, transform_policy, payload
./packages/compost-core/src/ledger/outbox.ts:50:      event.transform_policy,
./packages/compost-core/src/ledger/outbox.ts:64:  transform_policy: string;
./packages/compost-core/src/ledger/outbox.ts:88:              trust_tier, transform_policy, payload, appended_at
./packages/compost-core/src/ledger/outbox.ts:182:        `INSERT OR IGNORE INTO observations (
./packages/compost-core/src/ledger/outbox.ts:186:          transform_policy, metadata
./packages/compost-core/src/ledger/outbox.ts:205:          pending.transform_policy,
./packages/compost-core/src/ledger/outbox.ts:215:          `SELECT observe_id FROM observations
./packages/compost-core/test/crash-recovery.test.ts:24:    transform_policy: "tp-2026-04",
./packages/compost-core/test/crash-recovery.test.ts:82:  // Scenario 2: Crash during daemon drain step 2 (observations insert)
./packages/compost-core/test/crash-recovery.test.ts:98:      .query("SELECT count(*) as cnt FROM observations")
./packages/compost-core/test/crash-recovery.test.ts:110:      .query("SELECT count(*) as cnt FROM observations")
./packages/compost-core/test/crash-recovery.test.ts:143:      `INSERT INTO observations (
./packages/compost-core/test/crash-recovery.test.ts:147:         transform_policy, metadata
./packages/compost-core/test/crash-recovery.test.ts:173:      .query("SELECT count(*) as cnt FROM observations")
./packages/compost-core/test/crash-recovery.test.ts:204:      `INSERT INTO observations (
./packages/compost-core/test/crash-recovery.test.ts:208:         transform_policy, metadata
./packages/compost-core/test/crash-recovery.test.ts:232:      .query("SELECT count(*) as cnt FROM observations")
./packages/compost-core/test/crash-recovery.test.ts:259:      `INSERT INTO observations (
./packages/compost-core/test/crash-recovery.test.ts:263:         transform_policy, metadata
./packages/compost-core/test/crash-recovery.test.ts:276:      `DELETE FROM observations
./packages/compost-core/test/crash-recovery.test.ts:285:      .query("SELECT 1 FROM observations WHERE observe_id = 'obs-gc-crash'")
./packages/compost-core/test/crash-recovery.test.ts:297:    expect(report.sensoryObservationsDeleted).toBe(1);
./packages/compost-core/test/crash-recovery.test.ts:303:      .query("SELECT 1 FROM observations WHERE observe_id = 'obs-gc-crash'")
./packages/compost-core/test/crash-recovery.test.ts:324:      `INSERT INTO observations (
./packages/compost-core/test/crash-recovery.test.ts:328:         transform_policy, metadata
./packages/compost-core/test/wiki-fallback.test.ts:13: * wiki synthesis, keep the existing on-disk page but mark wiki_pages.stale_at
./packages/compost-core/test/wiki-fallback.test.ts:22:    "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','t',1,'user','i','tp-2026-04',NULL)"
./packages/compost-core/test/wiki-fallback.test.ts:56:      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
./packages/compost-core/test/wiki-fallback.test.ts:95:      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
./packages/compost-core/test/wiki-fallback.test.ts:107:    db.run("UPDATE wiki_pages SET stale_at = datetime('now') WHERE title = 'paris'");
./packages/compost-core/test/wiki-fallback.test.ts:119:      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
./packages/compost-core/test/wiki-fallback.test.ts:130:      .query("SELECT COUNT(*) AS c FROM wiki_pages WHERE title = 'paris'")
./packages/compost-core/test/wiki-fallback.test.ts:161:      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
./packages/compost-core/src/llm/ollama.ts:52:        method: "POST",
./packages/compost-core/test/migrator.test.ts:39:      "0011_fact_links_and_health_fix",
./packages/compost-core/test/migrator.test.ts:69:      "correction_events",        // 0010 P0-5
./packages/compost-core/test/migrator.test.ts:74:      "fact_links",               // 0011 P0-0
./packages/compost-core/test/migrator.test.ts:78:      "health_signals",           // 0010 P0-1
./packages/compost-core/test/migrator.test.ts:80:      "observations",
./packages/compost-core/test/migrator.test.ts:90:      "wiki_pages",
./packages/compost-core/test/migrator.test.ts:126:      "INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),'hash1','raw1',NULL,NULL,'text/plain','test-adapter',1,'user','idem1','tp-2026-04',NULL)"
./packages/compost-core/test/migrator.test.ts:135:    db.run("DELETE FROM observations WHERE observe_id = 'obs1'");
./packages/compost-core/test/migrator.test.ts:152:      "INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),'hash1','raw1',NULL,NULL,'text/plain','test-adapter',1,'user','idem1','tp-2026-04',NULL)"
./packages/compost-core/test/migrator.test.ts:155:      "INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id) VALUES ('test','s1','local-file','file:///test','idem1','user','tp-2026-04','{}',datetime('now'),'obs1')"
./packages/compost-core/test/migrator.test.ts:158:    db.run("DELETE FROM observations WHERE observe_id = 'obs1'");
./packages/compost-core/test/reflect-archive-reason.test.ts:21:  // Reflect step 1 only GCs sensory observations — non-sensory facts stay
./packages/compost-core/test/reflect-archive-reason.test.ts:27:    "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','test',1,'user','idem','tp-2026-04',NULL)"
./packages/compost-core/test/reflect-archive-reason.test.ts:266:  // ---- Debate 005 fix #1: contradiction creates fact_links edges ----
./packages/compost-core/test/reflect-archive-reason.test.ts:268:  test("contradiction resolution writes 'contradicts' edges to fact_links", () => {
./packages/compost-core/test/reflect-archive-reason.test.ts:276:        "SELECT from_fact_id, to_fact_id, kind FROM fact_links WHERE from_fact_id = 'loser'"
./packages/compost-core/test/reflect-archive-reason.test.ts:294:        "SELECT from_fact_id, to_fact_id FROM fact_links WHERE kind = 'contradicts' ORDER BY from_fact_id"
./packages/compost-core/test/correction-detector.test.ts:33:  test("correction_events table exists", () => {
./packages/compost-core/test/correction-detector.test.ts:35:      .query("PRAGMA table_info('correction_events')")
./packages/compost-core/test/correction-detector.test.ts:91:  test("recordCorrection inserts correction_events + health_signals transactionally", () => {
./packages/compost-core/test/correction-detector.test.ts:103:        "SELECT session_id, retracted_text, pattern_matched, processed_at, related_fact_ids_json FROM correction_events WHERE id = ?"
./packages/compost-core/test/correction-detector.test.ts:119:        "SELECT kind, severity, target_ref FROM health_signals WHERE target_ref = ?"
./packages/compost-core/test/correction-detector.test.ts:139:      .query("SELECT related_fact_ids_json FROM correction_events WHERE id = ?")
./packages/compost-core/test/correction-detector.test.ts:168:      "INSERT INTO observations VALUES ('obs-corr','claude-code:sess-1:/tmp/x','claude-code://sess-1',datetime('now'),datetime('now'),'h','r',?,NULL,'application/json','claude-code',1,'first_party','idem-corr','tp-2026-04',NULL)",
./packages/compost-core/test/correction-detector.test.ts:177:        "SELECT session_id, pattern_matched FROM correction_events WHERE id = ?"
./packages/compost-core/test/correction-detector.test.ts:184:  test("scanObservationForCorrection skips non-claude-code observations", () => {
./packages/compost-core/test/correction-detector.test.ts:190:      "INSERT INTO observations VALUES ('obs-file','file-src','file:///a.md',datetime('now'),datetime('now'),'h','r',?,NULL,'text/plain','test',1,'user','idem-file','tp-2026-04',NULL)",
./packages/compost-core/test/correction-detector.test.ts:209:      "INSERT INTO observations VALUES ('obs-clean','claude-code:sess-2:/x','claude-code://sess-2',datetime('now'),datetime('now'),'h','r',?,NULL,'application/json','claude-code',1,'first_party','idem-clean','tp-2026-04',NULL)",
./packages/compost-core/test/correction-detector.test.ts:224:      "INSERT INTO observations VALUES ('obs-bad','claude-code:sess-3:/y','claude-code://sess-3',datetime('now'),datetime('now'),'h','r',?,NULL,'application/json','claude-code',1,'first_party','idem-bad','tp-2026-04',NULL)",
./packages/compost-core/test/ledger.test.ts:22:    transform_policy: "tp-2026-04",
./packages/compost-core/test/ledger.test.ts:115:    const obs = db.query("SELECT * FROM observations WHERE observe_id = ?").get(result!.observe_id) as Record<string, unknown>;
./packages/compost-core/test/ledger.test.ts:120:    expect(obs.transform_policy).toBe("tp-2026-04");
./packages/compost-core/test/ledger.test.ts:195:    // Observations should also only have one row
./packages/compost-core/test/ledger.test.ts:196:    const obsCount = db.query("SELECT count(*) as cnt FROM observations").get() as { cnt: number };
./packages/compost-core/test/ledger.test.ts:216:  test("observations UNIQUE constraint prevents duplicate on drain retry", () => {
./packages/compost-core/test/ledger.test.ts:225:    // Re-drain should succeed (INSERT OR IGNORE on observations)
./packages/compost-core/test/ledger.test.ts:230:    const obsCount = db.query("SELECT count(*) as cnt FROM observations").get() as { cnt: number };
./packages/compost-core/test/archive-reason.test.ts:39:      "INSERT INTO observations VALUES ('obs1','s1','file:///t',datetime('now'),datetime('now'),'h1','r1',NULL,NULL,'text/plain','test',1,'user','idem1','tp-2026-04',NULL)"
./packages/compost-core/test/archive-reason.test.ts:55:      "INSERT INTO observations VALUES ('obs1','s1','file:///t',datetime('now'),datetime('now'),'h1','r1',NULL,NULL,'text/plain','test',1,'user','idem1','tp-2026-04',NULL)"
./packages/compost-core/test/archive-reason.test.ts:81:      "INSERT INTO observations VALUES ('obs1','s1','file:///t',datetime('now'),datetime('now'),'h1','r1',NULL,NULL,'text/plain','test',1,'user','idem1','tp-2026-04',NULL)"
./packages/compost-core/test/queue.test.ts:25:      `INSERT INTO observations VALUES (?,  's1','file:///test',datetime('now'),datetime('now'),'h${i}','r${i}',NULL,NULL,'text/plain','test',${i},'user','idem${i}','tp-2026-04',NULL)`,
./packages/compost-core/test/reflect.test.ts:23:    `INSERT INTO observations VALUES (?,?,?,datetime('now', ? || ' days'),datetime('now', ? || ' days'),'h','r',NULL,NULL,'text/plain','test',1,'user',?,'tp-2026-04',NULL)`,
./packages/compost-core/test/reflect.test.ts:52:    expect(report.sensoryObservationsDeleted).toBe(0);
./packages/compost-core/test/reflect.test.ts:63:  test("sensory GC deletes observations older than 7 days from sensory sources", () => {
./packages/compost-core/test/reflect.test.ts:69:    expect(report.sensoryObservationsDeleted).toBe(1);
./packages/compost-core/test/reflect.test.ts:72:    const old = db.query("SELECT 1 FROM observations WHERE observe_id = 'obs-old'").get();
./packages/compost-core/test/reflect.test.ts:76:    const fresh = db.query("SELECT 1 FROM observations WHERE observe_id = 'obs-new'").get();
./packages/compost-core/test/reflect.test.ts:80:  test("sensory GC does NOT delete non-sensory observations", () => {
./packages/compost-core/test/reflect.test.ts:85:    expect(report.sensoryObservationsDeleted).toBe(0);
./packages/compost-core/test/reflect.test.ts:87:    const row = db.query("SELECT 1 FROM observations WHERE observe_id = 'obs-old-file'").get();
./packages/compost-core/test/reflect.test.ts:98:    expect(report.sensoryObservationsDeleted).toBe(1);
./packages/compost-core/test/reflect.test.ts:111:    expect(report.sensoryObservationsDeleted).toBe(1);
./packages/compost-core/test/reflect.test.ts:137:    expect(report.sensoryObservationsDeleted).toBe(1);
./packages/compost-core/test/reflect.test.ts:211:      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id)
./packages/compost-core/test/reflect.test.ts:216:      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id)
./packages/compost-core/test/reflect.test.ts:221:      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload)
./packages/compost-core/test/reflect.test.ts:236:      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,drain_quarantined_at)
./packages/compost-core/test/triage.test.ts:29:  "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','payload',1,'user','idem','tp-2026-04',NULL)";
./packages/compost-core/test/triage.test.ts:85:       idempotency_key, trust_tier, transform_policy, payload,
./packages/compost-core/test/triage.test.ts:102:    `INSERT INTO wiki_pages (path, title, last_synthesis_at, last_synthesis_model, stale_at)
./packages/compost-core/test/triage.test.ts:125:  test("health_signals table exists with all columns", () => {
./packages/compost-core/test/triage.test.ts:127:      .query("PRAGMA table_info('health_signals')")
./packages/compost-core/test/triage.test.ts:159:  test("health_signals CHECK accepts correction_candidate (added by 0012)", () => {
./packages/compost-core/test/triage.test.ts:161:      "INSERT INTO health_signals (kind, severity, message, target_ref) VALUES (?, ?, ?, ?)",
./packages/compost-core/test/triage.test.ts:165:      .query("SELECT kind FROM health_signals WHERE target_ref = 'fact-test-1'")
./packages/compost-core/test/triage.test.ts:208:        "SELECT kind, severity, target_ref FROM health_signals WHERE kind = 'stuck_outbox'"
./packages/compost-core/test/triage.test.ts:222:         idempotency_key, trust_tier, transform_policy, payload,
./packages/compost-core/test/triage.test.ts:231:      .query("SELECT COUNT(*) AS c FROM health_signals")
./packages/compost-core/test/triage.test.ts:243:      .query("SELECT COUNT(*) AS c FROM health_signals WHERE target_ref = 'outbox:1'")
./packages/compost-core/test/triage.test.ts:279:        "SELECT kind, severity, target_ref, message FROM health_signals WHERE kind = 'stale_wiki'"
./packages/compost-core/test/triage.test.ts:297:      .query("SELECT message FROM health_signals WHERE target_ref = 'wiki:london.md'")
./packages/compost-core/test/triage.test.ts:331:      .query("SELECT kind, target_ref FROM health_signals")
./packages/compost-core/test/triage.test.ts:381:      .query("SELECT kind, target_ref, severity FROM health_signals")
./packages/compost-core/test/triage.test.ts:438:      .query("SELECT target_ref FROM health_signals WHERE kind = 'orphan_delta'")
./packages/compost-core/test/triage.test.ts:509:      .query("SELECT id FROM health_signals WHERE kind = 'stuck_outbox'")
./packages/compost-core/test/triage.test.ts:525:      .query("SELECT COUNT(*) AS c FROM health_signals")
./packages/compost-core/test/triage.test.ts:534:      .query("SELECT id FROM health_signals")
./packages/compost-core/test/triage.test.ts:541:      .query("SELECT resolved_by FROM health_signals WHERE id = ?")

codex
在看 migration 细节和现有 triage/health 设计，重点确认哪些“脏数据”已被约束，哪些仍只有检测没有修复闭环。
exec
/bin/zsh -lc "sed -n '160,220p' docs/ROADMAP.md" in <repo>
 succeeded in 0ms:
> (a) `fact_links` was hidden P0-3 prerequisite, (b) backup/restore is data-loss
> insurance not optional, (c) LLM single-point failure needs circuit breaker.

**Phase 4 P0 (8 items, 4/4 consensus)**

| # | Item | Depends on |
|---|------|------------|
| P0-0 | `fact_links` table + bidirectional FK + recursive CTE API (was Phase 3 carried, promoted) | none |
| P0-1 | `compost triage` + `health_signals` (6 signal kinds: 5 scanners + 1 drain-hook producer; surface-only) | 0010 |
| P0-2 | `decision_audit` table + confidence ladder (0.90/0.85/0.75) writes | P0-4 enum stable |
| P0-3 | `v_graph_health` TS impl + `graph_health_snapshot` (bundled with P0-0 PR) | P0-0 |
| P0-4 | `facts.archive_reason` + `replaced_by_fact_id` + `revival_at` writes | facts |
| P0-5 | `correction_events` capture (signal feeds triage; never directly mutates `facts.confidence`) | hook-shim |
| P0-6 | LLM circuit breaker + `IExtractorClient` provider abstraction + Self-Consumption guard (reject Wiki/ source re-ingest) | none |
| P0-7 | `compost backup` + `restore` (SQLite VACUUM INTO + 24h cron + 30 retained snapshots) | none |

**Phase 4 P1 (4 items, after P0 lands)**
- `open_problems` table + CLI (consolidates old "Curiosity agent" + "Gap tracker")
- Inlet `origin_hash` + `method` columns on `observations` (machine-required, user-optional)
- Performance benchmark harness (`bench/` with reflect-1k/10k/100k.bench.ts + CI > 50% regression alert)
- PII redactor in hook-shim (regex blocklist for CC / SSH / API-token / .env / "password:" patterns; required before any open-source release)

**Carried from Phase 3 (still scheduled, no tier change)**
- Episodic memory materialization (`session_turns` FTS5 + episode summary)
- `memory_procedural` standalone table (P2 candidate — Gemini-Opus disagreement, observe before deciding)

**Phase 4 P2 (defer indefinitely; revisit after P0+P1)**
- Semantic Cohort Intelligence (query-side experimental)
- Milestone retrospective scheduler
- Four-layer self-model dashboard (downgraded: triage already covers A inventory + C decay)
- `compression_pressure` SQL view (downgraded: `health_signals.stale_fact` already proxies pressure)
- `memory_procedural` standalone table

**Removed from Phase 4** (4/4 Reject in debate)
- ~~Curiosity agent~~ (replaced by `open_problems` + triage signals)
- ~~Gap tracker~~ (replaced by `open_problems`)
- ~~Autonomous crawl with is_noteworthy gates~~ (breaks first-party principle)
- ~~`crawl_queue`~~ (duplicates `open_problems` + manual `compost add <url>`)
- ~~Cross-project `shareable` tag + export~~ (moved to Phase 5 portability)
- ~~Semantic chunking / Savitzky-Golay~~ (no evaluation framework; heading-based already adequate)
- ~~Audit log TTL design~~ (YAGNI for personal-tool ingest rates; revisit if `decision_audit` exceeds 100K rows)
- ~~Migration `down.sql` rollback machinery~~ (P0-7 backup covers recovery; restore-from-backup beats partial revert)

### Phase 5: Portability (later, on demand)

> Renamed from "Multi-Host". Multi-host concurrency was an enterprise pseudo-need;
> single-user portability (laptop swap, machine reinstall) is the real scenario.

**Planned**
- `compost export <bundle>` and `compost import <bundle>` (markdown + sqlite dump combo)
- Conflict-resolution design doc (decide before coding: last-writer-wins / merge / fail)

**Removed**
- ~~Cross-machine sync protocol~~ (no demonstrated user need)
- ~~Multi-host concurrency coordination~~ (enterprise)
- ~~HTTP transport for remote MCP clients~~ (MCP stdio is sufficient)

### Phase 6: Ecosystem (later, minimal scope)

**Planned**
- `compost-adapter-openclaw` (concrete user need)

exec
/bin/zsh -lc 'rg --files packages/compost-core/src | rg "migr|schema|db|triage|reflect|ledger|fact-links|correction|health"' in <repo>
 succeeded in 0ms:
packages/compost-core/src/query/feedback.ts
packages/compost-core/src/schema/0003_stateless_decay.sql
packages/compost-core/src/schema/0012_correction_signal_kind.sql
packages/compost-core/src/schema/0006_chunks_and_fts5.sql
packages/compost-core/src/schema/0005_merged_outbox.sql
packages/compost-core/src/schema/0008_phase3_ranking.sql
packages/compost-core/src/schema/0009_phase3_contradiction_and_wiki_versions.sql
packages/compost-core/src/schema/0007_phase2_search.sql
packages/compost-core/src/schema/0013_wiki_stale_at.sql
packages/compost-core/src/schema/0010_phase4_myco_integration.sql
packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql
packages/compost-core/src/schema/0002_debate3_fixes.sql
packages/compost-core/src/schema/migrator.ts
packages/compost-core/src/schema/0001_init.sql
packages/compost-core/src/schema/0004_probabilistic_ranking.sql
packages/compost-core/src/storage/lancedb.ts
packages/compost-core/src/ledger/noteworthy.ts
packages/compost-core/src/ledger/outbox.ts
packages/compost-core/src/cognitive/correction-detector.ts
packages/compost-core/src/cognitive/triage.ts
packages/compost-core/src/cognitive/fact-links.ts
packages/compost-core/src/cognitive/graph-health.ts
packages/compost-core/src/cognitive/reflect.ts

exec
/bin/zsh -lc 'rg -n "CREATE TABLE observations|CREATE TABLE fact_links|CREATE TABLE wiki_pages|CREATE TABLE health_signals|CREATE TABLE correction_events|open_problems|ALTER TABLE observations|origin_hash|method|transform_policy" packages/compost-core packages/compost-cli packages/compost-daemon docs/ROADMAP.md docs/ARCHITECTURE.md docs/phase0-spec.md -S' in <repo>
 succeeded in 0ms:
docs/ROADMAP.md:177:- `open_problems` table + CLI (consolidates old "Curiosity agent" + "Gap tracker")
docs/ROADMAP.md:178:- Inlet `origin_hash` + `method` columns on `observations` (machine-required, user-optional)
docs/ROADMAP.md:194:- ~~Curiosity agent~~ (replaced by `open_problems` + triage signals)
docs/ROADMAP.md:195:- ~~Gap tracker~~ (replaced by `open_problems`)
docs/ROADMAP.md:197:- ~~`crawl_queue`~~ (duplicates `open_problems` + manual `compost add <url>`)
docs/ARCHITECTURE.md:110:  policies/        transform_policy registry (tp-2026-04, tp-2026-04-02, tp-2026-04-03)
docs/phase0-spec.md:30:│   │   │   ├── policies/     # transform_policy registry
docs/phase0-spec.md:109:CREATE TABLE observations (
docs/phase0-spec.md:124:  transform_policy TEXT NOT NULL,         -- the policy version applied at capture, e.g. "tp-2026-04"
docs/phase0-spec.md:137:  transform_policy TEXT NOT NULL,         -- the policy version at derivation time
docs/phase0-spec.md:200:CREATE TABLE wiki_pages (
docs/phase0-spec.md:213:2. `observations.transform_policy` — every row tagged with the policy version active at capture. Enables deterministic replay.
docs/phase0-spec.md:219:## 2. `transform_policy` versioning convention
docs/phase0-spec.md:229:A `transform_policy` encapsulates:
docs/phase0-spec.md:429:  "transform_policy": "tp-2026-04"
docs/phase0-spec.md:449:  "transform_policy": "tp-2026-04",
docs/phase0-spec.md:531:    transform_policy: string;
docs/phase0-spec.md:734:- [ ] `transform_policy` registry compiles, `tp-2026-04` exists
packages/compost-daemon/src/scheduler.ts:226:  transform_policy: string;
packages/compost-daemon/src/scheduler.ts:289:      `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
packages/compost-daemon/src/scheduler.ts:301:        transform_policy: policy.id,
packages/compost-daemon/src/scheduler.ts:342:        `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
packages/compost-core/src/query/search.ts:29:    transform_policy: string;
packages/compost-core/src/query/search.ts:222:        o.source_uri, o.captured_at, o.adapter, o.transform_policy,
packages/compost-core/src/query/search.ts:289:      transform_policy: r.transform_policy as string,
packages/compost-daemon/src/mcp-server.ts:79:        transform_policy: z.string(),
packages/compost-daemon/src/mcp-server.ts:93:          transform_policy: input.transform_policy,
packages/compost-cli/src/commands/hook.ts:71:        transform_policy: "default",
packages/compost-daemon/test/daemon.test.ts:129:      transform_policy: "tp-2026-04",
packages/compost-daemon/test/daemon.test.ts:159:      transform_policy: "tp-2026-04",
packages/compost-core/src/schema/0012_correction_signal_kind.sql:11:CREATE TABLE health_signals (
packages/compost-core/src/schema/0002_debate3_fixes.sql:11:  transform_policy TEXT NOT NULL,
packages/compost-core/src/schema/0002_debate3_fixes.sql:22:    observe_id || ':' || layer || ':' || transform_policy || ':' ||
packages/compost-core/src/schema/0002_debate3_fixes.sql:29:  ON derivation_run(observe_id, layer, transform_policy, model_id,
packages/compost-core/src/schema/0002_debate3_fixes.sql:36:-- transform_policy table (populated from TypeScript registry at daemon startup)
packages/compost-daemon/test/reflect-scheduler.test.ts:200:         idempotency_key, trust_tier, transform_policy, payload,
packages/compost-core/src/pipeline/ingest.ts:30:  transform_policy: string;
packages/compost-core/src/pipeline/ingest.ts:103:    transform_policy: policy.id,
packages/compost-core/src/pipeline/ingest.ts:142:    `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
packages/compost-core/src/pipeline/ingest.ts:154:      transform_policy: policy.id,
packages/compost-core/src/pipeline/ingest.ts:201:      `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
packages/compost-cli/test/cli.test.ts:141:      transform_policy: "default",
packages/compost-cli/test/cli.test.ts:306:      transform_policy: "default",
packages/compost-cli/test/cli.test.ts:347:      transform_policy: "default",
packages/compost-core/src/pipeline/web-ingest.ts:4: * with web-specific adapter and transform_policy.
packages/compost-core/src/pipeline/web-ingest.ts:121:    transform_policy: policyId,
packages/compost-core/src/pipeline/web-ingest.ts:153:    `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
packages/compost-core/src/pipeline/web-ingest.ts:178:      transform_policy: policyId,
packages/compost-core/src/pipeline/web-ingest.ts:204:      `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
packages/compost-core/src/ledger/outbox.ts:21:  transform_policy: string;
packages/compost-core/src/ledger/outbox.ts:41:      trust_tier, transform_policy, payload
packages/compost-core/src/ledger/outbox.ts:50:      event.transform_policy,
packages/compost-core/src/ledger/outbox.ts:64:  transform_policy: string;
packages/compost-core/src/ledger/outbox.ts:88:              trust_tier, transform_policy, payload, appended_at
packages/compost-core/src/ledger/outbox.ts:186:          transform_policy, metadata
packages/compost-core/src/ledger/outbox.ts:205:          pending.transform_policy,
packages/compost-core/src/policies/registry.ts:129:      `transform_policy \`${policyId}\` is not registered — add it to \`packages/compost-core/src/policies/registry.ts\` and restart the daemon`
packages/compost-core/src/schema/0006_chunks_and_fts5.sql:5:-- chunks table provides the authoritative mapping from (observe_id, transform_policy, chunk_id)
packages/compost-core/src/schema/0006_chunks_and_fts5.sql:21:  transform_policy TEXT NOT NULL,
packages/compost-core/src/schema/0006_chunks_and_fts5.sql:24:  UNIQUE(observe_id, chunk_index, transform_policy)
packages/compost-core/src/schema/0005_merged_outbox.sql:19:  transform_policy TEXT NOT NULL,         -- must exist in policies table at drain time
packages/compost-core/src/schema/0001_init.sql:23:CREATE TABLE observations (
packages/compost-core/src/schema/0001_init.sql:38:  transform_policy TEXT NOT NULL,
packages/compost-core/src/schema/0001_init.sql:109:CREATE TABLE wiki_pages (
packages/compost-core/test/self-consumption.test.ts:75:      transform_policy: "tp-2026-04",
packages/compost-core/test/self-consumption.test.ts:104:      transform_policy: "tp-2026-04",
packages/compost-core/test/self-consumption.test.ts:126:      transform_policy: "tp-2026-04",
packages/compost-core/test/triage.test.ts:85:       idempotency_key, trust_tier, transform_policy, payload,
packages/compost-core/test/triage.test.ts:222:         idempotency_key, trust_tier, transform_policy, payload,
packages/compost-core/test/query.test.ts:77:        transform_policy: "tp-2026-04",
packages/compost-core/test/query.test.ts:228:    expect(topHit.provenance.transform_policy).toBe("tp-2026-04-03");
packages/compost-core/test/crash-recovery.test.ts:24:    transform_policy: "tp-2026-04",
packages/compost-core/test/crash-recovery.test.ts:147:         transform_policy, metadata
packages/compost-core/test/crash-recovery.test.ts:208:         transform_policy, metadata
packages/compost-core/test/crash-recovery.test.ts:263:         transform_policy, metadata
packages/compost-core/test/crash-recovery.test.ts:328:         transform_policy, metadata
packages/compost-core/test/migrator.test.ts:155:      "INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id) VALUES ('test','s1','local-file','file:///test','idem1','user','tp-2026-04','{}',datetime('now'),'obs1')"
packages/compost-core/test/ledger.test.ts:22:    transform_policy: "tp-2026-04",
packages/compost-core/test/ledger.test.ts:120:    expect(obs.transform_policy).toBe("tp-2026-04");
packages/compost-core/test/pipeline.test.ts:67:    expect(obs.transform_policy).toBe(getActivePolicy().id);
packages/compost-core/test/pipeline.test.ts:87:    expect(deriv.transform_policy).toBe(getActivePolicy().id);
packages/compost-core/test/pipeline.test.ts:142:  test("ingestFile uses active transform_policy", async () => {
packages/compost-core/test/pipeline.test.ts:147:      .query("SELECT transform_policy FROM observations WHERE observe_id = ?")
packages/compost-core/test/pipeline.test.ts:148:      .get(result.observe_id!) as { transform_policy: string };
packages/compost-core/test/pipeline.test.ts:149:    expect(obs.transform_policy).toBe(getActivePolicy().id);
packages/compost-core/src/embedding/ollama.ts:47:        method: "POST",
packages/compost-core/test/reflect.test.ts:211:      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id)
packages/compost-core/test/reflect.test.ts:216:      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id)
packages/compost-core/test/reflect.test.ts:221:      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload)
packages/compost-core/test/reflect.test.ts:236:      `INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,drain_quarantined_at)
packages/compost-core/src/llm/ollama.ts:52:        method: "POST",

codex
已确认 P1 原始排序来自 roadmap。接下来只看会影响判断的 DDL 与 triage 扫描实现，不扩散到无关模块。
exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-core/src/schema/0001_init.sql" in <repo>
 succeeded in 0ms:
-- Migration 0001_init.sql
-- Source: compost-v2-spec.md §1.1 (phase0-spec.md + debate #3 preserved)
-- Creates: source, observations, ingest_queue, expected_item, captured_item, facts, wiki_pages

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- Source registry
CREATE TABLE source (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('local-file','local-dir','web','claude-code','host-adapter','sensory')),
  refresh_sec INTEGER,
  coverage_target REAL DEFAULT 0.0,
  trust_tier TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_tier IN ('user','first_party','web')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paused_at TEXT
);

-- Observations: immutable append-only ledger (the rebuild anchor)
CREATE TABLE observations (
  observe_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id),
  source_uri TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  raw_bytes BLOB,
  blob_ref TEXT,
  mime_type TEXT NOT NULL,
  adapter TEXT NOT NULL,
  adapter_sequence INTEGER NOT NULL,
  trust_tier TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  transform_policy TEXT NOT NULL,
  metadata JSON,
  UNIQUE(adapter, source_id, idempotency_key)
);

CREATE INDEX idx_obs_source ON observations(source_id, captured_at);
CREATE INDEX idx_obs_content_hash ON observations(content_hash);

-- Ingest queue (lease columns added in 0002)
-- NOTE: ON DELETE CASCADE on observe_id so that `compost reflect` sensory GC
-- can hard-delete observations without RESTRICT-blocking on pending queue rows.
-- Sensory observations that still have pending queue rows are GC-eligible:
-- the queue row is dropped as a side effect of the observation being aged out.
CREATE TABLE ingest_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  priority INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX idx_queue_pending ON ingest_queue(priority, enqueued_at)
  WHERE completed_at IS NULL;

-- Coverage SLO tracking
CREATE TABLE expected_item (
  source_id TEXT NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  expected_at TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id)
);

-- captured_item: ON DELETE CASCADE on observe_id so reflect() can GC sensory rows.
-- Losing captured_item rows for aged sensory observations is acceptable -- SLO tracking
-- does not survive past the sensory TTL window anyway.
CREATE TABLE captured_item (
  source_id TEXT NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, external_id, captured_at)
);

-- L2 facts (semantic tier base; debate #3 removed contexts TEXT[] in favor of fact_context join)
-- NOTE: ON DELETE CASCADE on observe_id. Facts derived from sensory observations (which
-- expire after 7 days) are cascade-deleted. Facts derived from non-sensory observations
-- are never deleted by reflect() -- only the sensory-kind source_id cohort is GC targeted.
CREATE TABLE facts (
  fact_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  importance REAL NOT NULL DEFAULT 0.5,
  importance_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by TEXT REFERENCES facts(fact_id),
  conflict_group INTEGER,
  archived_at TEXT  -- soft tombstone (Phase 0 sensory-GC / reflection sweep)
);

CREATE INDEX idx_facts_spo ON facts(subject, predicate);
CREATE INDEX idx_facts_observe ON facts(observe_id);
CREATE INDEX idx_facts_active ON facts(created_at) WHERE archived_at IS NULL;

-- L3 wiki page registry (actual markdown on disk; debate #3 replaced contributing_observes TEXT with wiki_page_observe)
CREATE TABLE wiki_pages (
  path TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  last_synthesis_at TEXT NOT NULL,
  last_synthesis_model TEXT NOT NULL
);

exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-core/src/schema/0012_correction_signal_kind.sql" in <repo>
exec
/bin/zsh -lc "sed -n '1,200p' packages/compost-core/src/schema/0013_wiki_stale_at.sql" in <repo>
exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql" in <repo>
exec
/bin/zsh -lc "sed -n '1,240p' packages/compost-core/src/schema/0010_phase4_myco_integration.sql" in <repo>
 succeeded in 0ms:
-- Migration 0013_wiki_stale_at.sql
-- Source: debates/007-week3-plan-audit/synthesis.md Lock 6 (2026-04-15)
-- Adds `wiki_pages.stale_at` to support the P0-6 wiki circuit-breaker fallback.
--
-- Flow locked in debate 007 Lock 6:
--   1. wiki.ts rebuild calls the LLM. If the breaker is open, fallback
--      keeps the existing markdown on disk BUT marks wiki_pages.stale_at = now.
--   2. ask.ts (query/ask.ts:123-128 wiki-context read) checks stale_at
--      when pulling wiki pages into the answer context. Non-null stale_at
--      causes the answer to prefix `[stale wiki: <date>]` so the user is
--      explicitly told the LLM wasn't available for the most recent refresh.
--   3. Next successful rebuild clears stale_at to NULL.
--
-- Without this column, the silent-stale-wiki failure mode identified by
-- Codex R1 (debate 007) would mean users see old answers as if they were
-- fresh during a prolonged LLM outage.

ALTER TABLE wiki_pages ADD COLUMN stale_at TEXT;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_stale
  ON wiki_pages(stale_at) WHERE stale_at IS NOT NULL;

 succeeded in 0ms:
-- Migration 0012_correction_signal_kind.sql
-- Source: debates/003-p0-readiness/synthesis.md Pre-P0 fix #4 (2026-04-14)
-- Bug: 0010 created health_signals.kind CHECK with 5 values but P0-5 needs to
-- write 'correction_candidate' from correction-detector. Sonnet R1 + Codex R1
-- independently identified — would cause runtime constraint violation.
--
-- SQLite cannot ALTER existing CHECK constraint in place — must rebuild table.
-- Safe: no production rows yet at this revision.

DROP TABLE IF EXISTS health_signals;
CREATE TABLE health_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN (
    'stale_fact',                  -- fact past freshness threshold
    'unresolved_contradiction',    -- conflict_group with no superseded_by, > N days old
    'stuck_outbox',                -- outbox row not drained for > M hours
    'orphan_delta',                -- new orphan facts vs baseline > 5
    'stale_wiki',                  -- wiki_pages.last_synthesis_at past threshold
    'correction_candidate'         -- correction-detector found facts to review (P0-5)
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  target_ref TEXT,                 -- fact_id / wiki_page_path / outbox_id / correction_event_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_health_signals_unresolved
  ON health_signals(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_signals_kind
  ON health_signals(kind, created_at);

 succeeded in 0ms:
-- Migration 0011_fact_links_and_health_fix.sql
-- Source: debates/002-roadmap-gap-audit/synthesis.md (2026-04-14)
-- Two atomic changes from Phase 4-6 gap audit (4/4 consensus):
--   1. Promote `fact_links` to P0-0 (was Phase 3 carried) — prerequisite for P0-3 graph_health
--   2. Fix Sonnet B3 bug: graph_health_snapshot NOT NULL columns conflict with v_graph_health stub NULL
--   3. Replace v_graph_health stub with real implementation backed by fact_links

------------------------------------------------------------------
-- Part 1: fact_links table (P0-0)
------------------------------------------------------------------
-- Bidirectional storage convention: each pair stored once with explicit
-- direction in (from_fact_id, to_fact_id). Queries needing undirected
-- adjacency UNION ALL both directions.
CREATE TABLE IF NOT EXISTS fact_links (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  to_fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'supports',         -- from corroborates to (same conclusion, different evidence)
    'contradicts',      -- from refutes to (used by contradiction arbitration)
    'elaborates',       -- from adds detail to to (parent-child knowledge)
    'derived_from',     -- from was extracted using to as context
    'same_subject'      -- from and to share canonical subject (auto via reflect)
  )),
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0 AND weight <= 1.0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  observed_count INTEGER NOT NULL DEFAULT 1,
  CHECK (from_fact_id != to_fact_id)  -- no self-loops
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_links_unique
  ON fact_links(from_fact_id, to_fact_id, kind);
CREATE INDEX IF NOT EXISTS idx_fact_links_from ON fact_links(from_fact_id);
CREATE INDEX IF NOT EXISTS idx_fact_links_to ON fact_links(to_fact_id);
CREATE INDEX IF NOT EXISTS idx_fact_links_kind ON fact_links(kind, created_at);

------------------------------------------------------------------
-- Part 2: Fix graph_health_snapshot NOT NULL bug (Sonnet B3)
-- 0010 declared orphan_facts / density / cluster_count NOT NULL with no DEFAULT.
-- v_graph_health stub returned NULL. Any INSERT … SELECT FROM v_graph_health
-- would fail with constraint error. SQLite cannot ALTER existing column to add
-- DEFAULT, so we rebuild the table (safe: no rows yet at this revision).
------------------------------------------------------------------
DROP TABLE IF EXISTS graph_health_snapshot;
CREATE TABLE graph_health_snapshot (
  taken_at TEXT PRIMARY KEY DEFAULT (datetime('now')),
  total_facts INTEGER NOT NULL DEFAULT 0,
  orphan_facts INTEGER NOT NULL DEFAULT 0,
  density REAL NOT NULL DEFAULT 0.0,
  cluster_count INTEGER NOT NULL DEFAULT 0,
  stale_cluster_count INTEGER NOT NULL DEFAULT 0
);

------------------------------------------------------------------
-- Part 3: Replace v_graph_health stub with fact_links-backed view
-- Definition order: SQLite stores the view's SELECT as text, so we need
-- to drop and recreate to swap implementation.
------------------------------------------------------------------
DROP VIEW IF EXISTS v_graph_health;
CREATE VIEW v_graph_health AS
WITH active_facts AS (
  SELECT fact_id FROM facts WHERE archived_at IS NULL
),
edges_undirected AS (
  -- Treat each link as undirected for orphan detection and density
  SELECT from_fact_id AS fact_id FROM fact_links
  UNION ALL
  SELECT to_fact_id AS fact_id FROM fact_links
),
linked_facts AS (
  SELECT DISTINCT fact_id FROM edges_undirected
)
SELECT
  (SELECT COUNT(*) FROM active_facts) AS total_facts,
  -- Orphan = active fact older than 24h with no link in either direction
  (SELECT COUNT(*) FROM active_facts a
   LEFT JOIN linked_facts l ON l.fact_id = a.fact_id
   JOIN facts f ON f.fact_id = a.fact_id
   WHERE l.fact_id IS NULL
     AND f.created_at < datetime('now', '-24 hours')
  ) AS orphan_facts,
  -- Density = edges / nodes (clamped: 0 if no nodes)
  CASE
    WHEN (SELECT COUNT(*) FROM active_facts) = 0 THEN 0.0
    ELSE CAST((SELECT COUNT(*) FROM fact_links) AS REAL)
       / CAST((SELECT COUNT(*) FROM active_facts) AS REAL)
  END AS density,
  -- Cluster count placeholder — true connected components needs recursive CTE
  -- in TS layer (graph-health.ts). View returns 0; takeSnapshot computes real.
  0 AS cluster_count,
  datetime('now') AS computed_at;

 succeeded in 0ms:
-- Migration 0010_phase4_myco_integration.sql
-- Source: debates/001-myco-integration/synthesis_v2.md (2026-04-14)
-- Phase 4 Batch D: 5 P0 schema additions from Myco design distillation
--
-- P0-1: health_signals — boot-time triage surface (6 signal kinds with 0012 amendment, no auto-execute)
-- P0-2: decision_audit — high-cost decision audit trail with confidence ladder
-- P0-3: graph_health_snapshot + v_graph_health view — structural decay perception
-- P0-4: facts.archive_reason / replaced_by_fact_id / revival_at — compression 3-criteria
-- P0-5: correction_events — explicit self-correction signal capture

------------------------------------------------------------------
-- P0-1: health_signals (compost triage surface)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN (
    'stale_fact',                  -- fact past freshness threshold
    'unresolved_contradiction',    -- conflict_group with no superseded_by, > N days old
    'stuck_outbox',                -- outbox row not drained for > M hours
    'orphan_delta',                -- new orphan facts vs baseline > 5
    'stale_wiki'                   -- wiki_pages.last_synthesis_at past threshold
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  target_ref TEXT,                 -- fact_id / wiki_page_path / outbox_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT                 -- 'user' / 'agent' / 'auto-cleared'
);

CREATE INDEX IF NOT EXISTS idx_health_signals_unresolved
  ON health_signals(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_signals_kind
  ON health_signals(kind, created_at);

------------------------------------------------------------------
-- P0-2: decision_audit (confidence ladder + write-path audit trail)
------------------------------------------------------------------
-- Confidence floor convention (see synthesis_v2 §P0-2):
--   kernel       = 0.90  (schema / ranking profile / talking profile changes)
--   instance     = 0.85  (fact merge / wiki L3 rebuild / fact excretion)
--   exploration  = 0.75  (default capture / heuristic suggestions)
CREATE TABLE IF NOT EXISTS decision_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN (
    'contradiction_arbitration',
    'wiki_rebuild',
    'fact_excretion',
    'profile_switch'
  )),
  target_id TEXT NOT NULL,         -- fact_id / wiki_path / profile_id (TEXT for cross-table refs)
  confidence_floor REAL NOT NULL CHECK (confidence_floor IN (0.90, 0.85, 0.75)),
  confidence_actual REAL NOT NULL CHECK (confidence_actual >= 0.0 AND confidence_actual <= 1.0),
  rationale TEXT,                  -- short note (≤ 200 chars by convention; not enforced)
  evidence_refs_json TEXT,         -- JSON array of fact_ids / observe_ids
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by TEXT NOT NULL CHECK (decided_by IN ('reflect', 'wiki', 'user', 'agent'))
);

CREATE INDEX IF NOT EXISTS idx_decision_audit_kind ON decision_audit(kind, decided_at);
CREATE INDEX IF NOT EXISTS idx_decision_audit_target ON decision_audit(target_id);

------------------------------------------------------------------
-- P0-3: graph_health_snapshot (daily structural metrics; view is below)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_health_snapshot (
  taken_at TEXT PRIMARY KEY DEFAULT (datetime('now')),
  total_facts INTEGER NOT NULL,
  orphan_facts INTEGER NOT NULL,             -- facts older than 24h with no fact_links edges
  density REAL NOT NULL,                     -- edges / nodes (Phase 4 fact_links graph)
  cluster_count INTEGER NOT NULL,            -- connected components count
  stale_cluster_count INTEGER NOT NULL DEFAULT 0  -- clusters with all facts older than 90d
);

-- v_graph_health: convenience view for current-state read
-- NOTE: This view is a stub. It will be implemented in P0-3 follow-up
-- once fact_links table from Phase 4 fact-graph subtask lands.
-- For now it returns NULL graph metrics so callers don't break.
CREATE VIEW IF NOT EXISTS v_graph_health AS
SELECT
  (SELECT COUNT(*) FROM facts WHERE archived_at IS NULL) AS total_facts,
  NULL AS orphan_facts,           -- stub; superseded by migration 0011 (fact_links-backed view)
  NULL AS density,
  NULL AS cluster_count,
  datetime('now') AS computed_at;

------------------------------------------------------------------
-- P0-4: facts.archive_reason + replaced_by_fact_id + revival_at
-- (compression 3-criteria: frequency, recency, exclusivity)
------------------------------------------------------------------
ALTER TABLE facts ADD COLUMN archive_reason TEXT
  CHECK (archive_reason IS NULL OR archive_reason IN (
    'stale',          -- recency: age > 90d AND access_count_30d = 0
    'superseded',     -- replaced by newer fact (already covered by superseded_by)
    'contradicted',   -- conflict_group resolution chose another fact
    'duplicate',      -- exclusivity: same subject + similarity > 0.92, lower confidence
    'low_access',     -- frequency: never accessed in 60+ days
    'manual'          -- user-driven excretion
  ));

ALTER TABLE facts ADD COLUMN replaced_by_fact_id TEXT
  REFERENCES facts(fact_id);

ALTER TABLE facts ADD COLUMN revival_at TEXT;  -- if archived fact gets re-captured

CREATE INDEX IF NOT EXISTS idx_facts_archive_reason
  ON facts(archive_reason) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facts_replaced_by
  ON facts(replaced_by_fact_id) WHERE replaced_by_fact_id IS NOT NULL;

------------------------------------------------------------------
-- P0-5: correction_events (self-correction signal capture)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,                 -- claude session id from hook env
  retracted_text TEXT NOT NULL,    -- what user said was wrong
  corrected_text TEXT,             -- what user said instead (optional, may be on later turn)
  related_fact_ids_json TEXT,      -- JSON array — facts whose confidence should be reduced
  pattern_matched TEXT,            -- which regex pattern triggered (debug/audit)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT                -- when reflect() consumed this event
);

CREATE INDEX IF NOT EXISTS idx_correction_events_unprocessed
  ON correction_events(created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_correction_events_session
  ON correction_events(session_id, created_at);

------------------------------------------------------------------
-- Migration footer: bump schema_version
------------------------------------------------------------------
-- (handled by migrator.ts — no-op in this file)

exec
/bin/zsh -lc "sed -n '1,260p' packages/compost-core/src/cognitive/triage.ts" in <repo>
exec
/bin/zsh -lc "sed -n '1,240p' packages/compost-core/src/cognitive/graph-health.ts" in <repo>
 succeeded in 0ms:
import type { Database } from "bun:sqlite";
import { connectedComponents, countStaleClusters } from "./fact-links";

/**
 * Debate 005 fix #4: the four numeric fields are non-null since migration
 * 0011 rebuilt `graph_health_snapshot` with `NOT NULL DEFAULT 0` on all of
 * them, and the updated `v_graph_health` view returns 0 instead of NULL on
 * empty inputs. The prior `number | null` typing was a lie to callers.
 */
export interface GraphHealthSnapshot {
  takenAt: string;
  totalFacts: number;
  orphanFacts: number;
  density: number;
  clusterCount: number;
  staleClusterCount: number;
}

/**
 * Compute current graph health metrics.
 *
 * Query split (locked in debate 006 Pre-Week-2 Fix 1): `v_graph_health`
 * returns `total_facts`, `orphan_facts`, `density` as real values; the view's
 * own `cluster_count` column is a hardcoded 0 placeholder. The Week 2
 * implementation MUST NOT read `cluster_count` from the view -- it must
 * compute both `clusterCount` and `staleClusterCount` in TypeScript via
 * `connectedComponents()` and `countStaleClusters()` from `./fact-links`.
 * Reading cluster_count from the view would silently write 0 to every
 * daily snapshot and break `delta()`'s diagnostic signal on day one.
 */
export function currentSnapshot(db: Database): GraphHealthSnapshot {
  // v_graph_health returns cluster_count as a hardcoded 0 placeholder,
  // so we deliberately exclude it from this SELECT and compute it in TS.
  const viewRow = db
    .query(
      "SELECT total_facts, orphan_facts, density FROM v_graph_health"
    )
    .get() as {
    total_facts: number;
    orphan_facts: number;
    density: number;
  };
  const { count: clusterCount } = connectedComponents(db);
  const staleClusterCount = countStaleClusters(db, 90);
  return {
    takenAt: new Date().toISOString(),
    totalFacts: viewRow.total_facts,
    orphanFacts: viewRow.orphan_facts,
    density: viewRow.density,
    clusterCount,
    staleClusterCount,
  };
}

/**
 * Persist a daily snapshot to `graph_health_snapshot`.
 *
 * Idempotency contract (locked in debate 006 Pre-Week-2 Fix 2): same-day
 * retriggers (daemon restart, grace-window refire) must not produce
 * multiple rows or PK collisions. Week 2 implementation will wrap
 * `DELETE FROM graph_health_snapshot WHERE date(taken_at) = date(?)` and
 * a fresh `INSERT` in a single `db.transaction(...)`. Result: at most one
 * row per UTC date, always reflecting the latest call.
 *
 * Called by `startGraphHealthScheduler` (daemon) at 04:00 UTC daily.
 */
export function takeSnapshot(db: Database): GraphHealthSnapshot {
  const snap = currentSnapshot(db);
  const sqliteTs = snap.takenAt.replace("T", " ").slice(0, 19);
  const tx = db.transaction(() => {
    db.run(
      "DELETE FROM graph_health_snapshot WHERE date(taken_at) = date(?)",
      [sqliteTs]
    );
    db.run(
      "INSERT INTO graph_health_snapshot " +
        "(taken_at, total_facts, orphan_facts, density, cluster_count, stale_cluster_count) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
      [
        sqliteTs,
        snap.totalFacts,
        snap.orphanFacts,
        snap.density,
        snap.clusterCount,
        snap.staleClusterCount,
      ]
    );
  });
  tx();
  return snap;
}

/**
 * Compare latest two snapshots; returns deltas useful for triage signal
 * generation. Returns null if fewer than 2 snapshots exist.
 */
export function delta(db: Database): {
  orphanDelta: number;
  densityDelta: number;
  windowDays: number;
} | null {
  const rows = db
    .query(
      "SELECT taken_at, orphan_facts, density " +
        "FROM graph_health_snapshot ORDER BY taken_at DESC LIMIT 2"
    )
    .all() as Array<{
    taken_at: string;
    orphan_facts: number;
    density: number;
  }>;
  if (rows.length < 2) return null;
  const [latest, prior] = rows;
  const latestMs = Date.parse(latest!.taken_at.replace(" ", "T") + "Z");
  const priorMs = Date.parse(prior!.taken_at.replace(" ", "T") + "Z");
  return {
    orphanDelta: latest!.orphan_facts - prior!.orphan_facts,
    densityDelta: latest!.density - prior!.density,
    windowDays: Math.max(
      0,
      Math.round((latestMs - priorMs) / 86_400_000)
    ),
  };
}

 succeeded in 0ms:
import type { Database } from "bun:sqlite";

/**
 * Triage signal kinds — must mirror the CHECK constraint in migration 0010
 * (original 5) + 0012 (correction_candidate). Adding a new kind requires
 * updating both this union and the SQL CHECK clause.
 *
 * Debate 005 fix #3: `correction_candidate` was added to the SQL CHECK in
 * migration 0012 but the TS union lagged behind, causing a silent drop
 * in the `byKind` histogram and type-unsafe writes from correction-detector.
 */
export type SignalKind =
  | "stale_fact"
  | "unresolved_contradiction"
  | "stuck_outbox"
  | "orphan_delta"
  | "stale_wiki"
  | "correction_candidate";

export type SignalSeverity = "info" | "warn" | "error";

export interface HealthSignal {
  id: number;
  kind: SignalKind;
  severity: SignalSeverity;
  message: string;
  target_ref: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface TriageReport {
  signals: HealthSignal[];
  byKind: Record<SignalKind, number>;
  unresolvedTotal: number;
  computedAt: string;
}

/**
 * Default thresholds -- Week 4 contract (debates/011-week4-plan/contract.md):
 * every scanner hard-caps at `maxPerKind` rows so a single triage pass cannot
 * write more than 6 * maxPerKind rows. Values are tunable via TriageOptions
 * but the cap itself is not — "surface only" is cheap by design.
 */
export interface TriageOptions {
  staleFactDays?: number;        // default 90
  contradictionAgeDays?: number; // default 7
  stuckOutboxHours?: number;     // default 24
  /** Access-log window (days) used by `scanOrphanDelta`. Default 30. */
  orphanAccessDays?: number;
  /**
   * Reserved for the Week 5+ delta-vs-baseline semantic (vs current
   * snapshot). See `debates/013-week4-audit/synthesis.md`.
   */
  orphanDeltaThreshold?: number; // default 5 (unused today)
  staleWikiDays?: number;        // default 30
  maxPerKind?: number;           // default 100 (contract cap)
}

const DEFAULT_MAX_PER_KIND = 100;

/**
 * Upsert-style signal insert: skips if an **unresolved** signal with the same
 * (kind, target_ref) already exists. Idempotent across repeated triage runs
 * so a long-running stuck_outbox row does not spawn one signal per scan.
 *
 * Returns `true` if a new row was inserted, `false` if an existing unresolved
 * signal covered the target.
 */
function upsertSignal(
  db: Database,
  kind: SignalKind,
  severity: SignalSeverity,
  message: string,
  targetRef: string
): boolean {
  const existing = db
    .query(
      "SELECT id FROM health_signals " +
        "WHERE kind = ? AND target_ref = ? AND resolved_at IS NULL"
    )
    .get(kind, targetRef) as { id: number } | null;
  if (existing) return false;

  db.run(
    "INSERT INTO health_signals (kind, severity, message, target_ref) " +
      "VALUES (?, ?, ?, ?)",
    [kind, severity, message, targetRef]
  );
  return true;
}

/**
 * `stuck_outbox`: outbox rows still un-drained past the hour threshold.
 * Quarantined rows are explicitly excluded — operator already knows.
 *
 * Contract (surface-only): signals are read-only; remediation is `compost
 * doctor` or manual outbox surgery. Never touches the outbox itself.
 */
export function scanStuckOutbox(
  db: Database,
  hours: number,
  maxPerKind: number
): number {
  const rows = db
    .query(
      `SELECT seq, adapter, source_id, appended_at
       FROM observe_outbox
       WHERE drained_at IS NULL
         AND drain_quarantined_at IS NULL
         AND appended_at < datetime('now', '-' || ? || ' hours')
       ORDER BY appended_at ASC
       LIMIT ?`
    )
    .all(hours, maxPerKind) as Array<{
    seq: number;
    adapter: string;
    source_id: string;
    appended_at: string;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `outbox:${row.seq}`;
    const msg = `outbox row seq=${row.seq} (adapter=${row.adapter}) has been un-drained since ${row.appended_at}`;
    if (upsertSignal(db, "stuck_outbox", "warn", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * `stale_fact`: active, unpinned facts that have not been reinforced within
 * `days`. `last_reinforced_at_unix_sec` is set on every reinforce hit
 * (query + feedback paths); facts that stop being reinforced slide toward
 * decay tombstone via reflect step 2. Surface them here BEFORE reflect
 * archives them so the user can pin if needed.
 */
export function scanStaleFact(
  db: Database,
  days: number,
  maxPerKind: number
): number {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  const rows = db
    .query(
      `SELECT fact_id, subject, predicate, last_reinforced_at_unix_sec
       FROM facts
       WHERE archived_at IS NULL
         AND importance_pinned = FALSE
         AND last_reinforced_at_unix_sec < ?
       ORDER BY last_reinforced_at_unix_sec ASC
       LIMIT ?`
    )
    .all(cutoff, maxPerKind) as Array<{
    fact_id: string;
    subject: string;
    predicate: string;
    last_reinforced_at_unix_sec: number;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `fact:${row.fact_id}`;
    const msg = `fact (${row.subject}, ${row.predicate}) has not been reinforced since unix_sec=${row.last_reinforced_at_unix_sec} (> ${days}d)`;
    if (upsertSignal(db, "stale_fact", "info", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * `unresolved_contradiction`: two or more active facts share the same
 * `(subject, predicate)` pair but disagree on `object`, and reflect has not
 * yet resolved them (age > `days`). Grouping by `conflict_group` would miss
 * the real signal because reflect.ts sets `conflict_group` + `archived_at`
 * on the loser in the same transaction -- so by the time a scan fires,
 * contradictions processed by reflect show only the winner as active and
 * trip no detection. The value this scanner provides is catching
 * contradictions **before** reflect cycles (or when reflect is stuck).
 *
 * Surface rule: one signal per `(subject, predicate)` pair. `target_ref` is
 * `contradiction:<subject>/<predicate>` so repeated scans dedupe via upsert.
 */
export function scanUnresolvedContradiction(
  db: Database,
  days: number,
  maxPerKind: number
): number {
  const rows = db
    .query(
      `SELECT subject, predicate,
              COUNT(DISTINCT object) AS active_objects,
              MIN(created_at) AS oldest_created_at
       FROM facts
       WHERE archived_at IS NULL
         AND superseded_by IS NULL
         AND created_at < datetime('now', '-' || ? || ' days')
       GROUP BY subject, predicate
       HAVING active_objects >= 2
       ORDER BY oldest_created_at ASC
       LIMIT ?`
    )
    .all(days, maxPerKind) as Array<{
    subject: string;
    predicate: string;
    active_objects: number;
    oldest_created_at: string;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `contradiction:${row.subject}/${row.predicate}`;
    const msg = `${row.active_objects} active objects for (${row.subject}, ${row.predicate}); unresolved since ${row.oldest_created_at}`;
    if (upsertSignal(db, "unresolved_contradiction", "warn", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * `orphan_delta`: active facts with no incoming/outgoing `fact_links` edges
 * AND no access_log hit in the last `days` window. Contract (0010 comment):
 * "new orphan facts vs baseline > 5". Day 3 ships the per-fact surfacing;
 * true delta-vs-baseline aggregation requires `graph_health_snapshot`
 * comparison and is scheduled for Week 5+ once baseline stability is
 * observable.
 */
export function scanOrphanDelta(
  db: Database,
  days: number,
  maxPerKind: number
): number {
  const accessCutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  const rows = db
    .query(
      `SELECT f.fact_id, f.subject, f.predicate
       FROM facts f
       WHERE f.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM fact_links l
           WHERE l.from_fact_id = f.fact_id OR l.to_fact_id = f.fact_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM access_log a
           WHERE a.fact_id = f.fact_id AND a.accessed_at_unix_sec >= ?
         )
         AND f.created_at < datetime('now', '-' || ? || ' days')
       ORDER BY f.created_at ASC
       LIMIT ?`
    )
    .all(accessCutoff, days, maxPerKind) as Array<{
    fact_id: string;
    subject: string;
    predicate: string;
  }>;

exec
/bin/zsh -lc "sed -n '1,240p' packages/compost-core/src/cognitive/correction-detector.ts" in <repo>
exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-core/src/schema/migrator.ts" in <repo>
 succeeded in 0ms:
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(import.meta.dir, ".");
const TRACKING_TABLE = "_compost_migrations";

interface MigrationRecord {
  name: string;
  applied_at: string;
  checksum: string;
}

interface ApplyResult {
  applied: MigrationRecord[];
  errors: Array<{ name: string; error: string }>;
}

interface MigrationStatus {
  applied: MigrationRecord[];
  pending: string[];
}

function ensureTrackingTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT NOT NULL
    )
  `);
}

function discoverMigrations(): Array<{ name: string; path: string }> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  return files.map((f) => ({
    name: f.replace(/\.sql$/, ""),
    path: join(MIGRATIONS_DIR, f),
  }));
}

function checksum(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export function applyMigrations(db: Database): ApplyResult {
  ensureTrackingTable(db);

  const applied: MigrationRecord[] = [];
  const errors: ApplyResult["errors"] = [];
  const migrations = discoverMigrations();

  const alreadyApplied = new Set(
    (
      db.query(`SELECT name FROM ${TRACKING_TABLE}`).all() as { name: string }[]
    ).map((r) => r.name)
  );

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.name)) continue;

    const sql = readFileSync(migration.path, "utf-8");
    const hash = checksum(sql);

    try {
      // PRAGMA statements must run outside transactions in SQLite
      const pragmaLines: string[] = [];
      const schemaLines: string[] = [];

      for (const line of sql.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.toUpperCase().startsWith("PRAGMA ")) {
          pragmaLines.push(trimmed);
        } else {
          schemaLines.push(line);
        }
      }

      // Apply PRAGMAs outside transaction
      for (const pragma of pragmaLines) {
        db.exec(pragma);
      }

      // Apply schema in a transaction
      const schemaSQL = schemaLines.join("\n").trim();
      if (schemaSQL) {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.exec(schemaSQL);
          db.run(
            `INSERT INTO ${TRACKING_TABLE} (name, checksum) VALUES (?, ?)`,
            [migration.name, hash]
          );
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      }

      const record: MigrationRecord = {
        name: migration.name,
        applied_at: new Date().toISOString(),
        checksum: hash,
      };
      applied.push(record);
    } catch (e) {
      errors.push({
        name: migration.name,
        error: e instanceof Error ? e.message : String(e),
      });
      break; // Stop on first error - migrations are sequential
    }
  }

  return { applied, errors };
}

export function getMigrationStatus(db: Database): MigrationStatus {
  ensureTrackingTable(db);

  const allMigrations = discoverMigrations();
  const appliedRows = db
    .query(
      `SELECT name, applied_at, checksum FROM ${TRACKING_TABLE} ORDER BY name`
    )
    .all() as MigrationRecord[];

  const appliedNames = new Set(appliedRows.map((r) => r.name));
  const pending = allMigrations
    .filter((m) => !appliedNames.has(m.name))
    .map((m) => m.name);

  return { applied: appliedRows, pending };
}

 succeeded in 0ms:
import type { Database } from "bun:sqlite";

/**
 * Patterns for explicit self-correction. Conservative on purpose:
 * we want low recall + high precision (LLM hallucination noise > correction noise).
 *
 * Detector runs in daemon post-drain (NOT in hook hot path; preserves <20ms cold start).
 */
export const CORRECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Chinese
  { name: "zh.previous_was_wrong", re: /我(之前|上次|刚才)(说|以为|提到)的.*?(错|不对|有误|不准)/u },
  { name: "zh.actually_should_be", re: /(实际上|其实)(应该|是)/u },
  { name: "zh.scratch_that", re: /(忽略|算了)(我|刚才)(说的|的话)/u },
  // English
  { name: "en.i_was_wrong", re: /\bI was wrong about\b/i },
  { name: "en.correction_label", re: /\bcorrection:\s/i },
  { name: "en.scratch_that", re: /\bscratch that\b/i },
  { name: "en.actually", re: /\bactually,?\s+(I|it|that)\b/i },
];

export interface CorrectionEvent {
  id: number;
  sessionId: string | null;
  retractedText: string;
  correctedText: string | null;
  relatedFactIds: string[];
  patternMatched: string | null;
  createdAt: string;
  processedAt: string | null;
}

/**
 * Scan a text turn for correction patterns. Returns the matched pattern +
 * the truncated full-turn context, or null if no match.
 *
 * IMPORTANT (debate 006 Pre-Week-2 Fix 3): the caller is responsible for
 * passing the FULL turn text -- typically reconstructed by reading
 * `observations.raw_bytes` for a `source.kind = 'claude-code'` row and
 * parsing the hook payload JSON to extract `turnText`. `match[0]` is an
 * idiomatic phrase ("I was wrong about"), NOT a subject keyword, so we
 * store the broader context in `retractedText` to give `findRelatedFacts`
 * meaningful tokens to work with.
 *
 * Capped at 500 chars to prevent a paste of a 10KB log (that happens to
 * contain "actually, I..." deep inside) from flooding `correction_events`.
 */
export const MAX_RETRACTED_TEXT_CHARS = 500;

export function detectCorrection(turnText: string): {
  patternName: string;
  retractedText: string;
  correctedText: string | null;
} | null {
  for (const { name, re } of CORRECTION_PATTERNS) {
    const match = turnText.match(re);
    if (match) {
      // P0-5 stores the turn text (truncated) rather than match[0], so
      // downstream findRelatedFacts has real content to tokenize against.
      const retracted = turnText.length > MAX_RETRACTED_TEXT_CHARS
        ? turnText.slice(0, MAX_RETRACTED_TEXT_CHARS)
        : turnText;
      return {
        patternName: name,
        retractedText: retracted,
        correctedText: null, // Deferred to Week 5+ per debate 012 (zero consumers today; P0-5 surface-only contract permits null; see docs/ROADMAP.md Week 5+ backlog).
      };
    }
  }
  return null;
}

/**
 * Insert a `correction_events` row plus a linked `health_signals` row in a
 * single transaction.
 *
 * Transactional contract (locked in debate 006 Pre-Week-2 Fix 5):
 *   1. INSERT correction_events (processed_at = NULL)
 *   2. INSERT health_signals (kind='correction_candidate',
 *                             target_ref='correction_event:<id>',
 *                             severity='info')
 *   3. UPDATE correction_events SET processed_at = datetime('now') for the id
 *   4. COMMIT
 * Failure anywhere rolls the whole thing back. This guarantees
 * "one correction_event <=> at most one health_signal" and makes the
 * `idx_correction_events_unprocessed` index meaningful (rows with
 * processed_at IS NULL represent scanner-in-flight or scanner-crashed work).
 *
 * Called by `scanObservationForCorrection` in the post-drain path (NOT by
 * reflect). The old JSDoc line "called by daemon scheduler after drain"
 * meant post-drain, not a separate scheduler -- clarified here.
 */
export function recordCorrection(
  db: Database,
  args: {
    sessionId: string | null;
    retractedText: string;
    correctedText: string | null;
    patternName: string;
    relatedFactIds?: string[];
  }
): { id: number } {
  const relatedJson = JSON.stringify(args.relatedFactIds ?? []);
  let insertedId = 0;
  const tx = db.transaction(() => {
    // Step 1: INSERT correction_events (processed_at = NULL)
    const res = db.run(
      "INSERT INTO correction_events " +
        "(session_id, retracted_text, corrected_text, related_fact_ids_json, pattern_matched) " +
        "VALUES (?, ?, ?, ?, ?)",
      [
        args.sessionId,
        args.retractedText,
        args.correctedText,
        relatedJson,
        args.patternName,
      ]
    );
    insertedId = Number(res.lastInsertRowid);

    // Step 2: INSERT health_signals linked to the correction_event
    const relatedSummary = args.relatedFactIds && args.relatedFactIds.length > 0
      ? `${args.relatedFactIds.length} related fact(s): ${args.relatedFactIds.slice(0, 3).join(", ")}`
      : "related facts TBD (see P0-1 triage)";
    const preview = args.retractedText.length > 120
      ? args.retractedText.slice(0, 120) + "…"
      : args.retractedText;
    db.run(
      "INSERT INTO health_signals (kind, severity, message, target_ref) VALUES (?, ?, ?, ?)",
      [
        "correction_candidate",
        "info",
        `User may have corrected a prior claim — ${relatedSummary}. Context: ${preview}`,
        `correction_event:${insertedId}`,
      ]
    );

    // Step 3: UPDATE correction_events.processed_at = now
    db.run(
      "UPDATE correction_events SET processed_at = datetime('now') WHERE id = ?",
      [insertedId]
    );
  });
  tx();
  return { id: insertedId };
}

/**
 * Heuristic-only search for facts that may have been corrected. Returns up
 * to `opts.limit` fact_ids, deduped.
 *
 * Signature lock (debate 006 Pre-Week-2 Fix 4):
 *   - `sessionId`: restrict the search to facts created in the same session
 *     (subquery joining `source.kind = 'claude-code'` + matching session_id
 *     in observation metadata). Self-corrections almost always reference
 *     recent same-session facts, so this kills the biggest false-positive
 *     surface.
 *   - `limit`: default 5. Keeps the health_signal message readable.
 *   - `minTokenOverlap`: default 2. After tokenizing `retractedText` and
 *     stop-wording it, a candidate fact must share at least this many
 *     non-stop tokens in its subject OR object to count as related.
 *
 * IMPORTANT (debate 002 §Gemini 1.5 ruling): correction events are SIGNALS,
 * not direct mutations. The returned fact_ids feed into `health_signals`
 * (kind='correction_candidate') for user/agent review. NEVER auto-decrement
 * `facts.confidence` from a regex hit.
 *
 * Week 2 implementation choice (locked in debate 006 Fix 4):
 *   Option A: implement tokenize + stopword + session-filter + overlap scoring
 *   Option B: return `[]` with a TODO and defer the real impl to Week 4 P0-1
 * The implementer MUST pick one at Week 2 start time and document the choice.
 * "Looks-like-it-works" half-implementations (match[0] LIKE %...%) are
 * explicitly disallowed.
 */
export function findRelatedFacts(
  db: Database,
  retractedText: string,
  opts?: {
    sessionId?: string;
    limit?: number;
    minTokenOverlap?: number;
  }
): string[] {
  // Option B (debate 006 Fix 4): return [] with explicit signalling. The
  // recordCorrection path is still useful -- health_signals carries the
  // retractedText preview, and Week 4 P0-1 triage will do the real related-
  // fact inference as part of its signal generation.
  //
  // The implementer deliberately chose B over the tokenize/session impl to
  // keep Week 2 within 3-4 days and to avoid committing to a heuristic
  // shape that triage (P0-1) might need to redo.
  void db;
  void retractedText;
  void opts;
  return [];
}

/**
 * Scan a single observation's raw bytes for a self-correction pattern and,
 * if one is found, call `recordCorrection` to persist the event + linked
 * health_signal.
 *
 * Only runs for `source.kind = 'claude-code'` observations; other sources
 * don't carry turn-structured hook payloads and would produce false matches.
 *
 * Called by the daemon's post-drain hook (see scheduler.ts startDrainLoop).
 * Idempotency: if the observation was already scanned (a correction_event
 * exists with matching session_id + pattern + retracted_text prefix),
 * re-scans are no-ops thanks to the UNIQUE INDEX introduced below at
 * the first live implementation's schema migration (not yet required --
 * today the only source of re-scanning would be manual operator action).
 */
export function scanObservationForCorrection(
  db: Database,
  observeId: string
): { eventId: number | null } {
  // Pull observation row + the source.kind (only claude-code carries hooks)
  const row = db
    .query(
      "SELECT o.raw_bytes, o.source_id, s.kind " +
        "FROM observations o JOIN source s ON s.id = o.source_id " +
        "WHERE o.observe_id = ?"
    )
    .get(observeId) as
    | { raw_bytes: Uint8Array | Buffer | null; source_id: string; kind: string }
    | null;

  if (!row) return { eventId: null };
  if (row.kind !== "claude-code") return { eventId: null };
  if (!row.raw_bytes) return { eventId: null };

  // source_id format: "claude-code:<session_id>:<cwd>"
  const sessionId =
    row.source_id.startsWith("claude-code:")
      ? row.source_id.split(":", 3)[1] ?? null
      : null;

  // raw_bytes is the full hook envelope JSON. bun:sqlite returns BLOB as
  // Uint8Array, not Buffer, so `toString("utf-8")` would silently return the
  // comma-joined byte list instead of decoded text. Use TextDecoder to be
  // safe across runtimes.

exec
/bin/zsh -lc "sed -n '260,520p' packages/compost-core/src/cognitive/triage.ts" in <repo>
 succeeded in 0ms:
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `fact:${row.fact_id}`;
    const msg = `orphan fact (${row.subject}, ${row.predicate}): no links, no access in ${days}d`;
    if (upsertSignal(db, "orphan_delta", "info", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * `stale_wiki`: pages whose last synthesis failed (`stale_at` set by wiki.ts
 * P0-6 fallback) OR whose last synthesis is older than `days`. Both paths
 * emit a single signal per page (upsert dedupes).
 */
export function scanStaleWiki(
  db: Database,
  days: number,
  maxPerKind: number
): number {
  const rows = db
    .query(
      `SELECT path, title, stale_at, last_synthesis_at
       FROM wiki_pages
       WHERE stale_at IS NOT NULL
          OR last_synthesis_at IS NULL
          OR last_synthesis_at < datetime('now', '-' || ? || ' days')
       ORDER BY COALESCE(stale_at, last_synthesis_at, '0000-00-00') ASC
       LIMIT ?`
    )
    .all(days, maxPerKind) as Array<{
    path: string;
    title: string;
    stale_at: string | null;
    last_synthesis_at: string | null;
  }>;

  let inserted = 0;
  for (const row of rows) {
    const targetRef = `wiki:${row.path}`;
    const reason = row.stale_at
      ? `last rebuild failed at ${row.stale_at}`
      : row.last_synthesis_at
        ? `last synthesis at ${row.last_synthesis_at} is older than ${days}d`
        : `never synthesized`;
    const msg = `wiki page "${row.title}" is stale: ${reason}`;
    if (upsertSignal(db, "stale_wiki", "info", msg, targetRef)) {
      inserted++;
    }
  }
  return inserted;
}

/**
 * Read-only triage: scans DB for the 6 signal kinds (debates/011-week4-plan/
 * contract.md), inserts new health_signals rows for findings, returns
 * aggregated report.
 *
 * Hard rule: NEVER auto-executes any remediation. Surface only.
 *
 * Coverage: 5 scanners run here + 1 drain-hook producer = 6 SignalKind total.
 * `correction_candidate` is NOT scanned here -- `correction-detector.
 * scanObservationForCorrection` writes those rows directly during the drain
 * hook (debate 006 Pre-Week-2 Fix 5); `triage()` aggregates them into the
 * report below alongside whatever the 5 scanners wrote this cycle.
 */
export function triage(db: Database, opts: TriageOptions = {}): TriageReport {
  const staleFactDays = opts.staleFactDays ?? 90;
  const contradictionAgeDays = opts.contradictionAgeDays ?? 7;
  const stuckOutboxHours = opts.stuckOutboxHours ?? 24;
  const staleWikiDays = opts.staleWikiDays ?? 30;
  const orphanAccessDays = opts.orphanAccessDays ?? 30;
  const maxPerKind = opts.maxPerKind ?? DEFAULT_MAX_PER_KIND;

  scanStaleFact(db, staleFactDays, maxPerKind);
  scanUnresolvedContradiction(db, contradictionAgeDays, maxPerKind);
  scanStuckOutbox(db, stuckOutboxHours, maxPerKind);
  scanOrphanDelta(db, orphanAccessDays, maxPerKind);
  scanStaleWiki(db, staleWikiDays, maxPerKind);
  // correction_candidate: no scanner -- written by correction-detector directly.

  // Aggregate: read ALL unresolved signals (including ones written by
  // correction-detector outside triage()) so the report reflects the full
  // surface, not just what this run inserted.
  const signals = db
    .query(
      `SELECT id, kind, severity, message, target_ref, created_at,
              resolved_at, resolved_by
       FROM health_signals
       WHERE resolved_at IS NULL
       ORDER BY created_at DESC`
    )
    .all() as HealthSignal[];

  const byKind: Record<SignalKind, number> = {
    stale_fact: 0,
    unresolved_contradiction: 0,
    stuck_outbox: 0,
    orphan_delta: 0,
    stale_wiki: 0,
    correction_candidate: 0,
  };
  for (const s of signals) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  }

  return {
    signals,
    byKind,
    unresolvedTotal: signals.length,
    computedAt: new Date().toISOString(),
  };
}

export interface ListSignalsFilter {
  kind?: SignalKind;
  sinceIso?: string;
  includeResolved?: boolean; // default false (show unresolved only)
  limit?: number; // default 100; CLI caps at 10_000
}

/**
 * Read-only signal listing for CLI (`compost triage list`). Never scans or
 * writes -- pairs with `triage()` which does the write-side work.
 *
 * Normalizes `sinceIso` by dropping fractional seconds + Z since SQLite
 * stores `datetime('now')` at 1s resolution without TZ suffix.
 */
export function listSignals(
  db: Database,
  filter: ListSignalsFilter = {}
): HealthSignal[] {
  const limit = filter.limit ?? 100;
  const since = filter.sinceIso
    ? filter.sinceIso.replace("T", " ").slice(0, 19)
    : null;
  const includeResolved = filter.includeResolved ?? false;

  const rows = db
    .query(
      `SELECT id, kind, severity, message, target_ref, created_at,
              resolved_at, resolved_by
       FROM health_signals
       WHERE (?1 IS NULL OR kind = ?1)
         AND (?2 IS NULL OR created_at >= ?2)
         AND (?3 = 1 OR resolved_at IS NULL)
       ORDER BY created_at DESC
       LIMIT ?4`
    )
    .all(
      filter.kind ?? null,
      since,
      includeResolved ? 1 : 0,
      limit
    ) as HealthSignal[];
  return rows;
}

/**
 * Mark a signal resolved (user or agent action acknowledged it).
 * Returns `true` if a row actually moved from unresolved -> resolved, `false`
 * if the id was missing or already resolved. CLI callers should exit non-0
 * on `false` to avoid reporting fake success (debate 013 F4).
 */
export function resolveSignal(
  db: Database,
  signalId: number,
  resolvedBy: "user" | "agent" | "auto-cleared"
): boolean {
  const result = db.run(
    "UPDATE health_signals " +
      "SET resolved_at = datetime('now'), resolved_by = ? " +
      "WHERE id = ? AND resolved_at IS NULL",
    [resolvedBy, signalId]
  );
  return result.changes > 0;
}

exec
/bin/zsh -lc "sed -n '1,280p' packages/compost-core/src/cognitive/fact-links.ts" in <repo>
exec
/bin/zsh -lc "sed -n '1,260p' packages/compost-core/test/migrator.test.ts" in <repo>
 succeeded in 0ms:
import type { Database } from "bun:sqlite";

/**
 * P0-0 Fact-Links API — Phase 4 Batch D.
 *
 * The `fact_links` table (migration 0011) stores directed edges between facts.
 * This module wraps it with TypeScript primitives and recursive CTE traversal
 * so P0-3 (graph_health), reflect-time contradiction analysis, and future
 * curiosity / answer-synthesis paths can reason about the fact graph.
 *
 * Edge semantics (mirror migration 0011 CHECK):
 *   supports / contradicts / elaborates / derived_from / same_subject
 *
 * Bidirectional convention: each pair stored once with explicit direction in
 * (from_fact_id, to_fact_id). Queries needing undirected adjacency union both
 * directions (see `traverse` and `getNeighbors`).
 */

export const LINK_KINDS = [
  "supports",
  "contradicts",
  "elaborates",
  "derived_from",
  "same_subject",
] as const;

export type LinkKind = (typeof LINK_KINDS)[number];

export type LinkDirection = "out" | "in" | "both";

export interface FactLink {
  link_id: number;
  from_fact_id: string;
  to_fact_id: string;
  kind: LinkKind;
  weight: number;
  created_at: string;
  observed_count: number;
}

export interface AddLinkOpts {
  weight?: number;          // 0.0–1.0, default 1.0
  reinforceIfExists?: boolean; // default true: bumps observed_count + max(weight)
}

/**
 * Insert a link, or reinforce an existing one (default).
 * Returns the link_id of the affected row.
 */
export function addLink(
  db: Database,
  fromFactId: string,
  toFactId: string,
  kind: LinkKind,
  opts: AddLinkOpts = {}
): number {
  if (fromFactId === toFactId) {
    throw new Error(`fact-links: self-loop rejected (${fromFactId})`);
  }
  const weight = opts.weight ?? 1.0;
  if (weight < 0 || weight > 1) {
    throw new Error(`fact-links: weight must be in [0,1] (got ${weight})`);
  }
  const reinforce = opts.reinforceIfExists ?? true;

  if (reinforce) {
    const existing = db
      .query(
        "SELECT link_id, weight, observed_count FROM fact_links " +
          "WHERE from_fact_id = ? AND to_fact_id = ? AND kind = ?"
      )
      .get(fromFactId, toFactId, kind) as
      | { link_id: number; weight: number; observed_count: number }
      | null;
    if (existing) {
      const newWeight = Math.max(existing.weight, weight);
      db.run(
        "UPDATE fact_links SET observed_count = observed_count + 1, weight = ? " +
          "WHERE link_id = ?",
        [newWeight, existing.link_id]
      );
      return existing.link_id;
    }
  }

  const result = db.run(
    "INSERT INTO fact_links (from_fact_id, to_fact_id, kind, weight) VALUES (?, ?, ?, ?)",
    [fromFactId, toFactId, kind, weight]
  );
  return Number(result.lastInsertRowid);
}

/**
 * Get all links touching a fact. Direction:
 *   - "out": fact_id is the source
 *   - "in":  fact_id is the target
 *   - "both": union (default)
 */
export function getLinks(
  db: Database,
  factId: string,
  direction: LinkDirection = "both",
  kinds?: LinkKind[]
): FactLink[] {
  const kindFilter = kinds && kinds.length > 0 ? kinds : null;

  let sql: string;
  const params: unknown[] = [];

  if (direction === "out") {
    sql = "SELECT * FROM fact_links WHERE from_fact_id = ?";
    params.push(factId);
  } else if (direction === "in") {
    sql = "SELECT * FROM fact_links WHERE to_fact_id = ?";
    params.push(factId);
  } else {
    sql =
      "SELECT * FROM fact_links WHERE from_fact_id = ? OR to_fact_id = ?";
    params.push(factId, factId);
  }

  if (kindFilter) {
    const placeholders = kindFilter.map(() => "?").join(",");
    sql += ` AND kind IN (${placeholders})`;
    params.push(...kindFilter);
  }

  sql += " ORDER BY created_at DESC";
  return db.query(sql).all(...params) as FactLink[];
}

/**
 * Get neighbor fact_ids (one-hop, undirected) optionally filtered by kind.
 */
export function getNeighbors(
  db: Database,
  factId: string,
  kinds?: LinkKind[]
): string[] {
  const links = getLinks(db, factId, "both", kinds);
  const out = new Set<string>();
  for (const l of links) {
    out.add(l.from_fact_id === factId ? l.to_fact_id : l.from_fact_id);
  }
  return [...out];
}

/**
 * Remove a specific link. Returns true if a row was deleted.
 */
export function removeLink(
  db: Database,
  fromFactId: string,
  toFactId: string,
  kind: LinkKind
): boolean {
  const result = db.run(
    "DELETE FROM fact_links WHERE from_fact_id = ? AND to_fact_id = ? AND kind = ?",
    [fromFactId, toFactId, kind]
  );
  return result.changes > 0;
}

export interface TraverseOpts {
  direction?: LinkDirection;       // default "both"
  kinds?: LinkKind[];              // default: all kinds
  maxDepth?: number;               // default 3 (prevents runaway in cycles)
  includeArchived?: boolean;       // default false
}

export interface TraverseResult {
  fact_id: string;
  depth: number;                   // 0 = origin fact
}

/**
 * BFS traversal via recursive CTE. Returns reachable fact_ids with their depth.
 *
 * Cycle protection: SQLite recursive CTE doesn't auto-deduplicate; we maintain
 * a visited set in the recursion via NOT IN subquery + explicit depth gate.
 */
export function traverse(
  db: Database,
  startFactId: string,
  opts: TraverseOpts = {}
): TraverseResult[] {
  const direction = opts.direction ?? "both";
  const kinds = opts.kinds && opts.kinds.length > 0 ? opts.kinds : null;
  const maxDepth = opts.maxDepth ?? 3;
  const includeArchived = opts.includeArchived ?? false;

  if (maxDepth < 0) {
    throw new Error(`fact-links: maxDepth must be >= 0 (got ${maxDepth})`);
  }

  // SQLite recursive CTEs cannot self-reference more than once, so we cannot
  // use NOT IN (SELECT FROM visited) for cycle detection. Instead we use a
  // path-string accumulator: each row carries its visited-set as a `,`-joined
  // string, and we filter expansion by string non-membership. This is O(depth)
  // per row but keeps the recursion single-self-reference.
  const kindFilter = kinds
    ? `AND fl.kind IN (${kinds.map((k) => `'${k}'`).join(",")})`
    : "";

  const nextFactIdExpr =
    direction === "out"
      ? "fl.to_fact_id"
      : direction === "in"
        ? "fl.from_fact_id"
        : "CASE WHEN fl.from_fact_id = visited.fact_id THEN fl.to_fact_id ELSE fl.from_fact_id END";

  const joinClause =
    direction === "out"
      ? "JOIN fact_links fl ON fl.from_fact_id = visited.fact_id"
      : direction === "in"
        ? "JOIN fact_links fl ON fl.to_fact_id = visited.fact_id"
        : "JOIN fact_links fl ON (fl.from_fact_id = visited.fact_id OR fl.to_fact_id = visited.fact_id)";

  const archivedFilter = includeArchived
    ? ""
    : "AND fact_id NOT IN (SELECT fact_id FROM facts WHERE archived_at IS NOT NULL)";

  const sql = `
    WITH RECURSIVE visited(fact_id, depth, path) AS (
      SELECT ?, 0, ',' || ? || ','
      UNION ALL
      SELECT
        ${nextFactIdExpr} AS next_id,
        visited.depth + 1,
        visited.path || ${nextFactIdExpr} || ','
      FROM visited
      ${joinClause}
      WHERE 1=1 ${kindFilter}
        AND visited.depth < ?
        AND INSTR(visited.path, ',' || ${nextFactIdExpr} || ',') = 0
    )
    SELECT fact_id, MIN(depth) AS depth
    FROM visited
    WHERE 1=1 ${archivedFilter}
    GROUP BY fact_id
    ORDER BY depth, fact_id
  `;

  return db
    .query(sql)
    .all(startFactId, startFactId, maxDepth) as TraverseResult[];
}

/**
 * Find facts that are "orphans" by graph criteria:
 *   - active (archived_at IS NULL)
 *   - older than `minAgeHours` (avoid flagging brand-new facts)
 *   - have zero links in either direction
 *
 * Used by triage's `orphan_delta` signal generator (P0-1) and by graph_health
 * snapshots (P0-3).
 */
export function findOrphans(
  db: Database,
  minAgeHours: number = 24
): string[] {
  if (minAgeHours < 0) {
    throw new Error(`fact-links: minAgeHours must be >= 0 (got ${minAgeHours})`);
  }
  const sql = `
    SELECT f.fact_id
    FROM facts f
    LEFT JOIN fact_links fl
      ON fl.from_fact_id = f.fact_id OR fl.to_fact_id = f.fact_id
    WHERE f.archived_at IS NULL
      AND f.created_at < datetime('now', ?)
      AND fl.link_id IS NULL
    GROUP BY f.fact_id
    ORDER BY f.created_at
  `;
  const rows = db
    .query(sql)
    .all(`-${minAgeHours} hours`) as Array<{ fact_id: string }>;
  return rows.map((r) => r.fact_id);
}

 succeeded in 0ms:
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations, getMigrationStatus } from "../src/schema/migrator";

describe("migrator", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-test-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("applyMigrations creates tracking table and applies all 13 migrations", () => {
    const result = applyMigrations(db);

    expect(result.applied).toHaveLength(13);
    expect(result.applied.map((m) => m.name)).toEqual([
      "0001_init",
      "0002_debate3_fixes",
      "0003_stateless_decay",
      "0004_probabilistic_ranking",
      "0005_merged_outbox",
      "0006_chunks_and_fts5",
      "0007_phase2_search",
      "0008_phase3_ranking",
      "0009_phase3_contradiction_and_wiki_versions",
      "0010_phase4_myco_integration",
      "0011_fact_links_and_health_fix",
      "0012_correction_signal_kind",
      "0013_wiki_stale_at",
    ]);
    expect(result.errors).toHaveLength(0);
  });

  test("applyMigrations is idempotent - second run applies nothing", () => {
    applyMigrations(db);
    const result = applyMigrations(db);

    expect(result.applied).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("all expected tables exist after migration (+ FTS5 virtual table)", () => {
    applyMigrations(db);

    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_compost_migrations' AND name NOT LIKE 'facts_fts_%' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toEqual([
      "access_log",
      "captured_item",
      "chunks",
      "context",
      "correction_events",        // 0010 P0-5
      "decision_audit",           // 0010 P0-2
      "derivation_run",
      "expected_item",
      "fact_context",
      "fact_links",               // 0011 P0-0
      "facts",
      "facts_fts",
      "graph_health_snapshot",    // 0010 P0-3 (rebuilt in 0011 with DEFAULTs)
      "health_signals",           // 0010 P0-1
      "ingest_queue",
      "observations",
      "observe_outbox",
      "policies",
      "ranking_audit_log",
      "ranking_profile",
      "source",
      "source_context",
      "web_fetch_state",
      "wiki_page_observe",
      "wiki_page_versions",
      "wiki_pages",
    ]);
  });

  test("WAL mode and foreign keys are enabled after migration", () => {
    applyMigrations(db);

    const wal = db.query("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    const fk = db.query("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };

    expect(wal.journal_mode).toBe("wal");
    expect(fk.foreign_keys).toBe(1);
  });

  test("ranking_profile seed data exists", () => {
    applyMigrations(db);

    const row = db
      .query("SELECT profile_id, name, w1_semantic FROM ranking_profile")
      .get() as { profile_id: string; name: string; w1_semantic: number };

    expect(row.profile_id).toBe("rp-phase1-default");
    expect(row.name).toBe("Phase 1 semantic only");
    expect(row.w1_semantic).toBe(1.2);
  });

  test("FK CASCADE: deleting observation cascades to facts, ingest_queue, captured_item", () => {
    applyMigrations(db);

    // Insert test data chain: source -> observation -> facts + ingest_queue + captured_item
    db.run("INSERT INTO source VALUES ('s1','file:///test','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),'hash1','raw1',NULL,NULL,'text/plain','test-adapter',1,'user','idem1','tp-2026-04',NULL)"
    );
    db.run("INSERT INTO ingest_queue(observe_id, source_kind, priority) VALUES ('obs1','local-file',1)");
    db.run("INSERT INTO captured_item VALUES ('s1','ext1',datetime('now'),'obs1')");
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('f1','s','p','o','obs1')"
    );

    // Delete the observation
    db.run("DELETE FROM observations WHERE observe_id = 'obs1'");

    // All should be cascade-deleted
    const queueCount = db.query("SELECT count(*) as cnt FROM ingest_queue").get() as { cnt: number };
    const factCount = db.query("SELECT count(*) as cnt FROM facts").get() as { cnt: number };
    const capturedCount = db.query("SELECT count(*) as cnt FROM captured_item").get() as { cnt: number };

    expect(queueCount.cnt).toBe(0);
    expect(factCount.cnt).toBe(0);
    expect(capturedCount.cnt).toBe(0);
  });

  test("observe_outbox.observe_id ON DELETE SET NULL", () => {
    applyMigrations(db);

    db.run("INSERT INTO source VALUES ('s1','file:///test','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),'hash1','raw1',NULL,NULL,'text/plain','test-adapter',1,'user','idem1','tp-2026-04',NULL)"
    );
    db.run(
      "INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id) VALUES ('test','s1','local-file','file:///test','idem1','user','tp-2026-04','{}',datetime('now'),'obs1')"
    );

    db.run("DELETE FROM observations WHERE observe_id = 'obs1'");

    const row = db.query("SELECT observe_id FROM observe_outbox WHERE seq = 1").get() as {
      observe_id: string | null;
    };
    expect(row.observe_id).toBeNull();
  });

  test("getMigrationStatus returns correct status", () => {
    // Before any migrations
    const before = getMigrationStatus(db);
    expect(before.applied).toHaveLength(0);
    expect(before.pending).toHaveLength(13);

    // After all migrations
    applyMigrations(db);
    const after = getMigrationStatus(db);
    expect(after.applied).toHaveLength(13);
    expect(after.pending).toHaveLength(0);
  });

  test("ingest_queue lease columns exist after 0002", () => {
    applyMigrations(db);

    const cols = db
      .query("PRAGMA table_info(ingest_queue)")
      .all() as { name: string }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("lease_owner");
    expect(colNames).toContain("lease_token");
    expect(colNames).toContain("lease_expires_at");
  });

  test("facts decay columns exist after 0003", () => {
    applyMigrations(db);

    const cols = db.query("PRAGMA table_info(facts)").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("last_reinforced_at_unix_sec");
    expect(colNames).toContain("half_life_seconds");
  });
});

exec
/bin/zsh -lc 'rg -n "bench|benchmark|reflect-1k|reflect-10k|reflect-100k|bun bench|vitest bench" package.json packages -S' in <repo>
exec
/bin/zsh -lc "find packages -maxdepth 4 \\( -type d -name bench -o -type d -name benchmark \\) -print" in <repo>
 succeeded in 0ms:
packages/compost-core/src/query/search.ts:47:const RRF_K = 60; // standard constant; benchmark to tune
packages/compost-core/src/cognitive/fact-links.ts:290: * facts; if benchmarks show otherwise we revisit at P0-3.

 succeeded in 0ms:
exec
/bin/zsh -lc "sed -n '280,420p' packages/compost-core/src/cognitive/fact-links.ts" in <repo>
 succeeded in 0ms:
}

/**
 * Compute connected components over the active-fact graph.
 * Returns a Map<fact_id, component_id>. Component IDs are 0-indexed by
 * traversal order. Active facts with no links are their own singleton
 * component.
 *
 * Implementation: Union-Find in TS (faster than recursive CTE for cluster
 * count and avoids the CTE depth/cycle complexity). Acceptable up to ~1M
 * facts; if benchmarks show otherwise we revisit at P0-3.
 */
export function connectedComponents(db: Database): {
  components: Map<string, number>;
  count: number;
} {
  const facts = db
    .query("SELECT fact_id FROM facts WHERE archived_at IS NULL")
    .all() as Array<{ fact_id: string }>;
  const links = db
    .query("SELECT from_fact_id, to_fact_id FROM fact_links")
    .all() as Array<{ from_fact_id: string; to_fact_id: string }>;

  // Union-Find
  const parent = new Map<string, string>();
  for (const f of facts) parent.set(f.fact_id, f.fact_id);

  function find(x: string): string {
    let root = x;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    // path compression
    let cur = x;
    while (parent.get(cur)! !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const l of links) {
    // Only union if both endpoints are active facts (links to archived
    // facts are tolerated until reflect prunes them)
    if (parent.has(l.from_fact_id) && parent.has(l.to_fact_id)) {
      union(l.from_fact_id, l.to_fact_id);
    }
  }

  // Assign component IDs
  const rootToId = new Map<string, number>();
  const components = new Map<string, number>();
  let nextId = 0;
  for (const f of facts) {
    const root = find(f.fact_id);
    let id = rootToId.get(root);
    if (id === undefined) {
      id = nextId++;
      rootToId.set(root, id);
    }
    components.set(f.fact_id, id);
  }

  return { components, count: nextId };
}

/**
 * Count connected components where every active fact is older than
 * `minAgeDays` (default 90). Used by P0-3 `graph_health_snapshot.stale_cluster_count`.
 *
 * Semantics (locked in debate 006 Pre-Week-2): a cluster is "stale" when
 * ALL of its active facts have `created_at < now - minAgeDays`. A single
 * recent fact in the cluster disqualifies it from the count. Archived
 * facts are ignored (not members of any active component).
 *
 * Stub: Week 2 P0-3 lands the real implementation alongside `takeSnapshot`.
 * Keeping the signature locked here prevents P0-3 from relitigating the
 * API shape under schedule pressure.
 */
export function countStaleClusters(
  db: Database,
  minAgeDays: number = 90
): number {
  if (minAgeDays < 0) {
    throw new Error(`fact-links: minAgeDays must be >= 0 (got ${minAgeDays})`);
  }
  const { components } = connectedComponents(db);
  if (components.size === 0) return 0;

  // Per-component: the youngest active fact determines staleness. If every
  // member is older than the gate, the cluster is stale.
  const cutoffIso = new Date(
    Date.now() - minAgeDays * 86_400_000
  ).toISOString();
  // Convert ISO ("2026-01-15T12:34:56.789Z") to SQLite datetime() text
  // format ("2026-01-15 12:34:56") so comparisons match the stored column.
  const cutoffSqlite = cutoffIso.replace("T", " ").slice(0, 19);

  // Max created_at per component (only active facts, which are what
  // connectedComponents returned).
  const factRows = db
    .query(
      "SELECT fact_id, created_at FROM facts WHERE archived_at IS NULL"
    )
    .all() as Array<{ fact_id: string; created_at: string }>;

  const maxPerComponent = new Map<number, string>();
  for (const { fact_id, created_at } of factRows) {
    const cid = components.get(fact_id);
    if (cid === undefined) continue; // shouldn't happen
    const existing = maxPerComponent.get(cid);
    if (!existing || created_at > existing) {
      maxPerComponent.set(cid, created_at);
    }
  }

  let staleCount = 0;
  for (const maxCreatedAt of maxPerComponent.values()) {
    if (maxCreatedAt < cutoffSqlite) staleCount += 1;
  }
  return staleCount;
}

/**
 * Quick-stats helper used by P0-3 graph_health snapshots and `compost stats`.
 */
export function graphStats(db: Database): {
  totalFacts: number;
  totalLinks: number;
  density: number;        // links / facts (0 if no facts)
  orphanCount: number;
  componentCount: number;
} {
  const totalFactsRow = db
    .query("SELECT COUNT(*) AS c FROM facts WHERE archived_at IS NULL")
    .get() as { c: number };
  const totalLinksRow = db

exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-cli/src/commands/triage.ts" in <repo>
exec
/bin/zsh -lc "sed -n '1,120p' packages/compost-cli/src/commands/doctor.ts" in <repo>
 succeeded in 0ms:
import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Diagnostic and maintenance operations")
    .option("--reconcile", "Count observations vs facts and report delta")
    .option(
      "--measure-hook",
      "Measure cold-start latency of `compost hook session-start` (n=100)"
    )
    .option(
      "--drain-retry",
      "Release quarantined outbox rows back into the drain queue"
    )
    .option("--rebuild <layer>", "Rebuild a derivation layer (e.g. L1)")
    .option("--policy <name>", "Policy name for --rebuild")
    .option(
      "--check-llm",
      "Ping Ollama with a short probe and report latency / model / setup hint"
    )
    .action(async (opts) => {
      if (opts.reconcile) {
        const db = openDb();
        try {
          const obsRow = db
            .query("SELECT COUNT(*) AS c FROM observations")
            .get() as { c: number };
          const factRow = db
            .query("SELECT COUNT(*) AS c FROM facts")
            .get() as { c: number };
          const observations = obsRow.c;
          const facts = factRow.c;
          process.stdout.write(
            JSON.stringify({ observations, facts, delta: observations - facts }) +
              "\n"
          );
        } finally {
          db.close();
        }
        return;
      }

      if (opts.measureHook) {
        // Spec §3b.5: Hook cold-start measurement protocol
        const SHIM_PATH = join(
          import.meta.dir,
          "../../../compost-hook-shim/src/index.ts"
        );
        const dataDir =
          process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;

        // Step 1: Ensure shim exists
        if (!existsSync(SHIM_PATH)) {
          process.stderr.write(
            `error: hook shim not found at ${SHIM_PATH}\n`
          );
          process.exit(2);
        }

        // Ensure data dir + migrations for measurement
        if (!existsSync(dataDir))
          mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        const setupDb = new Database(join(dataDir, "ledger.db"), {
          create: true,
        });
        setupDb.exec("PRAGMA journal_mode=WAL");
        setupDb.exec("PRAGMA foreign_keys=ON");
        applyMigrations(setupDb);
        const { upsertPolicies } = await import(
          "../../../compost-core/src/policies/registry"
        );
        upsertPolicies(setupDb);
        setupDb.close();

        // Step 2: Warm filesystem cache
        for (let i = 0; i < 3; i++) {
          Bun.spawnSync(["cat", SHIM_PATH], { stdout: "pipe" });
        }

        const shimEnv = { ...process.env, COMPOST_DATA_DIR: dataDir };

        function makeEnvelope(id: string) {
          return JSON.stringify({
            hook_event_name: "SessionStart",
            session_id: id,
            cwd: "/tmp/measure",
            timestamp: new Date().toISOString(),
            payload: {},
          });
        }

        // Step 3: 5 warmup samples (discarded)
        for (let i = 0; i < 5; i++) {
          const p = Bun.spawn(
            ["bun", SHIM_PATH, "session-start"],
            {
              stdin: new Blob([makeEnvelope(`warmup-${i}`)]),

 succeeded in 0ms:
import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  triage,
  listSignals,
  resolveSignal,
  type SignalKind,
} from "../../../compost-core/src/cognitive/triage";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

// Debate 011 contract: single source of truth for the 6 kinds lives in
// triage.ts. Mirror here as a Set to validate CLI input before hitting SQL.
const VALID_KINDS = new Set<SignalKind>([
  "stale_fact",
  "unresolved_contradiction",
  "stuck_outbox",
  "orphan_delta",
  "stale_wiki",
  "correction_candidate",
]);

const VALID_RESOLVERS = new Set(["user", "agent"]);

export function registerTriage(program: Command): void {
  const cmd = program
    .command("triage")
    .description("Inspect and manage health_signals (P0-1, surface-only)");

  cmd
    .command("scan")
    .description(
      "Run a triage pass: scan the 6 signal kinds (5 scanners + 1 drain-hook producer), insert new rows, report counts"
    )
    .action(() => {
      const db = openDb();
      try {
        const report = triage(db);
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } finally {
        db.close();
      }
    });

  cmd
    .command("list")
    .description("List health_signals rows (unresolved by default, newest first)")
    .option(
      "--kind <kind>",
      "filter by kind (stale_fact / unresolved_contradiction / stuck_outbox / orphan_delta / stale_wiki / correction_candidate)"
    )
    .option("--since <iso>", "only rows with created_at >= this ISO timestamp")
    .option("--include-resolved", "include already-resolved rows (default: only unresolved)")
    .option("--limit <n>", "max rows (default 100)", "100")
    .action((opts) => {
      if (opts.kind && !VALID_KINDS.has(opts.kind as SignalKind)) {
        process.stderr.write(`error: unknown --kind "${opts.kind}"\n`);
        process.exit(2);
      }
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
        process.stderr.write(
          `error: --limit must be 1..10000 (got ${opts.limit})\n`
        );
        process.exit(2);
      }

      const db = openDb();
      try {
        const rows = listSignals(db, {
          kind: opts.kind as SignalKind | undefined,
          sinceIso: opts.since,
          includeResolved: opts.includeResolved ?? false,
          limit,
        });
        process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
      } finally {
        db.close();
      }
    });

  cmd
    .command("resolve <id>")
    .description("Mark a signal resolved (surface-only: does NOT fix the underlying cause)")
    .option(
      "--by <actor>",
      "actor performing the resolution (user or agent)",
      "user"
    )
    .action((idStr: string, opts) => {
      const id = Number(idStr);
      if (!Number.isInteger(id) || id < 1) {
        process.stderr.write(`error: <id> must be a positive integer (got ${idStr})\n`);
        process.exit(2);
      }
      if (!VALID_RESOLVERS.has(opts.by)) {
        process.stderr.write(`error: --by must be user or agent (got ${opts.by})\n`);
        process.exit(2);
      }

      const db = openDb();
      try {
        const ok = resolveSignal(db, id, opts.by as "user" | "agent");
        if (!ok) {
          process.stderr.write(
            `error: signal ${id} not found or already resolved\n`
          );
          process.exit(1);
        }
        process.stdout.write(`resolved signal ${id} by ${opts.by}\n`);
      } finally {
        db.close();
      }
    });
}

exec
/bin/zsh -lc 'rg -n "open_problems|Curiosity agent|Gap tracker" debates docs packages -S' in <repo>
 succeeded in 0ms:
docs/compost-v2-spec.md:1837:| **Phase 4** (week 9-12) | Active learning | Curiosity agent, gap tracker, SearchPlan generator, w5-w7 ranking factors, autonomous crawl with semantic novelty gate, procedural memory |
docs/ROADMAP.md:177:- `open_problems` table + CLI (consolidates old "Curiosity agent" + "Gap tracker")
docs/ROADMAP.md:194:- ~~Curiosity agent~~ (replaced by `open_problems` + triage signals)
docs/ROADMAP.md:195:- ~~Gap tracker~~ (replaced by `open_problems`)
docs/ROADMAP.md:197:- ~~`crawl_queue`~~ (duplicates `open_problems` + manual `compost add <url>`)
debates/011-week4-plan/rounds/r001_sonnet.md:53:| `open_problems` table (P1) | 新表新 CLI, 最少 1.5 天; 跟 P0-1 triage 用户流重合 80%, 先看 triage 产出再说 |
debates/011-week4-plan/rounds/r001_sonnet.md:82:**不阻断合并 (但记录为 Week 5 首选)**: `open_problems` 设计讨论, `correctedText` 语义抽取, PII redactor 威胁模型, bench harness baseline.
debates/014-roadmap-direction/rounds/r001_sonnet.md:8:4. **open_problems** — 用过 triage 才知道 gap tracker 长什么样, 现在做就是二次发明.
debates/011-week4-plan/rounds/r001_opus.md:75:- **Phase 4 P1** (open_problems / origin_hash / bench / PII): 全部 P1, 与
debates/002-roadmap-gap-audit/rounds/r001_opus.md:67:  8. open_problems (consolidates 旧 curiosity + gap)
debates/013-week4-audit/prompt.md:48:- Phase 4 P1 (open_problems / origin_hash / bench / PII) → Week 5+
debates/014-roadmap-direction/rounds/r001_opus.md:22:4. **open_problems** — 放在最后. 现在 `ask()` 能答, `triage` 能提示,
debates/014-roadmap-direction/rounds/r001_opus.md:23:   `audit` 能追溯. `open_problems` 的价值 (好奇心追踪) 靠用户自己手工记
debates/001-myco-integration/synthesis_v2.md:99:| `open_problems` 表 + CLI | 4/4 P0/P1 | 盲点登记 (≠ backlog); `compost problems add/list/resolve` |
debates/001-myco-integration/synthesis_v2.md:158:- self-correction + open_problems (P1) → 失败 5 (缺口追踪)
debates/001-myco-integration/synthesis_v2.md:168:**Myco 的 identity 文档比代码值钱**. 它的 `identity.md` / `open_problems.md` / `vision_recovery_craft` 三份文档有长期价值 — 读完就能用, 不留 Myco 代码 / MCP / YAML. 让 Compost 被这五个失败模式教育过后, 留下 schema 和 view 就够了.
debates/001-myco-integration/synthesis_v2.md:270:| open_problems | P1 | P0 候补 | P1 | P0 | **P1** (2P0/2P1) |
debates/014-roadmap-direction/rounds/r001_gemini.md:10:4.  **open_problems 表 + CLI**: **最低优先级**。这属于“好用的功能”而非“必要的基础设施”。在系统性能和安全性未得到量化保证前，不应继续扩张 schema 复杂度。
debates/011-week4-plan/contract.md:68:- `open_problems` / `origin_hash` / bench / PII redactor (Phase 4 P1)
debates/002-roadmap-gap-audit/rounds/r002_opus.md:66:- **保留 P1**: open_problems, compression_pressure, shareable export, inlet provenance opt-in (4 项)
debates/014-roadmap-direction/rounds/r001_codex.md:9:`open_problems` 暂缓，两周真实 dogfood 后再决定是否值得升成一等数据结构。
debates/011-week4-plan/prompt.md:31:- `open_problems` table + CLI (curiosity/gap replacement)
debates/002-roadmap-gap-audit/rounds/r001_codex.md:19:- `crawl_queue`｜P1 → Reject｜在 first-party 原则下只是“待办表”；替代: `open_problems` + 手动 `compost add <url>`
debates/001-myco-integration/rounds/r001_opus.md:30:### 2. Open problems register (`docs/open_problems.md` 风格)
debates/001-myco-integration/rounds/r001_opus.md:31:- **Myco 源**: `docs/open_problems.md` 整份. 关键: "诚实登记册 — 结构性 blind spots, 不是 feature backlog"
debates/001-myco-integration/rounds/r001_opus.md:32:- **Compost 落地点**: 新表 `open_problems(id, title, description, entry_criteria, exit_criteria, confidence_floor, status, created_at)` + CLI `compost problems list/add/resolve`
debates/014-roadmap-direction/prompt.md:25:- `open_problems` 表 + CLI (好奇心追踪 / gap tracker 合并)
debates/002-roadmap-gap-audit/synthesis.md:65:- **理由**: first-party 原则下是 open_problems 的重复 + 手动 `compost add <url>`
debates/002-roadmap-gap-audit/synthesis.md:120:| `open_problems` 表 + CLI | 原 Batch D P1, 保留 |
debates/002-roadmap-gap-audit/synthesis.md:145:| `crawl_queue` (P1) | first-party 原则下重复, 用 open_problems + 手动 add |
debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:43:2. `crawl_queue` (P1 → Reject): Codex 明确 Reject, first-party 原则下这是 open_problems 的重复.
debates/011-week4-plan/synthesis.md:72:| Phase 4 P1 (open_problems / origin_hash / bench / PII) 4 项 | 非 Week 4 路径依赖; scope creep |
debates/014-roadmap-direction/synthesis.md:13:| 4 | origin_hash | open_problems | open_problems | open_problems | `open_problems` 待 dogfood 后决定 |
debates/014-roadmap-direction/synthesis.md:17:- **`open_problems` + `origin_hash`** 全部 ≥ 第 4 位 — **不做**, 等 dogfood
debates/014-roadmap-direction/synthesis.md:106:- **`open_problems` / `origin_hash`** → dogfood 后决定是否仍要做
debates/001-myco-integration/rounds/r002_codex.md:32:| open_problems | P1 | 记录未知 |
debates/002-roadmap-gap-audit/context.md:30:**P1 (after P0)**: open_problems, compression_pressure, shareable export, crawl_queue, inlet provenance, four-layer dashboard
debates/001-myco-integration/rounds/r002_opus.md:69:| open_problems 表 | **P1** | 诚实盲点登记, S 成本 |
debates/001-myco-integration/context.md:44:- Curiosity agent + gap tracker
debates/001-myco-integration/rounds/r001_codex.md:4:3. 结构退化｜源 docs/open_problems.md:222-269｜落 reflect.ts+graph_snap｜法 CTE快照｜M｜代 看不到碎片化｜险 新fact误报  
debates/017-compost-next-steps/rounds/r001_sonnet.md:28:**立场: PII > bench > open_problems > origin_hash. bench 不应该排第三.**
debates/017-compost-next-steps/rounds/r001_sonnet.md:32:- `open_problems` 表: migration SQL 40 LoC + CLI 子命令 80 LoC + tests 100 LoC = 220 LoC
debates/017-compost-next-steps/rounds/r001_sonnet.md:37:- `open_problems` 依赖 `origin_hash` (gap 记录需要指向 source observation, 否则 provenance 断链)
debates/017-compost-next-steps/rounds/r001_sonnet.md:40:因此真正的顺序是: **PII -> bench -> origin_hash -> open_problems**. ROADMAP 里的顺序错了.
debates/017-compost-next-steps/rounds/r001_sonnet.md:74:**Session 3: origin_hash + method (+ open_problems 设计)**
debates/017-compost-next-steps/rounds/r001_sonnet.md:77:- `open_problems` 仅做 schema + 空 CLI stub (不实现 query 逻辑) -- 留给 Session 4
debates/017-compost-next-steps/rounds/r001_sonnet.md:78:- 理由: origin_hash 是 open_problems provenance 的前置条件, 先落地 schema
debates/001-myco-integration/rounds/r002_gemini.md:31:**撤回**: 撤回我 R1 的被动 Gap Tracker 建议，支持 Opus 的 `open_problems` 表设计，用于追踪系统性认知空洞。
debates/001-myco-integration/synthesis.md:123:| `open_problems` 表 + CLI | Opus R2 P1 / Sonnet I-1 支持 | 诚实盲点登记 (≠backlog), 成本 S |
debates/001-myco-integration/synthesis.md:166:- self-correction capture + open_problems (P1) → 失败模式 5 (缺口追踪)
debates/001-myco-integration/synthesis.md:170:**更深一层, Myco 给我们的最大礼物不是代码, 是语言**: 它把"结构退化 / 审计链 / 缺口登记 / 压缩教条"这些模糊直觉明确命名. 这些概念读完就能用, 不需要借它的工程外壳. Compost 读完 Myco 的 identity.md / open_problems.md / vision_recovery_craft 之后, 可以把那几份文档永久归档 (不留 Myco MCP, 不留 YAML lint, 不留单文件巨型), 只保留被这五个失败模式教育过的 schema 和 view.
debates/001-myco-integration/state.json:22:    "sonnet": ["self-correction P2→P1", "open_problems P1→P0 候补"],
debates/017-compost-next-steps/rounds/r001_gemini.md:10:3.  **Phase 4 P1 排序：** 建议调整为 **Bench > PII > origin_hash > open_problems**。Bench 是“为什么要用”的理由（性能/压缩率），PII 是“敢不敢用”的前提。
debates/017-compost-next-steps/context.md:24:2. open_problems 表+CLI (替 Curiosity/Gap tracker)
debates/017-compost-next-steps/context.md:38:3. Phase 4 P1 4 项内部排序: PII > bench > open_problems > origin_hash 对吗? bench 是不是应该先 (没 bench 不敢跑大数据)?
debates/017-compost-next-steps/rounds/r001_codex.md:29:- open_problems 表的 DDL 细节 (如何和现有 health_signals/correction_events 不重叠)?
debates/017-compost-next-steps/rounds/r001_codex.md:62:2. open_problems 表+CLI (替 Curiosity/Gap tracker)
debates/017-compost-next-steps/rounds/r001_codex.md:76:3. Phase 4 P1 4 项内部排序: PII > bench > open_problems > origin_hash 对吗? bench 是不是应该先 (没 bench 不敢跑大数据)?
debates/017-compost-next-steps/rounds/r001_codex.md:98:/bin/zsh -lc 'rg -n "observations|fact_links|wiki_pages|transform_policy|open_problems|health_signals|correction_events|origin_hash|method|compost_cache|cache-provider|reflect-1k|reflect-10k|reflect-100k|bench" -S .' in <repo>
debates/017-compost-next-steps/rounds/r001_codex.md:531:./docs/ROADMAP.md:177:- `open_problems` table + CLI (consolidates old "Curiosity agent" + "Gap tracker")
debates/017-compost-next-steps/rounds/r001_codex.md:535:./docs/ROADMAP.md:194:- ~~Curiosity agent~~ (replaced by `open_problems` + triage signals)
debates/017-compost-next-steps/rounds/r001_codex.md:536:./docs/ROADMAP.md:195:- ~~Gap tracker~~ (replaced by `open_problems`)
debates/017-compost-next-steps/rounds/r001_codex.md:537:./docs/ROADMAP.md:197:- ~~`crawl_queue`~~ (duplicates `open_problems` + manual `compost add <url>`)
debates/017-compost-next-steps/rounds/r001_codex.md:604:./debates/017-compost-next-steps/rounds/r001_gemini.md:10:3.  **Phase 4 P1 排序：** 建议调整为 **Bench > PII > origin_hash > open_problems**。Bench 是“为什么要用”的理由（性能/压缩率），PII 是“敢不敢用”的前提。
debates/017-compost-next-steps/rounds/r001_codex.md:616:./debates/017-compost-next-steps/rounds/r001_codex.md:29:- open_problems 表的 DDL 细节 (如何和现有 health_signals/correction_events 不重叠)?
debates/017-compost-next-steps/rounds/r001_codex.md:619:./debates/017-compost-next-steps/context.md:24:2. open_problems 表+CLI (替 Curiosity/Gap tracker)
debates/017-compost-next-steps/rounds/r001_codex.md:625:./debates/017-compost-next-steps/context.md:38:3. Phase 4 P1 4 项内部排序: PII > bench > open_problems > origin_hash 对吗? bench 是不是应该先 (没 bench 不敢跑大数据)?
debates/017-compost-next-steps/rounds/r001_codex.md:636:./debates/011-week4-plan/rounds/r001_sonnet.md:53:| `open_problems` table (P1) | 新表新 CLI, 最少 1.5 天; 跟 P0-1 triage 用户流重合 80%, 先看 triage 产出再说 |
debates/017-compost-next-steps/rounds/r001_codex.md:639:./debates/011-week4-plan/rounds/r001_sonnet.md:82:**不阻断合并 (但记录为 Week 5 首选)**: `open_problems` 设计讨论, `correctedText` 语义抽取, PII redactor 威胁模型, bench harness baseline.
debates/017-compost-next-steps/rounds/r001_codex.md:649:./debates/011-week4-plan/synthesis.md:72:| Phase 4 P1 (open_problems / origin_hash / bench / PII) 4 项 | 非 Week 4 路径依赖; scope creep |
debates/017-compost-next-steps/rounds/r001_codex.md:682:./debates/011-week4-plan/rounds/r001_opus.md:75:- **Phase 4 P1** (open_problems / origin_hash / bench / PII): 全部 P1, 与
debates/017-compost-next-steps/rounds/r001_codex.md:692:./debates/011-week4-plan/contract.md:68:- `open_problems` / `origin_hash` / bench / PII redactor (Phase 4 P1)
debates/017-compost-next-steps/rounds/r001_codex.md:696:./debates/011-week4-plan/prompt.md:31:- `open_problems` table + CLI (curiosity/gap replacement)
debates/017-compost-next-steps/rounds/r001_codex.md:738:./debates/002-roadmap-gap-audit/rounds/r001_opus.md:67:  8. open_problems (consolidates 旧 curiosity + gap)
debates/017-compost-next-steps/rounds/r001_codex.md:775:./debates/014-roadmap-direction/rounds/r001_sonnet.md:8:4. **open_problems** — 用过 triage 才知道 gap tracker 长什么样, 现在做就是二次发明.
debates/017-compost-next-steps/rounds/r001_codex.md:792:./debates/013-week4-audit/prompt.md:48:- Phase 4 P1 (open_problems / origin_hash / bench / PII) → Week 5+
debates/017-compost-next-steps/rounds/r001_codex.md:855:./debates/002-roadmap-gap-audit/rounds/r002_opus.md:66:- **保留 P1**: open_problems, compression_pressure, shareable export, inlet provenance opt-in (4 项)
debates/017-compost-next-steps/rounds/r001_codex.md:865:./debates/014-roadmap-direction/rounds/r001_opus.md:22:4. **open_problems** — 放在最后. 现在 `ask()` 能答, `triage` 能提示,
debates/017-compost-next-steps/rounds/r001_codex.md:866:./debates/014-roadmap-direction/rounds/r001_opus.md:23:   `audit` 能追溯. `open_problems` 的价值 (好奇心追踪) 靠用户自己手工记
debates/017-compost-next-steps/rounds/r001_codex.md:915:./debates/002-roadmap-gap-audit/rounds/r002_sonnet.md:43:2. `crawl_queue` (P1 → Reject): Codex 明确 Reject, first-party 原则下这是 open_problems 的重复.
debates/017-compost-next-steps/rounds/r001_codex.md:945:./debates/014-roadmap-direction/rounds/r001_gemini.md:10:4.  **open_problems 表 + CLI**: **最低优先级**。这属于“好用的功能”而非“必要的基础设施”。在系统性能和安全性未得到量化保证前，不应继续扩张 schema 复杂度。
debates/017-compost-next-steps/rounds/r001_codex.md:968:./debates/014-roadmap-direction/rounds/r001_codex.md:9:`open_problems` 暂缓，两周真实 dogfood 后再决定是否值得升成一等数据结构。
debates/017-compost-next-steps/rounds/r001_codex.md:974:./debates/001-myco-integration/synthesis_v2.md:99:| `open_problems` 表 + CLI | 4/4 P0/P1 | 盲点登记 (≠ backlog); `compost problems add/list/resolve` |
debates/017-compost-next-steps/rounds/r001_codex.md:975:./debates/001-myco-integration/synthesis_v2.md:158:- self-correction + open_problems (P1) → 失败 5 (缺口追踪)
debates/017-compost-next-steps/rounds/r001_codex.md:976:./debates/001-myco-integration/synthesis_v2.md:168:**Myco 的 identity 文档比代码值钱**. 它的 `identity.md` / `open_problems.md` / `vision_recovery_craft` 三份文档有长期价值 — 读完就能用, 不留 Myco 代码 / MCP / YAML. 让 Compost 被这五个失败模式教育过后, 留下 schema 和 view 就够了.
debates/017-compost-next-steps/rounds/r001_codex.md:979:./debates/001-myco-integration/synthesis_v2.md:270:| open_problems | P1 | P0 候补 | P1 | P0 | **P1** (2P0/2P1) |
debates/017-compost-next-steps/rounds/r001_codex.md:988:./debates/002-roadmap-gap-audit/rounds/r001_codex.md:19:- `crawl_queue`｜P1 → Reject｜在 first-party 原则下只是“待办表”；替代: `open_problems` + 手动 `compost add <url>`
debates/017-compost-next-steps/rounds/r001_codex.md:996:./debates/014-roadmap-direction/prompt.md:25:- `open_problems` 表 + CLI (好奇心追踪 / gap tracker 合并)
debates/017-compost-next-steps/rounds/r001_codex.md:1019:./debates/002-roadmap-gap-audit/synthesis.md:65:- **理由**: first-party 原则下是 open_problems 的重复 + 手动 `compost add <url>`
debates/017-compost-next-steps/rounds/r001_codex.md:1024:./debates/002-roadmap-gap-audit/synthesis.md:120:| `open_problems` 表 + CLI | 原 Batch D P1, 保留 |
debates/017-compost-next-steps/rounds/r001_codex.md:1027:./debates/002-roadmap-gap-audit/synthesis.md:145:| `crawl_queue` (P1) | first-party 原则下重复, 用 open_problems + 手动 add |
debates/017-compost-next-steps/rounds/r001_codex.md:1045:./debates/001-myco-integration/rounds/r001_opus.md:30:### 2. Open problems register (`docs/open_problems.md` 风格)
debates/017-compost-next-steps/rounds/r001_codex.md:1046:./debates/001-myco-integration/rounds/r001_opus.md:31:- **Myco 源**: `docs/open_problems.md` 整份. 关键: "诚实登记册 — 结构性 blind spots, 不是 feature backlog"
debates/017-compost-next-steps/rounds/r001_codex.md:1047:./debates/001-myco-integration/rounds/r001_opus.md:32:- **Compost 落地点**: 新表 `open_problems(id, title, description, entry_criteria, exit_criteria, confidence_floor, status, created_at)` + CLI `compost problems list/add/resolve`
debates/017-compost-next-steps/rounds/r001_codex.md:1048:./debates/001-myco-integration/rounds/r001_codex.md:4:3. 结构退化｜源 docs/open_problems.md:222-269｜落 reflect.ts+graph_snap｜法 CTE快照｜M｜代 看不到碎片化｜险 新fact误报  
debates/017-compost-next-steps/rounds/r001_codex.md:1049:./debates/001-myco-integration/state.json:22:    "sonnet": ["self-correction P2→P1", "open_problems P1→P0 候补"],
debates/017-compost-next-steps/rounds/r001_codex.md:1065:./debates/002-roadmap-gap-audit/context.md:30:**P1 (after P0)**: open_problems, compression_pressure, shareable export, crawl_queue, inlet provenance, four-layer dashboard
debates/017-compost-next-steps/rounds/r001_codex.md:1066:./debates/001-myco-integration/rounds/r002_codex.md:32:| open_problems | P1 | 记录未知 |
debates/017-compost-next-steps/rounds/r001_codex.md:1069:./debates/014-roadmap-direction/synthesis.md:13:| 4 | origin_hash | open_problems | open_problems | open_problems | `open_problems` 待 dogfood 后决定 |
debates/017-compost-next-steps/rounds/r001_codex.md:1070:./debates/014-roadmap-direction/synthesis.md:17:- **`open_problems` + `origin_hash`** 全部 ≥ 第 4 位 — **不做**, 等 dogfood
debates/017-compost-next-steps/rounds/r001_codex.md:1073:./debates/014-roadmap-direction/synthesis.md:106:- **`open_problems` / `origin_hash`** → dogfood 后决定是否仍要做
debates/017-compost-next-steps/rounds/r001_codex.md:1077:./debates/001-myco-integration/synthesis.md:123:| `open_problems` 表 + CLI | Opus R2 P1 / Sonnet I-1 支持 | 诚实盲点登记 (≠backlog), 成本 S |
debates/017-compost-next-steps/rounds/r001_codex.md:1079:./debates/001-myco-integration/synthesis.md:166:- self-correction capture + open_problems (P1) → 失败模式 5 (缺口追踪)
debates/017-compost-next-steps/rounds/r001_codex.md:1080:./debates/001-myco-integration/synthesis.md:170:**更深一层, Myco 给我们的最大礼物不是代码, 是语言**: 它把"结构退化 / 审计链 / 缺口登记 / 压缩教条"这些模糊直觉明确命名. 这些概念读完就能用, 不需要借它的工程外壳. Compost 读完 Myco 的 identity.md / open_problems.md / vision_recovery_craft 之后, 可以把那几份文档永久归档 (不留 Myco MCP, 不留 YAML lint, 不留单文件巨型), 只保留被这五个失败模式教育过的 schema 和 view.
debates/017-compost-next-steps/rounds/r001_codex.md:1100:./debates/001-myco-integration/rounds/r002_gemini.md:31:**撤回**: 撤回我 R1 的被动 Gap Tracker 建议，支持 Opus 的 `open_problems` 表设计，用于追踪系统性认知空洞。
debates/017-compost-next-steps/rounds/r001_codex.md:1126:./debates/001-myco-integration/rounds/r002_opus.md:69:| open_problems 表 | **P1** | 诚实盲点登记, S 成本 |
debates/017-compost-next-steps/rounds/r001_codex.md:1364:- `open_problems` table + CLI (consolidates old "Curiosity agent" + "Gap tracker")
debates/017-compost-next-steps/rounds/r001_codex.md:1381:- ~~Curiosity agent~~ (replaced by `open_problems` + triage signals)
debates/017-compost-next-steps/rounds/r001_codex.md:1382:- ~~Gap tracker~~ (replaced by `open_problems`)
debates/017-compost-next-steps/rounds/r001_codex.md:1384:- ~~`crawl_queue`~~ (duplicates `open_problems` + manual `compost add <url>`)
debates/017-compost-next-steps/rounds/r001_codex.md:1437:/bin/zsh -lc 'rg -n "CREATE TABLE observations|CREATE TABLE fact_links|CREATE TABLE wiki_pages|CREATE TABLE health_signals|CREATE TABLE correction_events|open_problems|ALTER TABLE observations|origin_hash|method|transform_policy" packages/compost-core packages/compost-cli packages/compost-daemon docs/ROADMAP.md docs/ARCHITECTURE.md docs/phase0-spec.md -S' in <repo>
debates/017-compost-next-steps/rounds/r001_codex.md:1439:docs/ROADMAP.md:177:- `open_problems` table + CLI (consolidates old "Curiosity agent" + "Gap tracker")
debates/017-compost-next-steps/rounds/r001_codex.md:1441:docs/ROADMAP.md:194:- ~~Curiosity agent~~ (replaced by `open_problems` + triage signals)
debates/017-compost-next-steps/rounds/r001_codex.md:1442:docs/ROADMAP.md:195:- ~~Gap tracker~~ (replaced by `open_problems`)
debates/017-compost-next-steps/rounds/r001_codex.md:1443:docs/ROADMAP.md:197:- ~~`crawl_queue`~~ (duplicates `open_problems` + manual `compost add <url>`)

codex
还差两块：`open_problems` 原始设想和 v3.5 cache-provider 讨论边界。看完就收敛到结论，不再继续挖。
exec
/bin/zsh -lc "sed -n '24,40p' debates/001-myco-integration/rounds/r001_opus.md" in <repo>
exec
/bin/zsh -lc "sed -n '90,110p' debates/001-myco-integration/synthesis_v2.md" in <repo>
 succeeded in 0ms:
- **Compost 落地点**: 新增 `packages/compost-core/src/cognitive/triage.ts` + CLI `compost triage`; 新表 `health_signals(id, kind, severity, message, created_at, resolved_at)`.
- **集成方式**: 只借设计思路 (不抄 hunger 名字, 不抄 execute=true auto-action 的危险模式)
- **成本**: M (2-3 天)
- **不做的代价**: 用户每次开 session 靠记忆查"上次我在想啥", 跟没第二大脑一样
- **风险**: 别做成 25 tools 的巨型. 信号源限 5 个: stale facts / low-density clusters / unresolved contradictions / new raw captures / stale wiki

### 2. Open problems register (`docs/open_problems.md` 风格)
- **Myco 源**: `docs/open_problems.md` 整份. 关键: "诚实登记册 — 结构性 blind spots, 不是 feature backlog"
- **Compost 落地点**: 新表 `open_problems(id, title, description, entry_criteria, exit_criteria, confidence_floor, status, created_at)` + CLI `compost problems list/add/resolve`
- **集成方式**: 重新实现 (表 + CLI, 不是 markdown)
- **成本**: S (半天)
- **不做的代价**: 用户所有"我知道我不知道"的盲点都丢在脑子里, 第二大脑最该管的就是这个
- **风险**: 别做成 backlog tracker (已有 GitHub Issues). 关键是 **confidence_floor**: 低置信度的推论要标记, 高置信度的要关联证据

### 3. Confidence ladder on high-cost writes
- **Myco 源**: `docs/craft_protocol.md` 的 "kernel 0.90 / instance 0.85 / exploration 0.75"
- **Compost 落地点**: `reflect.ts` 的 contradiction arbitration + wiki rebuild 路径; schema 新增 `decision_audit(id, kind, target_id, confidence, rationale, evidence_refs, created_at)`

 succeeded in 0ms:

**注**: 所有 5 项走一个 migration `0010_phase4_myco_integration.sql`, 一个 feature branch.

---

## 最终 P1 清单 (8 项, 满额)

| 项 | 四方投票 | 实现要点 |
|---|---|---|
| `open_problems` 表 + CLI | 4/4 P0/P1 | 盲点登记 (≠ backlog); `compost problems add/list/resolve` |
| Session FTS5 + episode 聚合 | 4/4 P1 | Phase 4 episodic 原计划; session_summary 字段 |
| Compression pressure metric (view) | 4/4 P1 | triage 的信号输入, 不触发 auto-action |
| Cross-project `shareable` tag + export | **仲裁通过** | 见悬案 A |
| `crawl_queue` SQLite | Sonnet/Codex P1 | 持久化 curiosity intent, 手动 trigger |
| Inlet provenance (opt-in) | **仲裁通过** | 见悬案 B |
| Four-layer dashboard (只 A 库存 + C 退化) | 3/4 P1 | 一个 SQL view + `compost stats` CLI |
| tombstone_reason + replaced_by + revival | 3/4 P1 (合并到 P0-4) | 与 P0-4 同 migration, 加字段 |

---

## 最终 P2 清单 (3 项)

exec
/bin/zsh -lc 'rg -n "compost_cache|as-cache-entry|cache-provider|source_hash|Engram|v3.5" debates docs packages -S' in <repo>
 succeeded in 0ms:
debates/018-length-check-threshold/r001_sonnet.md:37:强迫用户把这三类内容拆成 5-10 条小记忆，实际上只是把认知负担从 Engram 转移给用户。用户不会做这件事——他们会退而写 CLAUDE.md 或外部文件，Engram 失去这批最有价值的入口。
debates/018-length-check-threshold/r001_sonnet.md:87:当前 Engram 的 remember() 如果因 CHECK 失败返回 error，AI agent（包括 Claude Code）的默认处理路径是：
debates/018-length-check-threshold/r001_opus.md:13:**不是**，但必须是受控例外。Sonnet 的场景分类到位：session handoff / debate outcome / spec 必须原子读取，拆开就断 context。Compost 的 observation → L2 fact 路径可以容纳这类内容，但 Compost 还没 ingest，强行拆只是把负担推给用户写 CLAUDE.md，失去 Engram 价值。
debates/018-length-check-threshold/r001_opus.md:19:- Engram 已有 `engram lint` 做 kind-specific 质量检查——这是正确位置
debates/018-length-check-threshold/context.md:19:  - 2129: Engram 最终形态 v2 (decision)
debates/018-length-check-threshold/context.md:53:- **是**: 应该拆成多条小记忆，Engram 是便条夹不是 wiki。handoff 属于 Compost session。
debates/018-length-check-threshold/context.md:54:- **否**: 这类记忆本质上就需要整块读取（拆开就失去 context），是 Engram 的合法用例。
debates/018-length-check-threshold/r001_codex.md:7:## Q1 (2000 字依据): 没有看到可信硬依据；从 SQLite/FTS5 官方行为看，FTS5 `bm25` 按 token 长度归一而不是按字符阈值工作，SQLite 行溢出也取决于 page size 与整行字节数而不是 `2000` 这个常数，所以 `2000` 最多只是经验值，不应当被当作不可违背的 schema 常量（https://sqlite.org/fts5.html, https://sqlite.org/fileformat.html）。另，Engram 当前并没有做过 2K vs 4K 的真实召回 benchmark，因此“2K 有明显检索优势”这件事未验证。
debates/018-length-check-threshold/r001_codex.md:9:## Q2 (长记忆是否 anti-pattern): 不是天然 anti-pattern，但它必须是低频、经过整理、需要整块读取的例外；像 session handoff、debate outcome、spec 这类 `decision`/`procedure` 记忆在 Engram 里是合法的，而把原始日志、长聊天、wiki 式段落无限灌进主表才是 anti-pattern。
debates/018-length-check-threshold/r001_codex.md:14:推荐 `全局 4000 字符硬上限 + 应用层 2000 软警告/提示拆分，不引入 archive 表，不做 kind-specific CHECK`。理由是 2K vs 4K 在 Engram 当前规模下没有已验证的召回断崖，而 4K 足以覆盖现有合法长记忆；同时在 SQLite 默认 4KB page 下，table leaf 本地 payload 上限约为 4061B、index 本地 payload 上限约为 1002B，4000 ASCII 字符已接近单页、4000 CJK 字符按 UTF-8 可推到约 12KB，因此 4K 更像“硬顶”而不是鼓励值。需要变更阈值时，直接按 SQLite 官方推荐走 rebuild-table 即可，不要把 archive 双表复杂度永久写进数据模型（https://sqlite.org/fileformat.html, https://sqlite.org/lang_altertable.html）。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:10:**Mental model reasoning**: "图书馆 vs 便条夹"这个比喻会被用户反转——便条夹（Engram）的条目更长、更模糊，图书馆（Compost）的 facts 更短、更精确。用户第一次看到 Compost 返回 "1-5 句话的 fact" 时会困惑：这比我的 Engram guardrail 还短，为什么要多一个系统？这不会导致放弃使用，但会产生持续的心智摩擦，每次都要重新想一遍"这个该存哪里"。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:12:**Trust signal analysis**: Engram 的 `kind` 字段（guardrail/constraint）给用户一个信任锚：这条记忆代表什么类型的承诺。Compost facts 没有等价的显式分类，用户无法快速判断"这是经过验证的事实还是 LLM 综合产物"。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:14:**If MODIFY, concrete alternative**: 在 Compost 的 fact 输出里强制显示 `source_count` 和 `synthesis_level`（L0/L1/L2），让用户一眼知道这条 fact 来自几个原始来源、经过几层 LLM 加工。Engram 不需要改，它的 `origin` 字段已经够用。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:20:**Sonnet position**: v3.5 writeback 会摧毁 Engram 最核心的信任属性。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:22:**Mental model reasoning**: Engram 当前的心智模型极简且强健：FTS5 deterministic，recall 结果 = 你或你的 agent 写进去的原话。引入 Compost writeback 后，用户做 recall 时无法区分"这是我写的 guardrail"还是"这是 Compost 的 LLM 摘要被写进来的 compiled 条目"。即使 origin=compiled 字段存在，99% 的用户不会在每次 recall 时检查 origin 列。一旦用户被一条错误的 compiled 条目坑过，他们会停止信任整个 Engram recall，而不仅仅是 compiled 条目——这是信任系统的雪崩特性。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:24:**Trust signal analysis**: `origin=compiled` 是技术上存在但 UX 上不可见的信号。CLI 默认输出不显著区分 compiled 与 human/agent 条目时，用户无法分辨正确性来源。Engram 的 "zero-LLM" 是一个强信任承诺，破坏它的代价远超缓存收益。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:26:**If REJECT, concrete alternative**: Compost 的 LLM 答案缓存应留在 Compost 内部（Compost 自己的 L0 ledger）。Engram 作为 writeback 目标完全错误。如果要跨系统通信，方向应该反过来：Engram recall_miss 通知 Compost，但 Compost 的结果不得反向写入 Engram。信任边界必须单向。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:34:**Mental model reasoning**: 用户在 Project A 写入的 guardrail（"禁止 iCloud 路径"）在 Project B 会因 path_scope 不匹配被过滤，或者即使出现也让用户困惑（"这条 A 项目的限制为什么出现在 B？"）。真正跨项目通用的经验极少：顶多是编码风格偏好、通用工具坑点。但这些信息用户早就写进 CLAUDE.md 了。Engram 的跨项目价值实际上是 CLAUDE.md 的带过期检查的数据库版本，用户的感知价值远低于宣传。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:58:**Mental model reasoning**: 用户每次"存记忆"都要决策：Engram remember() 还是 Compost observe()？两个 MCP server 同时挂在 Claude Code 里时，agent 也会面临相同困惑，可能随机选择。这不是用户的执行力问题，这是 API 设计问题：两个系统的写入接口语义太接近，没有清晰的调用规则。双 CLI 的认知代价在日常使用中每天发生，不是一次性的。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:60:**Trust signal analysis**: 如果 agent 自动选错了存储目标（应存 Engram 的 guardrail 被存进了 Compost），用户几乎不会发现，直到他去找这条记忆时找不到。故障模式完全不可感知。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:68:1. **静默路由失败**：v3.4/v3.5 的跨系统异步通道失败时（网络、进程未启动、消息丢失），用户完全无感知。没有失败通知，没有重试 UI，用户只会在"怎么这条经验没有被 Compost 学到"时才发现，但此时距离事件已经很久，完全无法 debug。两个系统之间的任何异步通道都必须有可见的失败日志，至少写到 `engram stats` 里。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:70:2. **compiled 条目的半衰期不可见**：Engram 里 origin=compiled 的条目随着时间推移可能已经过时（Compost 重新综合了但 Engram 里的旧缓存还在）。用户没有办法知道一条 compiled 条目是"刚写入的新鲜缓存"还是"6 个月前的陈旧摘要"。需要 compiled 条目强制显示 `cached_at` 和 TTL 过期倒计时。
debates/016-roadmap-revalidation/rounds/r001_sonnet.md:72:3. **proactive recall 在双栈下的身份危机**：session_start hook 目前只触发 Engram proactive。当 Compost 成熟后，用户会期望 session_start 也注入 Compost 的项目概览。但两套 proactive 叠加会超出 token 预算，用户将面临"哪个系统的 proactive 更重要"的无解选择——而这个决策每次 session 开始都要发生。
debates/016-roadmap-revalidation/rounds/r001_opus.md:12:"笔记本 vs 图书馆" 是营销话术，不是架构不变量。10 年维护者看到的是两个 SQLite + 两个 schema + 两套 ranking，他只会问"为什么这条记忆必须在 Engram 不在 Compost"。如果答案依赖"字符数"或"句数"，5 年内会出现大量 200-800 字的中间态记忆，routing 变成猜谜，两边都塞。字节数不是稳定的架构边界，**写入频率 + 读延迟 SLO** 才是。Engram 的真正不变量是"每次 LLM call 前都要读，必须 <50ms 确定性"，Compost 是"按需查，可以 3-10s"。粒度只是这两个 SLO 的副作用，不该当成定义。
debates/016-roadmap-revalidation/rounds/r001_opus.md:15:5 年内，用户和 agent 会开始往 Engram 塞"小段落"（因为"反正 <200 字不算大"），往 Compost 塞"一句话 fact"（因为"反正是库"），两边 schema 慢慢对齐，最后成两个功能 80% 重合的库，差异只在 MCP server 名字。
debates/016-roadmap-revalidation/rounds/r001_opus.md:19:- Engram: 每条记忆必须能在"LLM call 前置注入预算"内被检索和序列化（p95 <50ms，单条 <500 tokens 序列化后）。超限 reject 写入。
debates/016-roadmap-revalidation/rounds/r001_opus.md:21:两边 schema 加 CHECK constraint 强制执行（Engram 加 `length(content) < 2000`，Compost 加 `source_fact_ids IS NOT NULL OR layer = 'L0'`）。10 年后维护者看 schema 就知道边界在哪，不靠文档。
debates/016-roadmap-revalidation/rounds/r001_opus.md:27:**Opus position**: v3.5 Compost→Engram 写回，写入 `origin=compiled` 就安全 —— 是典型的"今天写得清楚，5 年后没人记得"陷阱。信任模型会塌，而且是悄悄塌。
debates/016-roadmap-revalidation/rounds/r001_opus.md:30:"zero-LLM promise" 是 Engram 的**唯一**技术护城河描述（相对 LycheeMem / Letta / GBrain 都在堆 LLM 的世界）。一旦允许 `compiled` 记忆进 Engram 表，3 年内会发生三件事：(1) 有人觉得"compiled 也不错，proactive 推送一下吧"，加一行 flag；(2) ranking 的 `effective_score` 开始区分 origin 权重，逻辑从"确定性排序"变成"信任加权排序"，再无法向用户解释；(3) 新贡献者看到表里已经有 compiled，觉得"再加一个 synthesized origin 也合理"。**origin 字段作为软边界，抵御不了 10 年的熵**。GPT-5.4 "NO background rewriting" 约束已经说了，你现在开的是同一个口子，只是换了名字叫 cache。
debates/016-roadmap-revalidation/rounds/r001_opus.md:32:更致命：用户在 recall 看到结果时，**无法**仅凭 UI 区分"FTS5 命中的 human 原句"和"Compost 合成后 cache 回来的 compiled 条目"。即使 API 分开，CLI 和 MCP 输出混在一起排序，信任信号就丢了。一旦用户被幻觉误导一次，整个 Engram 的"可靠便签"定位就废了。
debates/016-roadmap-revalidation/rounds/r001_opus.md:35:3-5 年：compiled 比例从 5% 涨到 40%（因为自动写回比人类写入快得多），Engram 实质变成 Compost 的热缓存，而不是独立记忆层。那时候回头看"zero-LLM"承诺已是空文。
debates/016-roadmap-revalidation/rounds/r001_opus.md:38:**Compost 的缓存不进 Engram 表**。如果真要缓存 Compost 答案加速，走独立路径：
debates/016-roadmap-revalidation/rounds/r001_opus.md:39:- 新建 `engram_compost_cache` 表（独立 schema，独立 MCP tool `recall_compost_cache`），**不进** `recall()` 的默认结果，不参与 `effective_score` 排序。
debates/016-roadmap-revalidation/rounds/r001_opus.md:41:- Engram 核心表加 CHECK constraint: `origin IN ('human', 'agent')`，schema 层禁止 compiled。`compiled` origin 保留给 `engram compile` 命令的**只读导出**产物，不回写主库。
debates/016-roadmap-revalidation/rounds/r001_opus.md:42:这样 10 年后无论接手者是谁，看 schema 就知道 Engram 主表 100% non-LLM，缓存是独立配件，关掉不影响核心。
debates/016-roadmap-revalidation/rounds/r001_opus.md:48:**Opus position**: 跨项目护城河是真的，但 Engram 当前用 "guardrail/constraint 跨项目" 来论证就是错的。命中率会很低，10 年后看是自欺欺人。真正跨项目的是 **meta-procedure 和 meta-guardrail**（关于"如何工作"而非"这个项目怎么做"）。
debates/016-roadmap-revalidation/rounds/r001_opus.md:68:**Opus position**: v3.4 suggest_ingest 本身功能可以 ship，但用 "Engram recall_miss → Compost ingest" 这条链路做 MVP 是在 10 年维护成本上最贵的选择。
debates/016-roadmap-revalidation/rounds/r001_opus.md:71:Compost 已经有 observe hook + file watch + web fetch 三条入口，都是"源驱动"（有明确的内容源）。Engram recall_miss 是"缺失驱动"（只有一个查询失败的信号，没有内容）。这意味着 Compost 收到 suggest_ingest 后必须**反向去找内容**（查询什么？从哪里找？问谁？），而 recall_miss 的信号极其稀疏，5 年后日志里 90% 的 suggest 会是"查了个不该存在的东西"，剩下 10% 才是真有价值的缺口。边际价值约等于 0，但维护成本是一条跨进程异步链路（outbox + 去重 + 幂等 + TTL），**这是最糟糕的成本结构**。
debates/016-roadmap-revalidation/rounds/r001_opus.md:73:更隐蔽的问题：这条链会让两个系统的时间模型耦合。Engram 的 recall 频率是 "每次 LLM call"，Compost 的 ingest 节奏是"偶发"。用 outbox 异步隔离是对的，但 10 年后 outbox 表会堆积未消费消息、失败重试、格式漂移，是典型的"加时容易减时难"的结构。
debates/016-roadmap-revalidation/rounds/r001_opus.md:81:- 只有在本地日志证明真有价值后，才 ship v3.4。即使 ship，也用**同步 API 调用**（Compost 暴露 HTTP endpoint，Engram 直接 POST，失败就 drop），**不引入 outbox**。异步解耦是架构终态，但不是 MVP 阶段该背的复杂度。
debates/016-roadmap-revalidation/rounds/r001_opus.md:88:**Opus position**: 双栈该保，但不是因为"功能互补"，而是因为**双栈才能保住 Engram 的确定性 SLO 和 Compost 的 LLM 实验自由度**。合并 = 两边都退化。
debates/016-roadmap-revalidation/rounds/r001_opus.md:97:- 2 CI rules: 本来就该分开（Engram 的 zero-LLM 约束和 Compost 的 source_fact_ids 约束本质不同）。
debates/016-roadmap-revalidation/rounds/r001_opus.md:99:真正的 10 年风险不是"双栈累"，是**合并后丧失了"能独立 kill 其中一个"的可选性**。如果 5 年后发现 Compost 的 LLM 多层合成是技术死路（比如 embedding + graph 范式被某个更好方案取代），双栈下可以独立弃掉 Compost 保 Engram；合并栈下要大手术。
debates/016-roadmap-revalidation/rounds/r001_opus.md:102:如果合并，2 年内 Compost 的 LLM 写入路径会污染 Engram 的确定性排序（因为两表同库，join 太方便），SLO 保不住。4 年内用户再无法理解"哪些记忆是 LLM 生成的"。
debates/016-roadmap-revalidation/rounds/r001_opus.md:106:- 两个系统之间**只有一条耦合**（v3.5 writeback），写清楚"Engram 在没有 Compost 时必须 100% 功能可用"（kill Compost 时删掉 `engram_compost_cache` 表即可）。
debates/016-roadmap-revalidation/rounds/r001_opus.md:107:- CI 加一条 rule: Engram 核心代码不得 `import compost_*`，只能通过 MCP/HTTP 接口。
debates/016-roadmap-revalidation/rounds/r001_opus.md:108:- 每年 review 一次"如果明天砍 Compost，Engram 要改多少代码" —— 超过 50 行就是耦合超标，要重构。
debates/016-roadmap-revalidation/rounds/r001_opus.md:114:1. **测试生态的单点失败**：99 个测试全在 pytest 里，全覆盖当前实现，但**没有一条"架构约束测试"** —— 比如"Engram 核心路径不得调用任何 LLM"、"Compost fact 必须有 source_fact_ids"、"跨系统耦合点不超过 1 个"。这类约束写在 CLAUDE.md 和 CONTRIBUTING.md 里 3 年后没人读，必须变成**可执行的 linting/CI 测试**。否则 10 年后维护者看到 99 个 passing tests 却不知道"哪些设计是刻意的、哪些是偶然的"。建议 v3.3 就加 `tests/test_architecture_invariants.py`，用 AST 静态扫描 + schema introspection 把核心约束变成可执行断言。
debates/016-roadmap-revalidation/rounds/r001_opus.md:116:2. **MCP 协议锁定**：当前 MCP 是 2025-2026 年热门，但 10 年窗口里它大概率会被取代（类比 LSP 之前的各种协议）。Engram/Compost 的对外接口 90% 绑在 FastMCP 上，CLI 是薄壳。**MCP 协议淘汰那天，两个系统都要大改**。建议核心 API 层（store.py/compost core）与 MCP server 层彻底解耦，server.py 只做 protocol adapter，核心逻辑必须能被 HTTP / gRPC / 直接 Python import 同等调用。这是 10 年可移植性的最小防线。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:10:**Gemini position**: 粒度描述反直觉——"便条夹"(Engram) 条目 ~200 字符，而"图书馆"(Compost) facts 1-5 句（更短但更深），颠覆了用户对两者的期望。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:12:**Ecosystem reasoning**: Letta/MemGPT 的架构中，core_memory 条目短暂且简洁，archival_memory 条目更长更结构化——这是行业惯例。Engram+Compost 目前翻转了这一模式：working memory 反而更长，deep knowledge 反而更短。mem0 的 embedding 记忆也遵循"工作记忆密集、长期记忆精炼"的原则，Engram 的命名与实际粒度存在认知错位。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:16:**If REJECT, concrete alternative**: 明确重新定义 Compost facts 为"高度提炼的信息密度单元"（强调 dense 而非 small），或将 Engram 典型条目长度收窄至 ≤80 字符以真正符合"便条"定位。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:21:**Gemini position**: `compiled` origin 标签在技术上可区分，但从内容来源角度，LLM 产物进入 Engram 破坏了"零 LLM"的品牌感知，虽然运行机制仍是 zero-LLM。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:23:**Ecosystem reasoning**: Engram 的"零 LLM"是区别于 mem0、ChromaDB-mem 等 embedding-native 竞品的核心差异化点。这些竞品的记忆都是 LLM 产物；Engram 的可信赖性正建立在"FTS5 确定性"之上。一旦用户发现 `compiled` 条目混入，即使有标签，也可能质疑整个系统的确定性。LycheeMem 等轻量方案完全没有这个混淆问题。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:34:**Ecosystem reasoning**: 大多数竞品（Letta、mem0）都是隐式或显式地项目作用域化的——跨项目受控共享如果真能实现是一个差异化点，但前提是不被自身限制条款阻断。当前 Engram 的护城河叙事与 guardrail 设计逻辑互相矛盾：越严格的 guardrail 越项目私有，越私有则越无法跨项目复用。竞品不会有这种自我否定。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:43:**Gemini position**: Engram miss 信号是一个低成本高杠杆的动态反馈环，50 LoC 赋予系统自我学习能力，战略价值超出"第四条输入路径"的表面描述。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:45:**Ecosystem reasoning**: 自适应、自改进的记忆系统是竞争优势所在。mem0 依赖用户显式写入或 LLM 提取，缺少"工作记忆缺口驱动深层知识富化"的闭环。这一 miss 信号机制是 Engram+Compost 双栈相对于单栈竞品的独特架构优势，是 Letta 的 archival_memory 无法自然提供的。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:52:**Gemini position**: Engram（零 LLM，<50ms）与 Compost（LLM 驱动，3-10s）的运算特性差异足以支撑双栈架构，强行合并会在延迟或概念清晰度上两头妥协。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:54:**Ecosystem reasoning**: Letta 的 core_memory+archival_memory 单栈架构表明分层记忆有价值，但 Letta 是为 LLM agent 设计的统一 LLM 运行时，而 Engram 的核心差异化恰恰是"无 LLM 运算"。若 Compost 吸收 Engram，要么 Compost 必须支持零 LLM 快速路径（架构复杂度翻倍），要么 Engram 的 <50ms 保证消失（丧失 proactive recall 的实用性）。mem0 单栈的代价是延迟不可控。
debates/016-roadmap-revalidation/rounds/r001_gemini.md:62:1. **"零 LLM"品牌侵蚀** — `compiled` origin 写回 Engram，即使有标签也会在用户心智中模糊"确定性 FTS5 系统"的定位。mem0 等竞品从不声称零 LLM，因此没有这个品牌风险；Engram 一旦失去这一差异化，对抗 embedding-native 竞品将毫无优势（无语义搜索 + 无 LLM = 纯关键词匹配，用户为何不直接用 grep？）
debates/016-roadmap-revalidation/rounds/r001_gemini.md:66:3. **无语义搜索的长期 recall 质量天花板** — v6 embedding 被永久砍掉，随着记忆库增长（500+条），纯 FTS5 关键词召回的 recall miss rate 将上升。mem0 和 ChromaDB-mem 的语义搜索能召回用户"忘记用什么词描述"的记忆；Engram 只能召回用户"恰好用了相同关键词"的记忆。这是一个随规模线性恶化的竞争劣势。
debates/002-roadmap-gap-audit/context.md:46:5. **更大问题** Long-term north star, 与 Engram 边界, 开源策略, LLM 模型替换风险
debates/017-compost-next-steps/rounds/r001_sonnet.md:47:### 5. 要不要提前做 cache-provider API?
debates/017-compost-next-steps/rounds/r001_sonnet.md:50:Engram v3.5 compost_cache DDL 已定, 但 Compost 侧的 `compost ask --as-cache-entry` 或 `mcp__compost__synthesize` 是什么语义? 现在不知道. 如果等 3-6 个月数据发现 cache miss 模式, 届时加一个 CLI flag 是 1 天的事. 现在加, 是在为一个未知需求做接口合同. 违反 YAGNI.
debates/017-compost-next-steps/rounds/r001_sonnet.md:82:**方案 D (episodic) 和 E (cache-provider API) 本 session 系列不碰.**
debates/016-roadmap-revalidation/rounds/r001_codex.md:5:**Implementation reasoning**: SQLite/FTS5 不关心“200 字”还是“5 句”，它关心的是索引页命中率、查询频率、以及 WAL 下单写锁争用。Engram 要守 `<50ms p95`，靠的是小库 + 高频热页；冷缓存首查和 auto-checkpoint 抖动本来就会把 p99 拉高，边界一旦改成“也可装深层 fact”，只会进一步放大尾延迟。更糟的是 Engram 当前 `recall()` 不是纯读：会更新 `accessed_at/access_count` 并写 `ops_log`，所以每次召回都在抢 writer slot；这和 Compost 的 drain/reflect/wiki worker 负载模型根本不是一回事。
debates/016-roadmap-revalidation/rounds/r001_codex.md:21:- Engram 只接 `working/meta` 的同步召回数据；默认拒绝 `compiled`。
debates/016-roadmap-revalidation/rounds/r001_codex.md:27:**Codex position**: v3.5 把 Compost 编译产物回写进 Engram 主表，会直接击穿 Engram 的 zero-LLM 信任边界。
debates/016-roadmap-revalidation/rounds/r001_codex.md:29:**Implementation reasoning**: Engram 当前只有 `origin` 列，没有数据库级 `CHECK`；`recall()` 也不会过滤 `origin`，FTS5 排序会把 human/agent/compiled 混在同一个 `memories_fts` 里。这样一来，用户看到的是“同一套 deterministic recall”，实际上结果已经混入 LLM 合成物，信号被 FTS 排序掩盖了。再加上 `recall()` 会对命中行做 `_touch()` 和 `ops_log` 写入，compiled 行一旦进主表，既污染信任，又真实参与热路径写锁竞争。
debates/016-roadmap-revalidation/rounds/r001_codex.md:37:CREATE TABLE IF NOT EXISTS compost_cache (
debates/016-roadmap-revalidation/rounds/r001_codex.md:41:  source_hash TEXT NOT NULL,
debates/016-roadmap-revalidation/rounds/r001_codex.md:50:CREATE INDEX IF NOT EXISTS idx_compost_cache_live
debates/016-roadmap-revalidation/rounds/r001_codex.md:51:  ON compost_cache(project, ttl_expires_at)
debates/016-roadmap-revalidation/rounds/r001_codex.md:56:- 不建 `compost_cache_fts`，更不 join 到 `memories_fts`。
debates/016-roadmap-revalidation/rounds/r001_codex.md:57:- 独立 MCP/CLI：`recall_compost_cache` 或输出单独 section。
debates/016-roadmap-revalidation/rounds/r001_codex.md:59:- 失效规则用 `source_hash` 比较；TTL GC 单独跑 `DELETE FROM compost_cache WHERE ttl_expires_at < datetime('now')`。
debates/016-roadmap-revalidation/rounds/r001_codex.md:90:**Implementation reasoning**: miss 信号只带“没搜到什么词”，不带源内容；要让它可用，你至少要做 query 归一化、去重、聚合、重试/隔离、可观测性、TTL/GC。Compost 自己现成 outbox 已经证明了真实成本长什么样：表 DDL、唯一键、drain worker、quarantine、reflect prune、crash-recovery 测试，一个都少不了。再往上叠一个 Engram→Compost outbox，就是两个 SQLite 文件之间的 eventual consistency；SQLite 只能保证单库原子，绝不可能给你跨库“写 Engram 成功 = Compost 一定收到”。
debates/016-roadmap-revalidation/rounds/r001_codex.md:116:**Codex position**: 双栈值得保留；把 Engram 工作记忆并进 Compost 的单栈，会把 SQLite/WAL 的单写锁问题直接推到每次 LLM 调用前。
debates/016-roadmap-revalidation/rounds/r001_codex.md:118:**Implementation reasoning**: SQLite WAL 的基本事实没变：多 reader，单 writer。Engram 当前召回路径会写 `access_count` 和 `ops_log`，Compost 后台又有 outbox drain、ingest、reflect、backup/VACUUM 这类长短不一的写事务；统一到一个 DB，checkpoint 抖动和 writer contention 会直接落在热路径上。两套 DB 的维护成本远小于“一套 DB 扛两种时延目标再加一堆锁编排”的复杂度，尤其当 Compost 还有 LanceDB/LLM side effects 时，更不可能跟 Engram 做真原子统一。
debates/016-roadmap-revalidation/rounds/r001_codex.md:124:1. **Engram 的“读”其实是写**：`recall()` 会 `_touch()` + 写 `ops_log`。这意味着任何“每 turn 都查一次”的路径，在 SQLite 物理层都是 writer；一旦旁边再挂异步回写、GC、checkpoint，尾延迟会立刻恶化。
debates/016-roadmap-revalidation/rounds/r001_codex.md:128:3. **现在谈 `<50ms p95` 还缺最关键的 PRAGMA/测量**：Engram 目前只有 `journal_mode=WAL`，没有 `busy_timeout`、没有 checkpoint 策略、没有 `cache_size` 审计。没有这些，所谓性能预算只是在 warm-cache、无竞争、短 WAL 条件下成立，根本不配指导 roadmap。
debates/017-compost-next-steps/rounds/r001_gemini.md:12:5.  **Cache-provider API：** **不提前做**。等 Engram 侧需求明确再动，防止接口定义不合身导致双向重构。
debates/017-compost-next-steps/context.md:10:- Engram session 已开工 v3.3 (unpin + scope + CHECK + recall_miss_log + invariant tests)
debates/017-compost-next-steps/context.md:11:- Engram↔Compost 协同线 (v3.5 compost_cache) 数据驱动被动触发: 等 Engram 3-6 月 miss log. Compost **现在零动作**.
debates/017-compost-next-steps/context.md:32:### E: 预先做 compost_cache-provider API
debates/017-compost-next-steps/context.md:33:Engram 侧 compost_cache DDL 已定. Compost 需提供 `compost ask --as-cache-entry` 或 `mcp__compost__synthesize`. 风险: 如果数据不需要, 浪费.
debates/017-compost-next-steps/context.md:40:5. Compost 要不要为 v3.5 提前做 cache-provider API?
debates/016-roadmap-revalidation/synthesis.md:14:| Q2 compiled 写回 Engram | REJECT | REJECT | REJECT | MODIFY | **4/4 质疑** |
debates/016-roadmap-revalidation/synthesis.md:26:- Engram 的真正不变量是"LLM call 前置注入预算 <50ms p95"，不是"单条 <200 字"
debates/016-roadmap-revalidation/synthesis.md:30:### C2 compiled origin 绝不能进 Engram 主表（Opus + Sonnet + Codex 三方 REJECT）
debates/016-roadmap-revalidation/synthesis.md:33:- Engram 的"zero-LLM"是**唯一**相对 mem0/Letta/ChromaDB-mem 的技术护城河
debates/016-roadmap-revalidation/synthesis.md:34:- 方案：**独立 `compost_cache` 表** + 独立 MCP tool + 不进 default recall + 不进 memories_fts
debates/016-roadmap-revalidation/synthesis.md:49:- 关键：显式声明"kill Compost 成本 < 50 行 Engram 改动"的 10 年 invariant
debates/016-roadmap-revalidation/synthesis.md:50:- CI 加规则: Engram 核心代码不得 `import compost_*`
debates/016-roadmap-revalidation/synthesis.md:55:- **判决**: 不因此恢复 v6，但留作 v3.5 后的观察指标（recall_miss rate >15% 时重新评估）
debates/016-roadmap-revalidation/synthesis.md:71:I1. **Engram `recall()` 实际是写路径** —— 更新 access_count + ops_log 会抢 writer slot；异步回写/GC/checkpoint 同时进来时尾延迟恶化
debates/016-roadmap-revalidation/synthesis.md:125:- 耦合度断言：Engram → Compost 的 import 数 = 0
debates/016-roadmap-revalidation/synthesis.md:145:原计划的 Engram→Compost suggest_ingest **砍掉**。理由：
debates/016-roadmap-revalidation/synthesis.md:159:## v3.5 — Compost Cache（redesigned, ~120 LoC）
debates/016-roadmap-revalidation/synthesis.md:161:**关键变更**: 不写回 memories 主表，独立 `compost_cache` 表
debates/016-roadmap-revalidation/synthesis.md:165:CREATE TABLE compost_cache (
debates/016-roadmap-revalidation/synthesis.md:169:  source_hash TEXT NOT NULL,
debates/016-roadmap-revalidation/synthesis.md:178:CREATE INDEX idx_compost_cache_live
debates/016-roadmap-revalidation/synthesis.md:179:  ON compost_cache(project, ttl_expires_at)
debates/016-roadmap-revalidation/synthesis.md:184:- 不建 `compost_cache_fts`，不 join 到 `memories_fts`
debates/016-roadmap-revalidation/synthesis.md:185:- 独立 MCP tool: `mcp__engram__recall_compost_cache`
debates/016-roadmap-revalidation/synthesis.md:188:- 用户显式 opt-in: `recall(include_compost_cache=True)`
debates/016-roadmap-revalidation/synthesis.md:192:- source_hash 变化 → 自动 invalidate
debates/016-roadmap-revalidation/synthesis.md:193:- TTL GC daemon: `DELETE FROM compost_cache WHERE ttl_expires_at < datetime('now')`
debates/016-roadmap-revalidation/synthesis.md:206:- Engram 核心代码不得 `import compost_*`
debates/016-roadmap-revalidation/synthesis.md:212:- 每年架构 review: "如果明天砍 Compost，Engram 要改多少代码" ≤50 行
debates/016-roadmap-revalidation/synthesis.md:231:| Engram 总记忆数 | >2000 | 考虑 repository 层换后端 |
debates/016-roadmap-revalidation/synthesis.md:232:| compost_cache 条目数 | >500 | 考虑是否值得做，或回退到 Compost 端缓存 |
debates/016-roadmap-revalidation/synthesis.md:259:Compost 独立：compost 生态位清晰（LLM 合成 + source lineage），承担 Engram 的 LLM 缓存角色需要新 API（不是写回 Engram）。
debates/017-compost-next-steps/rounds/r001_codex.md:20:Topic: Compost (Bun+Python, 4-layer KB, 318 tests, Phase 4 Batch D Week 4 done) 下一步做什么? 5 候选: A=silent / B=PII redactor / C=Phase 4 P1 全 4 项 / D=debate episodic/memory_procedural / E=预先做 v3.5 cache-provider API.
debates/017-compost-next-steps/rounds/r001_codex.md:28:- 预先做 v3.5 cache-provider API (方案 E) 的 schema 风险 (compost_cache DDL 在 Engram 侧, 但 source_hash 计算逻辑归谁? 重复计算 vs 契约稳定性)
debates/017-compost-next-steps/rounds/r001_codex.md:48:- Engram session 已开工 v3.3 (unpin + scope + CHECK + recall_miss_log + invariant tests)
debates/017-compost-next-steps/rounds/r001_codex.md:49:- Engram↔Compost 协同线 (v3.5 compost_cache) 数据驱动被动触发: 等 Engram 3-6 月 miss log. Compost **现在零动作**.
debates/017-compost-next-steps/rounds/r001_codex.md:70:### E: 预先做 compost_cache-provider API
debates/017-compost-next-steps/rounds/r001_codex.md:71:Engram 侧 compost_cache DDL 已定. Compost 需提供 `compost ask --as-cache-entry` 或 `mcp__compost__synthesize`. 风险: 如果数据不需要, 浪费.
debates/017-compost-next-steps/rounds/r001_codex.md:78:5. Compost 要不要为 v3.5 提前做 cache-provider API?
debates/017-compost-next-steps/rounds/r001_codex.md:98:/bin/zsh -lc 'rg -n "observations|fact_links|wiki_pages|transform_policy|open_problems|health_signals|correction_events|origin_hash|method|compost_cache|cache-provider|reflect-1k|reflect-10k|reflect-100k|bench" -S .' in <repo>
debates/017-compost-next-steps/rounds/r001_codex.md:605:./debates/017-compost-next-steps/rounds/r001_gemini.md:12:5.  **Cache-provider API：** **不提前做**。等 Engram 侧需求明确再动，防止接口定义不合身导致双向重构。
debates/017-compost-next-steps/rounds/r001_codex.md:611:./debates/017-compost-next-steps/rounds/r001_codex.md:20:Topic: Compost (Bun+Python, 4-layer KB, 318 tests, Phase 4 Batch D Week 4 done) 下一步做什么? 5 候选: A=silent / B=PII redactor / C=Phase 4 P1 全 4 项 / D=debate episodic/memory_procedural / E=预先做 v3.5 cache-provider API.
debates/017-compost-next-steps/rounds/r001_codex.md:615:./debates/017-compost-next-steps/rounds/r001_codex.md:28:- 预先做 v3.5 cache-provider API (方案 E) 的 schema 风险 (compost_cache DDL 在 Engram 侧, 但 source_hash 计算逻辑归谁? 重复计算 vs 契约稳定性)
debates/017-compost-next-steps/rounds/r001_codex.md:618:./debates/017-compost-next-steps/context.md:11:- Engram↔Compost 协同线 (v3.5 compost_cache) 数据驱动被动触发: 等 Engram 3-6 月 miss log. Compost **现在零动作**.
debates/017-compost-next-steps/rounds/r001_codex.md:622:./debates/017-compost-next-steps/context.md:32:### E: 预先做 compost_cache-provider API
debates/017-compost-next-steps/rounds/r001_codex.md:623:./debates/017-compost-next-steps/context.md:33:Engram 侧 compost_cache DDL 已定. Compost 需提供 `compost ask --as-cache-entry` 或 `mcp__compost__synthesize`. 风险: 如果数据不需要, 浪费.
debates/017-compost-next-steps/rounds/r001_codex.md:626:./debates/017-compost-next-steps/context.md:40:5. Compost 要不要为 v3.5 提前做 cache-provider API?
debates/017-compost-next-steps/rounds/r001_codex.md:694:./debates/018-length-check-threshold/r001_codex.md:7:## Q1 (2000 字依据): 没有看到可信硬依据；从 SQLite/FTS5 官方行为看，FTS5 `bm25` 按 token 长度归一而不是按字符阈值工作，SQLite 行溢出也取决于 page size 与整行字节数而不是 `2000` 这个常数，所以 `2000` 最多只是经验值，不应当被当作不可违背的 schema 常量（https://sqlite.org/fts5.html, https://sqlite.org/fileformat.html）。另，Engram 当前并没有做过 2K vs 4K 的真实召回 benchmark，因此“2K 有明显检索优势”这件事未验证。
debates/017-compost-next-steps/rounds/r001_codex.md:772:./debates/017-execution-checklist/context.md:17:   - 用来决定迁移策略（truncate / 降级到 compost_cache / fail-fast）
debates/017-compost-next-steps/rounds/r001_codex.md:773:./debates/017-execution-checklist/context.md:29:   - compost_cache 表 (DDL 先建空, 数据层 v3.5 再做)
debates/017-compost-next-steps/rounds/r001_codex.md:814:./debates/017-execution-checklist/r001_opus.md:56:3. **Schema DSL 未来扩展性**: 如果今天只写 memories_v2 的 DSL，明天加 compost_cache 就要扩展 DSL。建议 DSL 从 day 1 就支持多表声明，不要写死。
debates/017-compost-next-steps/rounds/r001_codex.md:868:./debates/016-roadmap-revalidation/rounds/r001_opus.md:39:- 新建 `engram_compost_cache` 表（独立 schema，独立 MCP tool `recall_compost_cache`），**不进** `recall()` 的默认结果，不参与 `effective_score` 排序。
debates/017-compost-next-steps/rounds/r001_codex.md:869:./debates/016-roadmap-revalidation/rounds/r001_opus.md:106:- 两个系统之间**只有一条耦合**（v3.5 writeback），写清楚"Engram 在没有 Compost 时必须 100% 功能可用"（kill Compost 时删掉 `engram_compost_cache` 表即可）。
debates/017-compost-next-steps/rounds/r001_codex.md:870:./debates/017-execution-checklist/execution-checklist.md:24:- compiled 行策略：`pinned=0` + 保留 (临时) / 移到 compost_cache / DELETE
debates/017-compost-next-steps/rounds/r001_codex.md:871:./debates/017-execution-checklist/execution-checklist.md:25:- length>2000 行策略：truncate / 移到 compost_cache / DELETE
debates/017-compost-next-steps/rounds/r001_codex.md:872:./debates/017-execution-checklist/execution-checklist.md:96:-- 7. 新增 compost_cache 表（DDL only，数据层 v3.5 再做）
debates/017-compost-next-steps/rounds/r001_codex.md:873:./debates/017-execution-checklist/execution-checklist.md:97:CREATE TABLE IF NOT EXISTS compost_cache (
debates/017-compost-next-steps/rounds/r001_codex.md:874:./debates/017-execution-checklist/execution-checklist.md:124:  - `compost_cache` 表存在 + `origin='compiled'` CHECK
debates/017-compost-next-steps/rounds/r001_codex.md:875:./debates/017-execution-checklist/synthesis.md:57:2. 违规行处理策略已书面选定（truncate / drop / downgrade compost_cache）
debates/017-compost-next-steps/rounds/r001_codex.md:1004:./debates/016-roadmap-revalidation/synthesis.md:34:- 方案：**独立 `compost_cache` 表** + 独立 MCP tool + 不进 default recall + 不进 memories_fts
debates/017-compost-next-steps/rounds/r001_codex.md:1005:./debates/016-roadmap-revalidation/synthesis.md:161:**关键变更**: 不写回 memories 主表，独立 `compost_cache` 表
debates/017-compost-next-steps/rounds/r001_codex.md:1006:./debates/016-roadmap-revalidation/synthesis.md:165:CREATE TABLE compost_cache (
debates/017-compost-next-steps/rounds/r001_codex.md:1007:./debates/016-roadmap-revalidation/synthesis.md:178:CREATE INDEX idx_compost_cache_live
debates/017-compost-next-steps/rounds/r001_codex.md:1008:./debates/016-roadmap-revalidation/synthesis.md:179:  ON compost_cache(project, ttl_expires_at)
debates/017-compost-next-steps/rounds/r001_codex.md:1009:./debates/016-roadmap-revalidation/synthesis.md:184:- 不建 `compost_cache_fts`，不 join 到 `memories_fts`
debates/017-compost-next-steps/rounds/r001_codex.md:1010:./debates/016-roadmap-revalidation/synthesis.md:185:- 独立 MCP tool: `mcp__engram__recall_compost_cache`
debates/017-compost-next-steps/rounds/r001_codex.md:1011:./debates/016-roadmap-revalidation/synthesis.md:188:- 用户显式 opt-in: `recall(include_compost_cache=True)`
debates/017-compost-next-steps/rounds/r001_codex.md:1012:./debates/016-roadmap-revalidation/synthesis.md:193:- TTL GC daemon: `DELETE FROM compost_cache WHERE ttl_expires_at < datetime('now')`
debates/017-compost-next-steps/rounds/r001_codex.md:1013:./debates/016-roadmap-revalidation/synthesis.md:232:| compost_cache 条目数 | >500 | 考虑是否值得做，或回退到 Compost 端缓存 |
debates/017-compost-next-steps/rounds/r001_codex.md:1035:./debates/016-roadmap-revalidation/rounds/r001_codex.md:37:CREATE TABLE IF NOT EXISTS compost_cache (
debates/017-compost-next-steps/rounds/r001_codex.md:1036:./debates/016-roadmap-revalidation/rounds/r001_codex.md:50:CREATE INDEX IF NOT EXISTS idx_compost_cache_live
debates/017-compost-next-steps/rounds/r001_codex.md:1037:./debates/016-roadmap-revalidation/rounds/r001_codex.md:51:  ON compost_cache(project, ttl_expires_at)
debates/017-compost-next-steps/rounds/r001_codex.md:1038:./debates/016-roadmap-revalidation/rounds/r001_codex.md:56:- 不建 `compost_cache_fts`，更不 join 到 `memories_fts`。
debates/017-compost-next-steps/rounds/r001_codex.md:1039:./debates/016-roadmap-revalidation/rounds/r001_codex.md:57:- 独立 MCP/CLI：`recall_compost_cache` 或输出单独 section。
debates/017-compost-next-steps/rounds/r001_codex.md:1040:./debates/016-roadmap-revalidation/rounds/r001_codex.md:59:- 失效规则用 `source_hash` 比较；TTL GC 单独跑 `DELETE FROM compost_cache WHERE ttl_expires_at < datetime('now')`。
debates/017-compost-next-steps/rounds/r001_codex.md:3870:debates/017-compost-next-steps/rounds/r001_codex.md:98:/bin/zsh -lc 'rg -n "observations|fact_links|wiki_pages|transform_policy|open_problems|health_signals|correction_events|origin_hash|method|compost_cache|cache-provider|reflect-1k|reflect-10k|reflect-100k|bench" -S .' in <repo>
debates/017-compost-next-steps/rounds/r001_codex.md:3929:还差两块：`open_problems` 原始设想和 v3.5 cache-provider 讨论边界。看完就收敛到结论，不再继续挖。
debates/016-roadmap-revalidation/context.md:1:# Debate 016: Engram×Compost Roadmap Revalidation
debates/016-roadmap-revalidation/context.md:11:1. Kill Engram v4-v7 (LLM compile / multi-path / embedding / graph → all go to Compost)
debates/016-roadmap-revalidation/context.md:13:3. v3.4: Engram→Compost suggest_ingest (outbox async, signature forbids await, ~50 LoC)
debates/016-roadmap-revalidation/context.md:14:4. v3.5: Compost→Engram async writeback (independent worker + idempotent key + TTL + source_hash invalidate, ~150 LoC)
debates/016-roadmap-revalidation/context.md:31:5. Engram's LLM cache medium (v3.5 new role)
debates/016-roadmap-revalidation/context.md:33:### Engram (notebook / working memory)
debates/016-roadmap-revalidation/context.md:36:- Engram is "便条夹" — reach for it every turn
debates/016-roadmap-revalidation/context.md:43:5. Compost answer materialization cache (v3.5)
debates/016-roadmap-revalidation/context.md:50:"Compost = library, Engram = notepad". But Engram entries ~200 chars vs Compost facts 1-5 sentences.
debates/016-roadmap-revalidation/context.md:51:Compost facts are SMALLER but DEEPER; Engram records are LARGER but SHALLOWER.
debates/016-roadmap-revalidation/context.md:54:### Q2: v3.5 compiled-origin trust risk
debates/016-roadmap-revalidation/context.md:55:Compost writes back to Engram as "LLM cache medium".
debates/016-roadmap-revalidation/context.md:56:Does this break Engram's zero-LLM promise?
debates/016-roadmap-revalidation/context.md:61:"Project A experience → auto-apply to Project B" is Engram's claimed core value.
debates/016-roadmap-revalidation/context.md:66:Engram detects recall_miss → async notifies Compost to ingest.
debates/016-roadmap-revalidation/context.md:68:**What's the marginal value of Engram's miss signal? Would the ~50 LoC be better spent on v3.3 WAL audit?**
debates/016-roadmap-revalidation/context.md:72:**Is the debt higher than the benefit? Should Compost just absorb Engram's working memory role (unified stack)?**
debates/017-execution-checklist/r001_sonnet.md:45:1. **中断后状态不透明（最高风险）**：DDL migration 在 INSERT SELECT 中途被 Ctrl+C，SQLite WAL 保证原子性，但用户看到的是 memories_v2 表为空、原表完整——没有任何提示说"迁移未完成"。下次用户直接跑 Engram，server 会不会静默读旧表还是报错，取决于 db.py 的 init_db() 逻辑是否检测两表共存。这个陷阱在清单里完全不可见。建议：init_db() 检测"memories 存在且 memories_v2 存在但行数为 0"时主动 raise 而非静默降级。
debates/017-execution-checklist/r001_sonnet.md:47:2. **unpin MCP tool 的自动化滥用**：如果 unpin 作为永久 MCP tool 存在，任何调用 Engram MCP 的 agent（包括未来的 Compost agent、CI 脚本）都可以无声地批量 unpin 用户手动标记的高优先级记忆。没有 `--dry-run`，没有"这条 pin 是 human 设的"的保护，没有 audit log。这比 forget 危险：forget 有 status=obsolete 可查，unpin 的损失在正常 recall 时才会被发现（高优先级记忆"消失"在结果排序里）。
debates/001-myco-integration/rounds/r001_opus.md:119:**拒绝**: `src/myco/forage.py` 的 "主动觅食外部知识源". 技术缺陷: (a) 个人大脑是 **first-party** 信息库, 不是爬虫; (b) 爬来的东西 provenance 混乱 (和用户笔记混) 破坏 trust; (c) 已经有 Engram 做全局层了. 第二大脑就该接受 "用户给什么我存什么" 的被动角色.
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:19:**立场: 异步 compile 回写 (方案 B v3.5)，v3.4 只做 suggest_ingest**
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:21:同步 fallback 是把 Compost 的 p95=3-10s 注入到 Engram 的 p95<50ms 调用链里——这直接击穿延迟预算。我见过太多"加个同步降级"最后变成主路径。`packages/compost-core/src/ledger/outbox.ts` 已有 outbox 模式，v3.4 的 suggest_ingest 直接往这里写一条消息就够了，~50 LoC。
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:23:异步回写 (v3.5) 才是正路: Compost 答完之后往 Engram 写 origin=compiled，下次 Engram FTS5 直接命中，零 LLM。
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:31:当前 0 条 compiled 记忆，说明写入管道从未跑通或从未被触发。复活前需确认: Engram DB 的 `kind` 约束是否接受 compiled，以及 TTL/淘汰策略是否已定义。如果这两个都没有，v3.5 上线后会有 compiled 记忆无限积累、FTS5 索引膨胀的问题。预估: 新增 1 个淘汰策略 + 1 个 kind-guard = ~80 LoC + 5 新测试。
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:35:## 4. 双栈能避免 Engram 重建简化版 Compost 吗
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:39:当前 Engram v3.x 没有 `packages/compost-core/src/cognitive/` 下那套东西 (wiki rebuild、reflect、triage)。只要 v4-v7 被砍，且 suggest_ingest 接口是单向的，边界就守住了。
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:41:隐患: 当有人要给 Engram 加"解释为什么这么记"的功能时，L2 reasoning 会从后门溜进来。需要在 Engram repo 的 CONTRIBUTING 里硬写禁止规则，不是软约束。
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:45:## 5. Engram 有独立 LLM 的合法场景吗
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:49:这是真实的运维场景。`packages/compost-daemon/src/main.ts` 的 daemon 如果崩了，Engram 目前直接裸奔。但实现方式不应该是 Engram 内嵌 LLM 调用，而是 Engram 检测到 Compost socket 超时后，降级为"只返回 FTS5 结果 + 标注[degraded]"。不需要 LLM。方案 C (竞争路线) 是重复造轮子，砍。
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:57:unknown kind 写入 = 数据污染，必须在写入路径同步抛错。misrouted kind (比如把 guardrail 写成 fact) 是语义问题，同步拒绝会让 agent 卡死。记录 warn + metrics counter，事后审计。实现: `packages/compost-core/src/policies/registry.ts` 的模式可以参考，Engram 侧加一个 kindValidator，~30 LoC，3 个单元测试。
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:67:| v3.4 | Engram→Compost 单向 suggest_ingest (写 outbox, 不阻塞) | ~50 | 5 |
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:68:| v3.5 | Compost→Engram 异步回写 origin=compiled + TTL 淘汰策略 | ~130 | 12 |
debates/015-compost-engram-roadmap/rounds/r001_sonnet.md:70:**v4-v7 判决: 砍。** LLM compile / embedding / memory graph 全部交给 Compost L2-L3 处理。Engram 守住零 LLM + p95<50ms，这条线不能妥协。
docs/debate4/rounds/r001_claude.md:36:**NEW failure mode nobody named** — the "active forgetting gap": Stateless decay ranks memories lower but never deletes them. Engram's founding insight (from the Compost memory recall I did earlier: "Henry's idea for brain-like associative memory network. Key challenge: forgetting mechanism harder than storage") says forgetting is a first-class cognitive process, not a ranking trick. A memory with `decayed_score = 0.001` still occupies storage, still appears in full-table scans, still shows up in integrity checks. After 5 years of passive ingestion, Compost has 10M rows, 99% of which are effectively invisible but still cost I/O.
debates/017-execution-checklist/r001_opus.md:56:3. **Schema DSL 未来扩展性**: 如果今天只写 memories_v2 的 DSL，明天加 compost_cache 就要扩展 DSL。建议 DSL 从 day 1 就支持多表声明，不要写死。
debates/015-compost-engram-roadmap/rounds/r001_opus.md:8:内容类型会漂移——Engram 里已经有 18 条 `kind=fact`, 和 Compost L2 facts 事实上重叠。但**延迟预算是物理硬约束**: proactive 在每次 LLM 调用前跑, p95 预算 <50ms 就是不能调 LLM, 不是因为内容是"约束"还是"事实"。反之 Compost `ask/query` 不在关键路径, 可以容忍 3-10s LLM synth。
debates/015-compost-engram-roadmap/rounds/r001_opus.md:12:同步 fallback 违反设计公理。p95 从 10ms → 3s = **300 倍劣化**, 用户瞬间感知"卡"。异步让 Engram 永远确定, Compost 后台物化。
debates/015-compost-engram-roadmap/rounds/r001_opus.md:16:50 条里 compiled=0 是 missed opportunity, 不是废弃信号。这恰好是 v3.5 的形态: Compost ask 一次贵, 结果物化成 Engram fact, 后续零 LLM 命中。这是 Engram **第三条护城河**: 低延迟 + MCP 原生 + **LLM 答案缓存介质**。
debates/015-compost-engram-roadmap/rounds/r001_opus.md:20:放任"Engram 可以做 X 因为方便", 3 年后必然长成 mini-Compost。必须把禁令写进 **schema 层**:
debates/015-compost-engram-roadmap/rounds/r001_opus.md:21:- Engram DB 禁 `embedding` 列
debates/015-compost-engram-roadmap/rounds/r001_opus.md:27:### 5. Engram 无独立 LLM 合法场景
debates/015-compost-engram-roadmap/rounds/r001_opus.md:28:Compost 离线就是离线。Engram 不该补位——降级路径应由 Compost circuit-breaker + BM25 fallback 解决 (P0-6 已做了)。**把离线问题跨界转嫁给 Engram 是错解**, 会污染边界。
debates/015-compost-engram-roadmap/rounds/r001_opus.md:43:| v3.3 | recall_miss 日志 + kind 分级 lint | ✅ 先做 lint, 日志为 v3.5 原料 |
debates/015-compost-engram-roadmap/rounds/r001_opus.md:44:| v3.4 | Engram→Compost 单向 `suggest_ingest` (过时条目推给 Compost 重抽) | ✅ 非阻塞 |
debates/015-compost-engram-roadmap/rounds/r001_opus.md:45:| v3.5 | Compost→Engram 异步回写 (origin=compiled + source_fact_ids + auto-invalidate) | ✅ killer feature |
debates/015-compost-engram-roadmap/rounds/r001_opus.md:51:- **compiled 污染**: 如果 Compost 的 fact 有误, compiled 到 Engram 放大错误传播。→ 缓解: compiled 强制带 `source_fact_ids`, Compost 端 fact 变更触发 invalidate。
debates/017-execution-checklist/synthesis.md:57:2. 违规行处理策略已书面选定（truncate / drop / downgrade compost_cache）
debates/001-myco-integration/rounds/r002_opus.md:33:**正确替代**: 降为 P2 观望. 或最简化: 在 fact 表加 `shareable BOOLEAN + export_label TEXT`, 手动 `compost export --shareable` 导出 markdown bundle, 人工迁移. 跨项目同步留给 Engram (本来就是全局层).
debates/001-myco-integration/context.md:13:- **Engram** (全局 MCP, `~/.engram/engram.db`) — 稳定, 保留
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:7:1.  **边界划分**：按**延迟/触发时机**。Engram 是 L1 缓存（P95<50ms），Compost 是主存。Engram 必须保证极高确定性，内容仅限“操作指南”和“高频热点”。
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:8:2.  **v3.4 逻辑**：坚持**异步回写**。不同意同步 fallback，这会引入不确定的 IO 抖动，破坏 Engram 作为高性能 Agent 内核的定位。
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:9:3.  **origin=compiled**：**价值极高**。这是多 Agent 生态中“群体智慧”物化的唯一路径。Compost 负责从海量事实中归纳，Engram 负责固化为直觉。
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:10:4.  **避免重叠**：通过**API 倒置**。Engram 不应感知 Compost 的内部结构，仅通过语义接口请求补充，从而避免在 Engram 中重建索引树。
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:12:6.  **kind-lint 严苛度**：**早期极严**。必须强制用户/Agent 区分“事实”与“指令”，防止 Engram 沦为第二个碎片化事实库。
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:17:*   **v3.4 (Bridge)**: 实现 Engram → Compost 的异步 ingest 建议（非阻塞），标记“需要归约的知识点”。
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:18:*   **v3.5 (L1/L3 Cache)**: 实现 Compost → Engram 的异步回写，将 Compost 多轮推理后的 synthesis 固化为 Engram 记忆。
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:19:*   **v4-v7 判决**：**全砍**。Engram 走向 MemGPT/Letta 的“全能记忆”路径会与 Compost 产生致命内耗，应专注做极致的高性能“过程性记忆”。
debates/015-compost-engram-roadmap/rounds/r001_gemini.md:22:Opus 建议的 v3.4 仅做 suggest_ingest 太过消极。我认为 v3.4 必须确立 **“Compost 是 Engram 的编译器”** 这一关系。Engram 独立性的价值在于其**纯粹性**：作为一个不依赖重型检索也能工作的“条件反射层”，这才是它在多项目复用中区别于 Mem0 等项目的核心竞争力。
debates/017-execution-checklist/context.md:17:   - 用来决定迁移策略（truncate / 降级到 compost_cache / fail-fast）
debates/017-execution-checklist/context.md:29:   - compost_cache 表 (DDL 先建空, 数据层 v3.5 再做)
debates/017-execution-checklist/context.md:38:   - 耦合度: Engram 到 Compost 的 import 数 = 0
debates/015-compost-engram-roadmap/context.md:1:# Debate 015: Compost + Engram 双栈最终发展路线
debates/015-compost-engram-roadmap/context.md:10:- Engram 现状: 50 条记忆 (该项目), 35 agent / 15 human / 0 compiled, 权威 handoff fact #5
debates/015-compost-engram-roadmap/context.md:11:- 已 pinned 决策 #1: Compost=我知道什么, Engram=我该怎么做, 未来 compost.query 与 engram recall 并行
debates/015-compost-engram-roadmap/context.md:12:- 争议起因: 用户发现 Engram v4-v7 roadmap (LLM compile / multi-path recall / embedding / memory graph) 与 Compost L2-L3 + daemon 高度重叠
debates/015-compost-engram-roadmap/context.md:17:Engram 停在 v3.x, 砍掉 v4-v7。v3.4 Engram recall FTS5 miss 时**同步 fallback** 到 compost ask()。
debates/015-compost-engram-roadmap/context.md:21:- 边界按"触发时机/延迟预算"划而非内容类型: Engram proactive p95<50ms 禁 LLM, Compost on-demand p95=3-10s
debates/015-compost-engram-roadmap/context.md:23:- v3.4: Engram→Compost 单向 suggest_ingest (不阻塞 recall)
debates/015-compost-engram-roadmap/context.md:24:- v3.5: Compost→Engram 异步回写 (origin=compiled), 物化 LLM 答案, 常查零 LLM 命中
debates/015-compost-engram-roadmap/context.md:25:- Engram 永远不同步调 LLM
debates/015-compost-engram-roadmap/context.md:28:Engram 坚持独立发展 LLM 能力, 与 Compost 竞争而非互补。
debates/015-compost-engram-roadmap/context.md:34:4. 双栈真能避免 Engram 重建简化版 Compost?
debates/015-compost-engram-roadmap/context.md:35:5. Engram 有独立 LLM 的合法场景吗 (如 Compost 离线降级)?
debates/015-compost-engram-roadmap/context.md:39:每位请 ≤500 字, 给出 6 个判断点的立场+理由+风险, 结尾给 Engram v3.2/v3.3/v3.4/v3.5 的路线表 + 是否砍 v4-v7 的判决。
debates/015-compost-engram-roadmap/rounds/r001_codex.md:18:争议: Compost (local KB, 318 tests, 4 layers) + Engram (cross-project agent memory, zero LLM, FTS5) 路线冲突 — Engram v4-v7 (LLM compile/multi-path recall/embedding/memory graph) 和 Compost 高度重叠.
debates/015-compost-engram-roadmap/rounds/r001_codex.md:24:4. 双栈协同能否避免 Engram 重建 Compost?
debates/015-compost-engram-roadmap/rounds/r001_codex.md:25:5. Engram 有独立 LLM 合法场景? (如 Compost 离线降级)
debates/015-compost-engram-roadmap/rounds/r001_codex.md:29:- SQLite WAL+FTS5 下 Engram 并发/锁争用实际风险
debates/015-compost-engram-roadmap/rounds/r001_codex.md:30:- Compost→Engram 异步回写机制 (订阅 recall_miss?进程模型?)
debates/015-compost-engram-roadmap/rounds/r001_codex.md:35:结尾给 Engram v3.2/v3.3/v3.4/v3.5 路线表 + v4-v7 判决. 敢反驳 Opus (方案 B), A 或 C 更合理就说出来. 直接 stdout 输出, 不要写文件.
debates/015-compost-engram-roadmap/rounds/r001_codex.md:41:# Debate 015: Compost + Engram 双栈最终发展路线
debates/015-compost-engram-roadmap/rounds/r001_codex.md:50:- Engram 现状: 50 条记忆 (该项目), 35 agent / 15 human / 0 compiled, 权威 handoff fact #5
debates/015-compost-engram-roadmap/rounds/r001_codex.md:51:- 已 pinned 决策 #1: Compost=我知道什么, Engram=我该怎么做, 未来 compost.query 与 engram recall 并行
debates/015-compost-engram-roadmap/rounds/r001_codex.md:52:- 争议起因: 用户发现 Engram v4-v7 roadmap (LLM compile / multi-path recall / embedding / memory graph) 与 Compost L2-L3 + daemon 高度重叠
debates/015-compost-engram-roadmap/rounds/r001_codex.md:57:Engram 停在 v3.x, 砍掉 v4-v7。v3.4 Engram recall FTS5 miss 时**同步 fallback** 到 compost ask()。
debates/015-compost-engram-roadmap/rounds/r001_codex.md:61:- 边界按"触发时机/延迟预算"划而非内容类型: Engram proactive p95<50ms 禁 LLM, Compost on-demand p95=3-10s
debates/015-compost-engram-roadmap/rounds/r001_codex.md:63:- v3.4: Engram→Compost 单向 suggest_ingest (不阻塞 recall)
debates/015-compost-engram-roadmap/rounds/r001_codex.md:64:- v3.5: Compost→Engram 异步回写 (origin=compiled), 物化 LLM 答案, 常查零 LLM 命中
debates/015-compost-engram-roadmap/rounds/r001_codex.md:65:- Engram 永远不同步调 LLM
debates/015-compost-engram-roadmap/rounds/r001_codex.md:68:Engram 坚持独立发展 LLM 能力, 与 Compost 竞争而非互补。
debates/015-compost-engram-roadmap/rounds/r001_codex.md:74:4. 双栈真能避免 Engram 重建简化版 Compost?
debates/015-compost-engram-roadmap/rounds/r001_codex.md:75:5. Engram 有独立 LLM 的合法场景吗 (如 Compost 离线降级)?
debates/015-compost-engram-roadmap/rounds/r001_codex.md:79:每位请 ≤500 字, 给出 6 个判断点的立场+理由+风险, 结尾给 Engram v3.2/v3.3/v3.4/v3.5 的路线表 + 是否砍 v4-v7 的判决。
debates/015-compost-engram-roadmap/rounds/r001_codex.md:82:1. 边界: 双轴，主按时机、辅按内容；因 recall 要 p95<50ms，但 constraint/procedure 更适合常驻；险: 只按时机会逼 Engram 偷长成小 Compost。  
debates/015-compost-engram-roadmap/rounds/r001_codex.md:84:3. `origin=compiled` 值得复活，但仅作派生缓存；`query+source_hash+policy_ver` 幂等 upsert，配 TTL+GC；险: 污染、过期。  
debates/015-compost-engram-roadmap/rounds/r001_codex.md:85:4. 双栈能避免重建，前提 Engram 只做 recall/miss log/suggest_ingest，Compost 做抽取/验证/compile；险: Engram 一加总结/推断就重叠。  
debates/015-compost-engram-roadmap/rounds/r001_codex.md:89:路线: v3.2 稳 WAL/FTS 指标；v3.3 上 `recall_miss` 日志+kind-lint；v3.4 由独立 worker 订阅 miss，异步触发 `compost.compile` 回写 compiled；v3.5 上 TTL/GC/命中率与延迟看板。判决: 砍 v4-v7。不同意 Opus 的“纯时机边界”；应采 B 的骨架，但改成“双轴边界+禁止运行时 LLM”。
debates/015-compost-engram-roadmap/rounds/r001_codex.md:92:1. 边界: 双轴，主按时机、辅按内容；因 recall 要 p95<50ms，但 constraint/procedure 更适合常驻；险: 只按时机会逼 Engram 偷长成小 Compost。  
debates/015-compost-engram-roadmap/rounds/r001_codex.md:94:3. `origin=compiled` 值得复活，但仅作派生缓存；`query+source_hash+policy_ver` 幂等 upsert，配 TTL+GC；险: 污染、过期。  
debates/015-compost-engram-roadmap/rounds/r001_codex.md:95:4. 双栈能避免重建，前提 Engram 只做 recall/miss log/suggest_ingest，Compost 做抽取/验证/compile；险: Engram 一加总结/推断就重叠。  
debates/015-compost-engram-roadmap/rounds/r001_codex.md:99:路线: v3.2 稳 WAL/FTS 指标；v3.3 上 `recall_miss` 日志+kind-lint；v3.4 由独立 worker 订阅 miss，异步触发 `compost.compile` 回写 compiled；v3.5 上 TTL/GC/命中率与延迟看板。判决: 砍 v4-v7。不同意 Opus 的“纯时机边界”；应采 B 的骨架，但改成“双轴边界+禁止运行时 LLM”。
debates/017-execution-checklist/execution-checklist.md:24:- compiled 行策略：`pinned=0` + 保留 (临时) / 移到 compost_cache / DELETE
debates/017-execution-checklist/execution-checklist.md:25:- length>2000 行策略：truncate / 移到 compost_cache / DELETE
debates/017-execution-checklist/execution-checklist.md:96:-- 7. 新增 compost_cache 表（DDL only，数据层 v3.5 再做）
debates/017-execution-checklist/execution-checklist.md:97:CREATE TABLE IF NOT EXISTS compost_cache (
debates/017-execution-checklist/execution-checklist.md:101:  source_hash TEXT NOT NULL,
debates/017-execution-checklist/execution-checklist.md:124:  - `compost_cache` 表存在 + `origin='compiled'` CHECK
debates/017-execution-checklist/execution-checklist.md:175:- ❌ v3.4 Engram→Compost suggest_ingest（debate 016 砍掉）
debates/017-execution-checklist/execution-checklist.md:176:- ⏸ v3.5 Compost→Engram 写回实际数据（DDL 已建空表，数据层等 Compost 侧准备好）
debates/015-compost-engram-roadmap/synthesis.md:1:# Final Synthesis: Compost + Engram 双栈最终发展路线
debates/015-compost-engram-roadmap/synthesis.md:15:| 2. v3.4 同步/异步 | 异步 | 异步 | 异步 (v3.4=建议, v3.5=回写) | 异步 | **4/4 异步** |
debates/015-compost-engram-roadmap/synthesis.md:17:| 4. 避免趋同 | API 倒置 | Engram 只 recall+miss+suggest | CONTRIBUTING 硬约束 | schema 级禁令 | **4/4 需硬约束, 采组合拳** |
debates/015-compost-engram-roadmap/synthesis.md:26:纯"按时机"边界存在漏洞: Engram 可以偷偷把内容泛化为"频繁访问的事实", 长期仍会向 Compost 靠拢。Codex 提出**主按时机+辅按内容**: proactive/必跑路径 → Engram (0 LLM), 且内容限定 constraint/procedure/guardrail 这类"操作指南"; fact 可存但不该是主力。这修正了 Opus 方案 B 过于激进的"纯时机"。
debates/015-compost-engram-roadmap/synthesis.md:32:`upsert by (query + source_hash + policy_ver)` — 三元组幂等键能天然解决:
debates/015-compost-engram-roadmap/synthesis.md:37:这是 v3.5 的具体实现锚点, Opus 方案 B 只提了概念, Codex 给了 schema。
debates/015-compost-engram-roadmap/synthesis.md:47:- Opus/Sonnet 反对的是**运行时 LLM 调用** (Engram 进程内 synth)
debates/015-compost-engram-roadmap/synthesis.md:49:共识可以达成: **Engram 核心进程禁 LLM**, 但允许**旁路工具** (如 `engram lint --llm-assist` 这种一次性 CLI), 这不破坏 proactive 关键路径。
debates/015-compost-engram-roadmap/synthesis.md:68:| **v3.4** | Engram→Compost 单向 `suggest_ingest` (outbox 异步) | ~50 | **接口签名层强制 fire-and-forget**; 复用 outbox 模式 |
debates/015-compost-engram-roadmap/synthesis.md:69:| **v3.5** | Compost→Engram 异步回写 (origin=compiled) | ~150 | 幂等键 `(query, source_hash, policy_ver)`; TTL+GC; source 变更自动 invalidate; **独立 worker 进程**避免与 Engram 主路径争锁 |
debates/015-compost-engram-roadmap/synthesis.md:71:| **新增硬约束** | schema 禁 `embedding`/`llm_response` 列; CONTRIBUTING 硬写边界; `suggest_ingest` 返回 void; Engram 核心进程禁 LLM | ~30 | Opus schema + Sonnet CONTRIBUTING + Gemini API 倒置 组合拳 |
debates/015-compost-engram-roadmap/synthesis.md:81:5. Engram 核心不能运行时调 LLM
debates/015-compost-engram-roadmap/synthesis.md:103:- 复用 outbox 写 Engram 过时条目
debates/015-compost-engram-roadmap/synthesis.md:105:**v3.5 (killer feature)**:
debates/015-compost-engram-roadmap/synthesis.md:106:- Compost→Engram 独立 worker
debates/015-compost-engram-roadmap/synthesis.md:110:- Engram schema migration 禁 embedding/llm_response 列

exec
/bin/zsh -lc "sed -n '90,116p' debates/017-execution-checklist/execution-checklist.md" in <repo>
 succeeded in 0ms:
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  hits INTEGER NOT NULL DEFAULT 1,
  sample_query TEXT NOT NULL,
  PRIMARY KEY (query_norm, project)
);

-- 7. 新增 compost_cache 表（DDL only，数据层 v3.5 再做）
CREATE TABLE IF NOT EXISTS compost_cache (
  cache_id TEXT PRIMARY KEY,
  project TEXT,
  prompt_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ttl_expires_at TEXT NOT NULL,
  invalidated_at TEXT,
  origin TEXT NOT NULL DEFAULT 'compiled' CHECK(origin='compiled'),
  UNIQUE(project, prompt_hash)
);

COMMIT;
```

### Step 2 — Invariant Tests 脚手架
位置: `tests/test_architecture_invariants.py`

覆盖：

exec
/bin/zsh -lc "sed -n '1,140p' packages/compost-core/src/schema/0002_debate3_fixes.sql" in <repo>
 succeeded in 0ms:
-- Migration 0002_debate3_fixes.sql
-- Source: compost-v2-spec.md §1.2 (from debate #3)
-- Creates: derivation_run, policies, context, fact_context, source_context, wiki_page_observe
-- Alters: ingest_queue (lease columns)

-- Replace derivations with derivation_run (fixes PK bug for policy-only reruns)
CREATE TABLE derivation_run (
  derivation_id TEXT PRIMARY KEY,                 -- uuid v7
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  context_scope_id TEXT,
  extraction_profile TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','superseded')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  artifact_ref TEXT,
  supersedes_derivation_id TEXT REFERENCES derivation_run(derivation_id),
  error TEXT,
  content_hash TEXT GENERATED ALWAYS AS (
    observe_id || ':' || layer || ':' || transform_policy || ':' ||
    coalesce(model_id,'') || ':' || coalesce(context_scope_id,'') || ':' ||
    coalesce(extraction_profile,'')
  ) STORED
);

CREATE UNIQUE INDEX idx_derivation_run_active
  ON derivation_run(observe_id, layer, transform_policy, model_id,
                    coalesce(context_scope_id,''), coalesce(extraction_profile,''))
  WHERE status IN ('pending','running','succeeded');

CREATE UNIQUE INDEX idx_derivation_run_hash
  ON derivation_run(content_hash) WHERE status = 'succeeded';

-- transform_policy table (populated from TypeScript registry at daemon startup)
CREATE TABLE policies (
  policy_id TEXT PRIMARY KEY,
  supersedes TEXT REFERENCES policies(policy_id),
  effective_from TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  migration_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Context as first-class entity (flat, hierarchical-path-safe IDs)
CREATE TABLE context (
  id TEXT PRIMARY KEY,               -- e.g. 'work', 'work/project-zylo'
  display_name TEXT NOT NULL,
  isolation_level TEXT NOT NULL DEFAULT 'shared'
    CHECK(isolation_level IN ('shared','isolated')),
  trust_floor TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_floor IN ('user','first_party','web')),
  freshness_ttl_sec INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- Replace facts.contexts TEXT[] with join table
CREATE TABLE fact_context (
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  freshness TEXT NOT NULL DEFAULT 'fresh'
    CHECK(freshness IN ('fresh','stale','expired')),
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fact_id, context_id)
);
CREATE INDEX idx_fc_context ON fact_context(context_id);

-- source context join (replaces source.contexts TEXT[])
CREATE TABLE source_context (
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, context_id)
);

-- Replace wiki_pages.contributing_observes TEXT with join
-- NOTE (v2.1): ON DELETE CASCADE on BOTH FKs. Sensory GC needs observe_id cascade;
-- wiki page deletion needs page_path cascade.
CREATE TABLE wiki_page_observe (
  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_path, observe_id)
);
CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);

-- ingest_queue lease columns
ALTER TABLE ingest_queue ADD COLUMN lease_owner TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_token TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_expires_at TEXT;

CREATE INDEX idx_queue_claim
  ON ingest_queue(priority, enqueued_at, lease_expires_at)
  WHERE completed_at IS NULL;

CREATE UNIQUE INDEX idx_queue_active_lease
  ON ingest_queue(lease_token)
  WHERE completed_at IS NULL AND lease_token IS NOT NULL;

exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-core/src/ledger/outbox.ts" in <repo>
 succeeded in 0ms:
import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";

/**
 * OutboxEvent — what writers (hook shim, adapters) pass to appendToOutbox.
 * Maps 1:1 to observe_outbox columns. Spec §1.6.1.
 */
export interface OutboxEvent {
  adapter: string;
  source_id: string;
  source_kind:
    | "local-file"
    | "local-dir"
    | "web"
    | "claude-code"
    | "host-adapter"
    | "sensory";
  source_uri: string;
  idempotency_key: string;
  trust_tier: "user" | "first_party" | "web";
  transform_policy: string;
  payload: string; // JSON string
  contexts?: string[];
}

export interface DrainResult {
  seq: number;
  observe_id: string;
}

const QUARANTINE_THRESHOLD = 5;

/**
 * Synchronous append to observe_outbox. Spec §1.6.1 hook write path.
 * INSERT OR IGNORE for idempotency (idx_outbox_idempotency UNIQUE).
 */
export function appendToOutbox(db: Database, event: OutboxEvent): void {
  db.run(
    `INSERT OR IGNORE INTO observe_outbox (
      adapter, source_id, source_kind, source_uri, idempotency_key,
      trust_tier, transform_policy, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.adapter,
      event.source_id,
      event.source_kind,
      event.source_uri,
      event.idempotency_key,
      event.trust_tier,
      event.transform_policy,
      mergeContextsIntoPayload(event.payload, event.contexts),
    ]
  );
}

interface OutboxRow {
  seq: number;
  adapter: string;
  source_id: string;
  source_kind: string;
  source_uri: string;
  idempotency_key: string;
  trust_tier: string;
  transform_policy: string;
  payload: string;
  appended_at: string;
}

/**
 * Drain one outbox row. Implements spec §1.6.2 canonical single-DB transaction.
 *
 * Steps:
 * 1. Claim next drainable row (skips quarantined via partial index)
 * 2. Auto-register source if missing
 * 3. Auto-link source_context
 * 4. INSERT OR IGNORE observation
 * 5. Resolve canonical observe_id
 * 6. Enqueue for derivation pipeline
 * 7. Mark outbox row drained
 *
 * Returns null if no drainable rows exist.
 */
export function drainOne(db: Database): DrainResult | null {
  // STEP 1: Claim next drainable row
  const pending = db
    .query(
      `SELECT seq, adapter, source_id, source_kind, source_uri, idempotency_key,
              trust_tier, transform_policy, payload, appended_at
       FROM observe_outbox
       WHERE drained_at IS NULL AND drain_quarantined_at IS NULL
       ORDER BY seq
       LIMIT 1`
    )
    .get() as OutboxRow | null;

  if (!pending) return null;

  // P0-6 Self-Consumption guard (debate 007 Lock 5): quarantine immediately
  // when the source URI points at Compost's own wiki export (= an LLM-generated
  // page being offered back as raw input). drainOne is the universal L2 entry
  // gate, so guarding here covers every adapter without per-pipeline changes.
  if (isWikiSelfConsumption(pending.source_uri)) {
    quarantineImmediately(
      db,
      pending.seq,
      "self-consumption: refusing to re-ingest compost wiki export"
    );
    return null;
  }

  // Parse payload for observation fields
  let parsedPayload: {
    content?: string;
    mime_type?: string;
    occurred_at?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };

  try {
    parsedPayload = JSON.parse(pending.payload);
  } catch {
    recordDrainFailure(db, pending.seq, "invalid JSON payload");
    return null;
  }

  // Derive missing fields from hook payloads:
  // Hook shim writes {session_id, hook_event_name, ...} without occurred_at/mime_type.
  // Use appended_at as fallback for occurred_at, and application/json for mime_type.
  if (!parsedPayload.occurred_at) {
    parsedPayload.occurred_at = pending.appended_at;
  }
  if (!parsedPayload.mime_type) {
    parsedPayload.mime_type = "application/json";
  }
  // For hook payloads, the entire payload IS the content
  if (!parsedPayload.content) {
    parsedPayload.content = pending.payload;
  }

  try {
    const observeId = uuidv7();
    const contentHash = computeHash(parsedPayload.content ?? "");
    const rawHash = computeHash(pending.payload);
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");

    // Parse contexts from the outbox event's payload
    let contexts: string[] = [];
    try {
      const fullPayload = JSON.parse(pending.payload);
      if (Array.isArray(fullPayload.contexts)) {
        contexts = fullPayload.contexts;
      }
    } catch {
      // contexts are optional
    }

    const tx = db.transaction(() => {
      // STEP 2: Auto-register source if missing
      db.run(
        `INSERT OR IGNORE INTO source (id, uri, kind, trust_tier, refresh_sec)
         VALUES (?, ?, ?, ?, NULL)`,
        [
          pending.source_id,
          pending.source_uri,
          pending.source_kind,
          pending.trust_tier,
        ]
      );

      // STEP 3: Auto-link source_context
      for (const contextId of contexts) {
        db.run(
          `INSERT OR IGNORE INTO source_context (source_id, context_id)
           VALUES (?, ?)`,
          [pending.source_id, contextId]
        );
      }

      // STEP 4: INSERT the observation
      db.run(
        `INSERT OR IGNORE INTO observations (
          observe_id, source_id, source_uri, occurred_at, captured_at,
          content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
          adapter, adapter_sequence, trust_tier, idempotency_key,
          transform_policy, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          observeId,
          pending.source_id,
          pending.source_uri,
          parsedPayload.occurred_at,
          now,
          contentHash,
          rawHash,
          parsedPayload.content
            ? Buffer.from(parsedPayload.content)
            : null,
          null,
          parsedPayload.mime_type,
          pending.adapter,
          pending.seq,
          pending.trust_tier,
          pending.idempotency_key,
          pending.transform_policy,
          parsedPayload.metadata
            ? JSON.stringify(parsedPayload.metadata)
            : null,
        ]
      );

      // STEP 5: Resolve canonical observe_id
      const resolved = db
        .query(
          `SELECT observe_id FROM observations
           WHERE adapter = ? AND source_id = ? AND idempotency_key = ?`
        )
        .get(
          pending.adapter,
          pending.source_id,

exec
/bin/zsh -lc 'rg -n "policies|transform_policy .*registered|upsertPolicies|SELECT .*policies|policy_id" packages/compost-core packages/compost-daemon -S' in <repo>
 succeeded in 0ms:
packages/compost-daemon/src/scheduler.ts:10:import { getActivePolicy, validatePolicyExists } from "../../compost-core/src/policies/registry";
packages/compost-daemon/src/main.ts:5:import { upsertPolicies } from "../../compost-core/src/policies/registry";
packages/compost-daemon/src/main.ts:52:  // 3. Migrations + policies
packages/compost-daemon/src/main.ts:60:  upsertPolicies(db);
packages/compost-daemon/src/main.ts:61:  log.info("policies upserted");
packages/compost-daemon/src/main.ts:180:            upsertPolicies(db);
packages/compost-core/src/index.ts:3:  policies,
packages/compost-core/src/index.ts:4:  upsertPolicies,
packages/compost-core/src/index.ts:7:} from "./policies/registry";
packages/compost-core/src/index.ts:8:export type { TransformPolicy, PolicyId } from "./policies/registry";
packages/compost-daemon/test/daemon.test.ts:10:import { upsertPolicies } from "../../compost-core/src/policies/registry";
packages/compost-daemon/test/daemon.test.ts:28:/** Open an in-memory DB with all migrations and policies applied. */
packages/compost-daemon/test/daemon.test.ts:37:  upsertPolicies(db);
packages/compost-daemon/test/daemon.test.ts:93:  it("upserts policies (tp-2026-04 present)", async () => {
packages/compost-daemon/test/daemon.test.ts:100:      .query("SELECT policy_id FROM policies WHERE policy_id = 'tp-2026-04'")
packages/compost-daemon/test/daemon.test.ts:101:      .get() as { policy_id: string } | null;
packages/compost-daemon/test/daemon.test.ts:102:    expect(row?.policy_id).toBe("tp-2026-04");
packages/compost-core/src/schema/0005_merged_outbox.sql:19:  transform_policy TEXT NOT NULL,         -- must exist in policies table at drain time
packages/compost-core/src/policies/registry.ts:5: * Spec §2: each policy is immutable once active. New policies require
packages/compost-core/src/policies/registry.ts:28:export const policies = {
packages/compost-core/src/policies/registry.ts:87:export type PolicyId = keyof typeof policies;
packages/compost-core/src/policies/registry.ts:90: * Upsert all registry entries into the SQL policies table.
packages/compost-core/src/policies/registry.ts:93:export function upsertPolicies(db: Database): void {
packages/compost-core/src/policies/registry.ts:95:    INSERT INTO policies (policy_id, supersedes, effective_from, definition_json, migration_notes)
packages/compost-core/src/policies/registry.ts:97:    ON CONFLICT(policy_id) DO UPDATE SET
packages/compost-core/src/policies/registry.ts:103:    for (const policy of Object.values(policies)) {
packages/compost-core/src/policies/registry.ts:124:    .query("SELECT 1 FROM policies WHERE policy_id = ?")
packages/compost-core/src/policies/registry.ts:129:      `transform_policy \`${policyId}\` is not registered — add it to \`packages/compost-core/src/policies/registry.ts\` and restart the daemon`
packages/compost-core/src/policies/registry.ts:138:  const allPolicies = Object.values(policies);
packages/compost-core/src/schema/0002_debate3_fixes.sql:3:-- Creates: derivation_run, policies, context, fact_context, source_context, wiki_page_observe
packages/compost-core/src/schema/0002_debate3_fixes.sql:37:CREATE TABLE policies (
packages/compost-core/src/schema/0002_debate3_fixes.sql:38:  policy_id TEXT PRIMARY KEY,
packages/compost-core/src/schema/0002_debate3_fixes.sql:39:  supersedes TEXT REFERENCES policies(policy_id),
packages/compost-core/src/pipeline/ingest.ts:8:import { getActivePolicy, validatePolicyExists } from "../policies/registry";
packages/compost-core/test/crash-recovery.test.ts:7:import { upsertPolicies } from "../src/policies/registry";
packages/compost-core/test/crash-recovery.test.ts:43:    upsertPolicies(db);
packages/compost-core/src/pipeline/web-ingest.ts:11:import { validatePolicyExists } from "../policies/registry";
packages/compost-core/test/ledger.test.ts:7:import { upsertPolicies } from "../src/policies/registry";
packages/compost-core/test/ledger.test.ts:41:    upsertPolicies(db);
packages/compost-core/test/policies.test.ts:8:  policies,
packages/compost-core/test/policies.test.ts:9:  upsertPolicies,
packages/compost-core/test/policies.test.ts:12:} from "../src/policies/registry";
packages/compost-core/test/policies.test.ts:14:describe("policies/registry", () => {
packages/compost-core/test/policies.test.ts:29:  test("policies registry contains tp-2026-04", () => {
packages/compost-core/test/policies.test.ts:30:    expect(policies["tp-2026-04"]).toBeDefined();
packages/compost-core/test/policies.test.ts:31:    expect(policies["tp-2026-04"].id).toBe("tp-2026-04");
packages/compost-core/test/policies.test.ts:32:    expect(policies["tp-2026-04"].supersedes).toBeNull();
packages/compost-core/test/policies.test.ts:33:    expect(policies["tp-2026-04"].effective_from).toBe("2026-04-01");
packages/compost-core/test/policies.test.ts:34:    expect(policies["tp-2026-04"].chunk.size).toBe(800);
packages/compost-core/test/policies.test.ts:35:    expect(policies["tp-2026-04"].chunk.overlap).toBe(100);
packages/compost-core/test/policies.test.ts:36:    expect(policies["tp-2026-04"].extraction.timeoutSec).toBe(120);
packages/compost-core/test/policies.test.ts:37:    expect(policies["tp-2026-04"].extraction.maxRetries).toBe(3);
packages/compost-core/test/policies.test.ts:38:    expect(policies["tp-2026-04"].migration_notes).toBe(
packages/compost-core/test/policies.test.ts:43:  test("upsertPolicies inserts all registry entries into SQL policies table", () => {
packages/compost-core/test/policies.test.ts:44:    upsertPolicies(db);
packages/compost-core/test/policies.test.ts:46:    const rows = db.query("SELECT * FROM policies").all() as Array<{
packages/compost-core/test/policies.test.ts:47:      policy_id: string;
packages/compost-core/test/policies.test.ts:54:    expect(rows).toHaveLength(Object.keys(policies).length);
packages/compost-core/test/policies.test.ts:56:    const row = rows.find((r) => r.policy_id === "tp-2026-04")!;
packages/compost-core/test/policies.test.ts:67:  test("upsertPolicies is idempotent", () => {
packages/compost-core/test/policies.test.ts:68:    upsertPolicies(db);
packages/compost-core/test/policies.test.ts:69:    upsertPolicies(db);
packages/compost-core/test/policies.test.ts:71:    const rows = db.query("SELECT * FROM policies").all();
packages/compost-core/test/policies.test.ts:72:    expect(rows).toHaveLength(Object.keys(policies).length);
packages/compost-core/test/policies.test.ts:75:  test("upsertPolicies updates definition_json on re-run if content changed", () => {
packages/compost-core/test/policies.test.ts:76:    upsertPolicies(db);
packages/compost-core/test/policies.test.ts:80:      "UPDATE policies SET definition_json = '{}' WHERE policy_id = 'tp-2026-04'"
packages/compost-core/test/policies.test.ts:83:    upsertPolicies(db);
packages/compost-core/test/policies.test.ts:87:        "SELECT definition_json FROM policies WHERE policy_id = 'tp-2026-04'"
packages/compost-core/test/policies.test.ts:95:    upsertPolicies(db);
packages/compost-core/test/policies.test.ts:100:    upsertPolicies(db);
packages/compost-core/test/policies.test.ts:113:    upsertPolicies(db);
packages/compost-core/test/migrator.test.ts:82:      "policies",
packages/compost-core/test/query.test.ts:7:import { upsertPolicies } from "../src/policies/registry";
packages/compost-core/test/query.test.ts:31:    upsertPolicies(db);
packages/compost-core/test/query.test.ts:105:    upsertPolicies(db);
packages/compost-core/test/query.test.ts:168:    upsertPolicies(db);
packages/compost-core/test/pipeline.test.ts:12:import { upsertPolicies, getActivePolicy } from "../src/policies/registry";
packages/compost-core/test/pipeline.test.ts:41:    upsertPolicies(db);

exec
/bin/zsh -lc "sed -n '90,150p' packages/compost-core/src/policies/registry.ts" in <repo>
 succeeded in 0ms:
 * Upsert all registry entries into the SQL policies table.
 * Called at daemon startup BEFORE opening MCP server or drain loop.
 */
export function upsertPolicies(db: Database): void {
  const stmt = db.prepare(`
    INSERT INTO policies (policy_id, supersedes, effective_from, definition_json, migration_notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(policy_id) DO UPDATE SET
      definition_json = excluded.definition_json,
      migration_notes = excluded.migration_notes
  `);

  const tx = db.transaction(() => {
    for (const policy of Object.values(policies)) {
      stmt.run(
        policy.id,
        policy.supersedes,
        policy.effective_from,
        JSON.stringify(policy),
        policy.migration_notes
      );
    }
  });

  tx();
}

/**
 * Application-layer referential integrity check.
 * Spec §2: every writer calls this before insert. Throws with actionable
 * error message instead of SQLite's opaque FK failure.
 */
export function validatePolicyExists(db: Database, policyId: string): void {
  const row = db
    .query("SELECT 1 FROM policies WHERE policy_id = ?")
    .get(policyId);

  if (!row) {
    throw new Error(
      `transform_policy \`${policyId}\` is not registered — add it to \`packages/compost-core/src/policies/registry.ts\` and restart the daemon`
    );
  }
}

/**
 * Returns the latest policy that is not superseded by another.
 */
export function getActivePolicy(): TransformPolicy {
  const allPolicies = Object.values(policies);
  const supersededIds = new Set(
    allPolicies.map((p) => p.supersedes).filter(Boolean)
  );

  const active = allPolicies.filter((p) => !supersededIds.has(p.id));
  // With a single policy, this is trivially the only one.
  // With multiple, return the latest by effective_from.
  active.sort(
    (a, b) =>
      new Date(b.effective_from).getTime() -
      new Date(a.effective_from).getTime()
  );

codex
1. 基线：稳+开源，先 B，不上 C/D/E。理由：新增 schema 现在收益低、迁移面大；风险：短期功能感弱。  
2. PII 是开源前置，但不是“做完就能开源”；bench/docs/LICENSE/examples 同样缺。若近期不开源，不必神化 B。风险：误把安全感当成熟度。  
3. P1 排序我改成 `bench > PII > origin_hash > open_problems`。100k fixture 真成本不在生成，而在 CI 噪声/时长；100k 只该夜跑。`open_problems` 必须是持久盲点表，可引用 `health_signals/correction_events`，不能复制告警。风险：三表重叠。  
4. `episodic/memory_procedural` 等真实需求；现在加表/FTS 只增维护面。风险：以后补迁移。  
5. E 先别做。`compost_cache` 在 Engram 侧，`source_hash` 必须先冻结“排序 provenance manifest→hash”契约；两边各算必漂。风险：缓存污染/失效。  
6. 脏数据：`fact_links` 悬挂边因 FK+CASCADE 风险小；真隐患是零贡献者 `wiki_pages`、`observations.transform_policy` 仅应用层校验无 FK、`orphan obs` 只做 delta 不定性。`origin_hash/method` 别直接 `NOT NULL` 加列；SQLite 要默认值或重建表，ledger 一大就锁库。  

3 session：  
S1 加 audit：zero-contributor wiki、unknown policy、obs/fact delta。  
S2 做 PII redactor + tests。  
S3 做 bench 骨架：PR 跑 1k/10k，100k 夜跑；暂缓 `origin_hash/open_problems/D/E`。
tokens used
61,986
1. 基线：稳+开源，先 B，不上 C/D/E。理由：新增 schema 现在收益低、迁移面大；风险：短期功能感弱。  
2. PII 是开源前置，但不是“做完就能开源”；bench/docs/LICENSE/examples 同样缺。若近期不开源，不必神化 B。风险：误把安全感当成熟度。  
3. P1 排序我改成 `bench > PII > origin_hash > open_problems`。100k fixture 真成本不在生成，而在 CI 噪声/时长；100k 只该夜跑。`open_problems` 必须是持久盲点表，可引用 `health_signals/correction_events`，不能复制告警。风险：三表重叠。  
4. `episodic/memory_procedural` 等真实需求；现在加表/FTS 只增维护面。风险：以后补迁移。  
5. E 先别做。`compost_cache` 在 Engram 侧，`source_hash` 必须先冻结“排序 provenance manifest→hash”契约；两边各算必漂。风险：缓存污染/失效。  
6. 脏数据：`fact_links` 悬挂边因 FK+CASCADE 风险小；真隐患是零贡献者 `wiki_pages`、`observations.transform_policy` 仅应用层校验无 FK、`orphan obs` 只做 delta 不定性。`origin_hash/method` 别直接 `NOT NULL` 加列；SQLite 要默认值或重建表，ledger 一大就锁库。  

3 session：  
S1 加 audit：zero-contributor wiki、unknown policy、obs/fact delta。  
S2 做 PII redactor + tests。  
S3 做 bench 骨架：PR 跑 1k/10k，100k 夜跑；暂缓 `origin_hash/open_problems/D/E`。
