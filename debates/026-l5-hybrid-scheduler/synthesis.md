# Final Synthesis: Phase 7 L5 hybrid scheduler scope

**Debate**: 026-l5-hybrid-scheduler
**Style**: quick / 1 round / cross-critique
**Participants**: 🟡 Gemini, 🔴 Codex, 🟠 Sonnet, 🐙 Claude (Opus, moderator)
**Date**: 2026-04-26
**Entry condition met**: 12 chains / 66.7% positive_rate / 4 conf>0.7 confirmed (S662 commit `d72e301`)

## 投票结果

| Advisor          | Q1 seed | Q2 cadence | Q3 gate | Q4 state | Q5 surface |
|------------------|---------|------------|---------|----------|-----------|
| 🐙 Claude (Opus) | (a)     | (p)        | (iii)+auto-resume | (A) | (II) |
| 🟠 Sonnet        | (c)     | (p)        | (ii)    | (A)      | (II) |
| 🟡 Gemini        | (d)     | (r)        | (iv)    | (A)      | (III) |
| 🔴 Codex         | (c)     | (p)        | (iv)    | (A)      | (II) |
| **裁定**         | **(c) + surge guard** | **(p)** | **(iv) + Opus auto-resume** | **(A) ✓ unanimous** | **(II)** |

## 共识区

**4/4 全票通过**:

- **Q4 (A) `reasoning_scheduler_state` 单行表** — 唯一真共识。所有四方一致：SQLite ledger 是 scheduler state 的天然归属。理由汇聚: WAL 提供 CLI/daemon 跨进程一致 (Sonnet+Codex)，跟 backup/restore 路径无缝 (Opus+Codex)，避免 JSON file 双 truth (Sonnet)，避免 in-memory 失重启 cooldown (全四方)，且无现成 generic kv 表 (Codex 实证 `daemon_kv` / `system_state` 不存在)。

**3/4（lone dissent 标记）**:

- **Q2 (p) Fixed 6h, max N=3** — Opus+Sonnet+Codex (3) vs Gemini (r) (1)。理由汇聚: (q) 跟 reflect 耦合违反 HC-8 (Codex 实证 `scheduler.ts:104,120,135` reflect→triage→wiki 链已稳定，加 reasoning 把 30s tick 推到 5min); (r) adaptive 双计 verdict 信号 (Opus 论证 — Q3 已是 verdict-feedback 通道); (s) idle-only 失败于合盖。Gemini 的 (r) 战略论 "brain 跟着用户活跃度" 真但被 Codex demolish: `getVerdictStats()` 当前是全表聚合不是滑动窗口 (`reasoning.ts:760`), adaptive cadence 需另写"近 N 链"helper, MVP 不该上。**Gemini 的 (r) 留 v2 promotion 路径**: 当 chains > 50 且 verdict 信号窗口 helper ship 后再开。

- **Q5 (II) CLI + read-only MCP** — Opus+Sonnet+Codex (3) vs Gemini (III) (1)。理由汇聚: pause/resume 是用户 policy 决策不是 agent autonomy (Opus); agent 写 pause = 静默失败模式 (Sonnet+Codex); MCP 已暴露 verdict write + reason write，加 scheduler write 是 trust boundary 越线 (Codex 引 `mcp-server.ts:691,775` 论证 surface 已饱和)。Gemini 的 (III) 全暴露论 "agent 检测质量回归主动 pause" 被反驳: agent pause 后用户不知 → 产品死。**read-only status 让 agent 解释 "为什么没 proactive chain" 已足够 brain-like**。

**2/4（真分歧 — 本 debate 的核心 tiebreak）**:

### Q1 (Seed source) — Sonnet+Codex (c) vs Opus (a) vs Gemini (d)

最大分歧。三方各 1 票 (Opus a, Gemini d, Sonnet+Codex c=2)。Tiebreak 由 **Codex 的硬数据**裁定:

> "live ledger has 7 open gaps but `open_gaps_ask2=0`" — Codex Round 1

(a) high ask_count gaps 的前提假设是用户已积累重复发问数据。**实际 ledger 当前零条 ask_count≥2**。Opus (a) 论证 "signal 不自我应验" 战略上对，但被代码事实 demolish: scheduler 一启动就找不到 work, fallback 路径才是真定义。Codex 进一步指出 (b) verdict-similarity 缺 "confirmed seed SPO embedding → 未推理 fact kNN" 的现成 VectorStore 接口 (`lancedb.ts:76,100` 只支持 text + 预计算向量), MVP 也不能上。

(c) recently-active subjects 是唯一**有数据**的源 (`facts.created_at` 永远有值)。但 Sonnet+Codex 都警告: engram-pull 一次性灌 614 facts 会污染信号 (`ingest-adapter.ts:76`)。

