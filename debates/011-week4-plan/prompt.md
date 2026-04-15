# Debate 011 — Phase 4 Batch D Week 4 Execution Plan

## 背景

Week 1-3 + Day 4 已 merge (PR #1 + #2, commit 642668d). P0-0..P0-7 全 land.
286 tests pass / 0 fail. main 分支 confirmed 完整无 gap.

## Week 4 候选任务池 (待排序 + 裁决)

### 来源 A: debate 010 synthesis §"不阻断 Merge 但需要进入 Week 4" (11 项)
1. **Merge 双 `BreakerRegistry`** (`main.ts:82` + `mcp-server.ts` lazy ctor) — 30 min
2. **scheduler wiki hook 集成测试** (依赖 #1 先做) — 2h
3. half-open 长任务饿死短任务 (design + impl) — 2h
4. union signature `LLMService | BreakerRegistry` → `ILLMProvider.forSite()` 重构 — 1h (触发条件: 第 3 种 wrapper 登场)
5. `compost audit list` CLI 测试 (enum validation + exit codes) — 30 min
6. `OllamaLLMService` 未运行时 UX: `compost doctor --check-llm` 实装 — 1h
7. `ask()` hits=0 查 wiki title/slug + 决定 short-circuit — 1h
8. `stale_wiki` triage signal 未兑现 (P0-1 一起做或降文档) — 1h
9. `scheduler.ts` 头部 import 整理 — 15 min
10. `archive_reason='superseded'` schema CHECK 收紧或文档锁语义 — 5 min
11. `reconstructConfidenceTier` float equality → 门槛比较 — 5 min (触发: 新 migration 引入计算 floor)

### 来源 B: Phase 4 原计划 P0-1 (debate 002 定锁)
- **P0-1 `compost triage` CLI + `health_signals` 5 种信号扫描** — 核心 Week 4 任务
  - 5 signal kinds (debate 005 定锁): `stale_cluster` / `orphan_fact` / `correction_candidate` / `stale_wiki` / `low_coverage`
  - Surface-only (不自动 mutate facts)
  - CLI: `compost triage list --kind <kind> --limit N`
  - 估算 ~1 day

### 来源 C: Phase 4 P1 (debate 002 backlog, 4 项)
- `open_problems` table + CLI (curiosity/gap replacement)
- Inlet `origin_hash` + `method` columns on `observations`
- Performance benchmark harness (`bench/reflect-1k/10k/100k.bench.ts`)
- PII redactor in hook-shim (regex blocklist)

### 来源 D: 新涌现的待办 (本次 session)
- `triage.ts:56,82` stub → 实装 (跟 P0-1 合并)
- `correction-detector.ts:65` `correctedText` 提取 — 实装 extraction 算法
- `schema/0010:82` 删掉 stale TODO 注释

## R1 任务 (≤ 1200 字)

### 1. Week 4 推荐排序 (Day 1-5)
- 每日 1-2 个具体目标, 注明依赖
- 说明哪些 P0-1 contract 必须 freeze 在 Day 1 (plan-lock 风格)
- 哪些可以并行

### 2. 排除项 (不做)
- 本周不应碰的 Week 5+ 事项
- 理由 (时间/依赖/YAGNI)

### 3. 风险预警 (≥ 2)
- Week 4 最可能翻车的点
- 提前需要锁的契约

### 4. Done-definition
- Week 4 结束时哪 N 项必须达成
- 对应测试覆盖
- 合理的 merge gate (类似 debate 010 的 blocker 标准)

### 5. 一句话总评 (≤ 100 字)

## 硬约束
- 严禁生物学隐喻
- 引用现有 file:line 时精确
- 不重复 debate 002-010 已裁决项
- Day-by-day 必须具体可执行
- 承认依赖链 (e.g. registry merge 必须在 scheduler 集成测试前)

## 上下文快照

| 区域 | 状态 |
|---|---|
| 分支 | 已在 main, 642668d |
| 测试 | 286 pass / 0 fail / 3 skip |
| 已知风险 | ROADMAP.md "Known risks (post Week 3)" 8 行表 |
| LLM call sites | 3 个已 wire (`ask.expand`, `ask.answer`, `wiki.synthesis`), `mcp.ask.factory` 已删 |
| Schema 最新 | 0013 |
| Stubs | triage.ts 全 stub, correction-detector 部分 |

## 输出

写入 `/Users/zion/Repos/Zylo/Compost/debates/011-week4-plan/rounds/r001_<名字>.md`,
末尾 print `DONE_R1_011`.

## 参赛者
- Codex (排期可行性 / SQL + 并发风险)
- Gemini (LLM 可靠性 / triage 信号设计)
- Sonnet (KISS / scope creep 抓取)
- Opus (架构 + 终裁 synthesis)