**Opus 撤回 (a) 改投 (c)**——Codex 的代码事实证据胜过我的理论论证。**裁定: (c) + 强制 surge guard**:
- 排除最近 24h 内的 facts WHERE `transform_policy LIKE 'engram%'` 或 batch insert 检测 (单 observe_id 入 >5 条 fact)
- 取最近 7d 内 created_at 的 facts，按 subject 聚合, 取 top 3 subjects
- 每 subject 选最新 1 fact 作 seed (避免单 subject 推 10 链)

(d) Gemini multi-source weighted: 所有三方反对——MVP 该锁单源, 多源加权是 v2/v3。Gemini 的 "brain not search engine" 战略论真, 但落地 priority 错: 单源走通了再叠加, 不是同时上 4 个。**defer (d) 到 debate 027+**.

### Q3 (Quality gate) — Gemini+Codex (iv) vs Opus (iii)+auto-resume vs Sonnet (ii)

Tiebreak 由 **Codex 的实现细节论证**:

> "runReasoning() persists failed/no-chain rows as active chains with failure_reason, so a bad model can fill the table without derived-link writeback (`reasoning.ts:567,594`). Pure manual pause = product death; pure soft skip = silent infinite loop."

Sonnet 的 (ii) static skip 在 Codex 论证下不够: 失败链以 `status='active'` 持久化, 静态门只挡 cycle 不挡 spurious 数据堆积。Opus 的 (iii) manual resume + auto-7d 太宽松, 短期波动也触发硬 pause 不必要。Gemini+Codex 的 (iv) 双层:
- **软层**: 启动 cycle 前 `getVerdictStats` 近 10 judged 链 rejected_rate ≥ 50% → skip 当前 cycle (不写 paused, 下次还试)
- **硬层**: 连续 K=4 个 cycle 软层触发 (≈24h) → 写 paused=true 持久态

**Opus 修订加成**: 硬层 paused 后 7d 自动 resume (避免用户忘记 → 产品死)。

**Codex 的 helper 缺口提示**: `getVerdictStats()` 当前全表聚合 (`reasoning.ts:754-794`), 不能直接做 "recent N judged" 查询。需新增 `getRecentVerdictStats(db, limit)` helper 按 `verdict_at DESC` 排序取近 N。这是落地 patch 的隐藏 prerequisite。

## Synthesis 裁定

**Q1 (c) recently-active subjects + surge guard | Q2 (p) fixed 6h N=3 | Q3 (iv) 双层 + Opus 7d auto-resume | Q4 (A) migration 0020 | Q5 (II) CLI + read-only MCP**

Tiebreak rationale:
1. **Codex 的 ledger 实证** 是 Q1 的唯一硬证据 (open_gaps_ask2=0)。理论 vs 数据，数据赢。Opus 撤回。
2. **Q3 双层 + auto-resume** 是 Sonnet 软门 + Opus 自恢复 + Codex+Gemini 硬门的合并。三层论证融合后比任一单方案更鲁棒。
3. **Q2/Q5 的 3:1 票型** 把 Gemini 的战略积极性留作 v2 promotion 路径而非 MVP 选择。Brain identity 不一次性建成, 是迭代密化。
4. **Q4 4:0** 锁定，无需 tiebreak。

## 落地 patch (~3-4h 实施估)

### Step 1: Migration 0020 — `reasoning_scheduler_state`

`packages/compost-core/src/schema/0020_reasoning_scheduler_state.sql`

```sql
-- Migration 0020 — Phase 7 L5 hybrid scheduler state (debate 026)
-- Single-row state table. INSERT one row at migration time, UPDATE thereafter.

CREATE TABLE reasoning_scheduler_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- enforce single row
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0, 1)),
  paused_reason TEXT,
  paused_at TEXT,
  last_cycle_at TEXT,
  last_cycle_stats_json TEXT CHECK(last_cycle_stats_json IS NULL OR json_valid(last_cycle_stats_json)),
  consecutive_skipped_cycles INTEGER NOT NULL DEFAULT 0
);

INSERT INTO reasoning_scheduler_state (id) VALUES (1);
```

### Step 2: `cognitive/reason-scheduler.ts` (new)

```typescript
export interface SchedulerState { paused: boolean; paused_reason: string | null; paused_at: string | null; last_cycle_at: string | null; last_cycle_stats: CycleStats | null; consecutive_skipped_cycles: number; }
export interface CycleStats { triggered_at: string; chains_attempted: number; chains_succeeded: number; chains_skipped_idempotent: number; seeds_selected: string[]; gate_decision: "ran" | "skipped_soft" | "skipped_hard_paused" | "skipped_below_entry"; }
export const SCHEDULER_BUDGET = 3;
export const SOFT_GATE_REJECTED_RATE = 0.5;
export const HARD_GATE_CONSECUTIVE_SKIPS = 4;
export const HARD_GATE_AUTO_RESUME_HOURS = 24 * 7;
export function readState(db): SchedulerState { ... }
export function writeState(db, partial: Partial<SchedulerState>): void { ... }
export function getRecentVerdictStats(db, limit = 10): { judged: number; rejected: number } { ... }  // NEW helper - close Codex's gap on existing aggregate
export function selectSeeds(db, budget: number): Array<{ kind: 'fact'; id: string }> {
  // (c) + surge guard: facts.created_at > now-7d, exclude observations with bulk-import marker
  // (transform_policy LIKE 'engram%' OR observe_id has >5 facts)
  // GROUP BY subject, ORDER BY MAX(created_at) DESC LIMIT 3 subjects
  // Return latest fact per subject (1 each)
}
export function canTriggerCycle(db): { decision: "ok" | "skip_soft" | "skip_hard" | "below_entry"; details: string } {
  // 1. Below-entry check: total chains < 10 → skip_below_entry (graceful pre-bootstrap)
  // 2. Hard gate: state.paused=true → check 7d auto-resume → skip_hard or clear-and-proceed
  // 3. Soft gate: getRecentVerdictStats(10).rejected/judged >= 0.5 → skip_soft + bump consecutive_skipped_cycles → may transition to hard
}
export async function runCycle(db, llm: BreakerRegistry, vectorStore?, budget = SCHEDULER_BUDGET): Promise<CycleStats> { ... }
```

### Step 3: `compost-daemon/src/scheduler.ts` — `startReasoningScheduler`

新增独立 ticker (Codex 论证: 不耦合 reflect)。每 6h 调 `runCycle`. 模式跟 `startReflectScheduler` (`scheduler.ts:104-138`) 同型, 但独立 timer.

### Step 4: `compost-daemon/src/main.ts`

启动调用 `startReasoningScheduler(db, llmRegistry, vectorStore)`. 跟 reflect 平级。

### Step 5: CLI `compost reason scheduler {status|pause|resume}`

`packages/compost-cli/src/commands/reason.ts` 加子命令组. status JSON 输出 `state + last_cycle_stats + recent_verdict_stats(10)`. pause 写 paused=true + paused_reason. resume 写 paused=false 清 reason + 清 consecutive_skipped_cycles.

### Step 6: MCP `compost.reason.scheduler.status` (read-only, 仅暴露此一个)

跟 verdict.stats 同型. **NOT** 暴露 pause/resume — Q5 (II) 决议。

### Step 7: Tests (~12)

- `reason-scheduler.test.ts`: selectSeeds 排除 engram surge / 限 7d / top 3 subjects / 1 fact per subject
- canTriggerCycle: below-entry / soft gate (50% rejected → skip + bump counter) / hard gate transition (consecutive ≥4) / 7d auto-resume / paused 状态读写
- runCycle: 整流, idempotency 复用, derived_from write-back 仍触发, failed chain 不写边
- migrator: count 19 → 20

### Step 8: ROADMAP update

`docs/ROADMAP.md` Phase 7 §"Deferred to follow-up slices" → ✅ shipped, 引用 commit hash + debate 026 link.

## Out of scope (留 follow-up debate)

- **(b) verdict-similarity seed source** — debate 027 候选; 需 VectorStore 加 SPO-embedding 接口
- **(d) multi-source weighted** — debate 028 候选; 需 (a)+(b)+(c) 各自跑过且有 verdict 数据后再讨论权重
- **(r) adaptive cadence** — debate 029 候选; promotion 条件: ≥50 chains + getRecentVerdictStats helper ship 后
- **`--push-engram` for high-confirmed chains** — `engram_insight_id` 列已 reserve, 但 push 策略需独立 debate
- **`(β)` pattern detection** — Phase 7 P0 子能力, 完全独立 debate
- **`(γ)` hypothesis generation** — 需 facts.kind schema 扩展, 独立 debate

## Concedes (本 debate 撤回项)

- **🐙 Opus 撤回 Q1(a)**: Codex 的 `open_gaps_ask2=0` 数据论证胜过 Opus 的 "signal 不自我应验" 理论论证。理论 vs 实证, 实证赢。
- **🟠 Sonnet (ii) 升级到 (iv)**: Codex 的 "failed chain 以 active 持久化" 论证补强 hard gate 必要性。
- **🟡 Gemini (d)/(r)/(III) 全留 v2**: 战略积极性正确但 MVP slice 规模错配; 留 promotion 路径不留死结。

## 投票质量评估

| Advisor | length | citations | code refs | engagement | score |
|---|---|---|---|---|---|
| 🟡 Gemini | 667w ✓ | 多 ROADMAP/debate ref ✓ | medium | engaged with cross-views ✓ | ~85 |
| 🟠 Sonnet | 1393w ✓ | 多 file:line ✓ | high ✓ | engaged with framing ✓ | ~95 |
| 🔴 Codex | 466w (under) | 大量 file:line ✓ | very high ✓ | direct demolitions ✓ | ~90 |
| 🐙 Opus | 628w ✓ | 跨 advisor ref ✓ | medium | self-revision based on Codex ✓ | ~90 |

四方平均 ~90, 高质量 debate. Codex 的 466w 略短但密度高 (实证为王)。
