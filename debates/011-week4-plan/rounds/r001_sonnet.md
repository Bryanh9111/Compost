# Debate 011 R1 — Sonnet (KISS / 反 scope creep)

视角: 11 项 debate-010 余项 + 4 项 P1 + 新涌现 TODO 是糖衣炮弹. Week 4 的**原始**P0 是 P0-1 triage. 任何削弱 P0-1 落地的事情, 默认 Week 5.

## 1. Day-by-Day (依赖链严守)

### Day 1 — 平台地基 (必须先于 triage)
**目标**: 让 Week 4 其余几天都能直接用一份 registry + 清爽 scheduler.
- **T1** merge `BreakerRegistry` 二实例
  - touch: `packages/compost-daemon/src/main.ts:82` (已导出 `llmRegistry`) + `packages/compost-daemon/src/mcp-server.ts:53,212` (删 lazy ctor)
  - 让 `startMcpServer(db, registry)` 加参数; `main.ts` 注入同一份
- **T2** scheduler import 整理 + `existsSync` 已在 debate 010 merge-blocker 清掉, 本周仅**头部一把梭**再扫一遍 (`scheduler.ts:1-30`)
- **依赖**: 无. **产出**: 单一 registry contract 冻结, 作为 Day 2 起所有 LLM 调用的入口假设

### Day 2 — P0-1 契约冻结 + scan 实装 (Part 1)
**目标**: lock signal kinds, 落地 2/6 最便宜的 scan.
- **契约冻结 (plan-lock)**: 以 `triage.ts:12-18` **现有** 6 种 kind 为准 (`stale_fact / unresolved_contradiction / stuck_outbox / orphan_delta / stale_wiki / correction_candidate`). **Brief 里写的 `stale_cluster/orphan_fact/low_coverage` 是过时列表, 不采信** — 代码 + migration 0010/0012 CHECK 已经是前者. Day 1 结束前在 `debates/011-week4-plan/contract.md` 写一页 pin 死.
- **实装**: `stuck_outbox` (查 `outbox` 表 age > 24h) + `stale_wiki` (查 `wiki_pages.stale_at` 非空, 0013 已有列) — 这两个查询最简单
- touch: `packages/compost-core/src/cognitive/triage.ts:55` (替换 stub)
- **依赖**: 无. **产出**: 2 种 scan + 新增 `triage.test.ts` (>= 6 cases)

### Day 3 — P0-1 scan Part 2 + CLI
**目标**: 收官 triage 实装 + CLI surface
- 剩下 4 种: `stale_fact` (observations.created_at) / `unresolved_contradiction` (contradictions 表 age) / `orphan_delta` (fact_links 零入边 + activity 低) / `correction_candidate` (correction-detector 已写入, 只需 aggregation)
- `resolveSignal()` (triage.ts:77) 实装
- **CLI**: 新增 `packages/compost-cli/src/commands/triage.ts` (仿 `audit.ts` 结构)
  - 子命令: `list --kind <k> --limit N`, `resolve <id> --by <user|agent>`
  - 注册到 `compost-cli/src/main.ts`
- **依赖**: Day 2 的契约 freeze. **产出**: P0-1 done.

### Day 4 — scheduler 集成测试 + doctor --check-llm (同为 LLM 可观测性, 合并同日)
两项都碰 daemon 侧 LLM 契约, 并入同日避免 context switch.
- **T1** `packages/compost-daemon/src/scheduler.test.ts` 新建 (debate 010 待办 1). 用 1ms interval + MockLLM registry, 断言 wiki rebuild hook 触发并写 `audit_events` 行
- **T2** `packages/compost-cli/src/commands/doctor.ts` 加 `--check-llm` flag: 调一次 Ollama health, 返回可读 diagnostics; 无 Ollama 时给出 setup 指令
- **依赖**: Day 1 registry 合并 (scheduler test 只需断言一份 registry). **产出**: integration test fills Week-3 覆盖 gap

### Day 5 — 卫生 sweep + PR
- `schema/0010_phase4_myco_integration.sql:82` 删 stale TODO 注释 (新涌现 D)
- `compost audit list` CLI 测试补 enum 验证 + exit code (debate 010 待办 5) — 小
- `ask()` hits=0 查 wiki title (待办 7): **仅加 short-circuit 判断**, 不做全 FTS 重查. ~20 行
- `correction-detector.ts:65` `correctedText` extraction: **本周只做最朴素版** — 取匹配位置后 200 字符; 复杂 NLP 延 Week 5
- 跑全量 `bun test`, 要求 >= 295 pass
- 开 Week 4 PR

## 2. 排除项 (Week 5+)

| 项 | 理由 |
|---|---|
| half-open 饿死短任务 (待办 3) | debate 010 明确"合并 registry 后才是真风险", Day 1 刚合, 还没有 incident. YAGNI |
| union signature → `ILLMProvider.forSite()` 重构 (待办 4) | 四方共识 "等第 3 种 wrapper 登场". 本周不会有 retry/ratelimit wrapper, 重构无锚 |
| `archive_reason='superseded'` CHECK 收紧 (待办 10) | 5 min 事但无回报, 无 bug report |
| `reconstructConfidenceTier` float equality (待办 11) | 明确 "首次引入计算 floor 时". 未触发 |
| `open_problems` table (P1) | 新表新 CLI, 最少 1.5 天; 跟 P0-1 triage 用户流重合 80%, 先看 triage 产出再说 |
| Inlet `origin_hash` + `method` (P1) | schema + ingest 改动, 跨 package. Week 4 已满载 |
| Performance bench harness (P1) | 286 tests 还没到瓶颈, 先测再优. Week 5 可做 1 次 baseline |
| PII redactor in hook-shim (P1) | regex blocklist 看似简单, 实则需要威胁模型定义. 单独 debate |
| `circuit-breaker.test:179` flaky 调查 | debate 010 结论 "先观察". 无新信号别动 |

**核心原则**: 一个 file 在一周内只碰一次. Day 1 的 `scheduler.ts` 清理 + Day 4 的 `scheduler.test.ts` 新建是**两个文件**, 可接受.

## 3. 风险预警

1. **契约漂移风险 (高)**: Brief §B 写的 signal kinds (`stale_cluster/orphan_fact/low_coverage`) 与代码 `triage.ts:12-18` 的 6 种**不一致**. 如果 Day 2 照 brief 走, 要改 migration CHECK + correction-detector 调用点 + 全部 downstream. **Day 1 必须写 `contract.md` 锁定以代码为准**, 否则 Day 2-3 全部返工.

2. **P0-1 scope 肿胀风险 (高)**: triage 6 种 scan 各自都能继续挖 (例如 orphan_delta 要多少入边算 orphan? stale_fact 按 90 天还是按 decay score?). **预设规则**: 每种 scan 默认阈值写死在 `TriageOptions` (triage.ts:40), **不做自适应**, 不做跨表 join. 简单 SQL + LIMIT. 这是 "surface only" 的原意.

3. **Day 4 双任务耦合风险 (中)**: scheduler 集成测试 + doctor --check-llm 都动 LLM 边界. 若 scheduler test 发现 registry 合并后有隐藏 race (例如 shared breaker state 在并发 ask + wiki 下错), 优先修 bug, doctor --check-llm 推到 Day 5 尾巴或 Week 5. 测试 **必须用 MockLLM** (参考 Week 2 的 mock pattern), 不依赖真实 Ollama.

4. **"新涌现 TODO" 被扩展风险 (中)**: correction-detector.ts:65 的 `correctedText` extraction 容易滑进 NLP 坑. Day 5 只做 **substring(end, end+200)** 朴素版, 注释 "TODO Week 5+: 上下文语义抽取". 若想做得"漂亮", 直接推 Week 5.

## 4. Done-definition (merge gate)

Week 4 PR 能合并的硬条件:
- [ ] **P0-1 完成**: triage.ts 6 种 scan 全实装, `resolveSignal` 实装, CLI `compost triage list/resolve` 可跑, 覆盖 >= 12 个测试 (每种 scan 至少 2 case: 阳 + 阴)
- [ ] **registry 单例**: `main.ts` + `mcp-server.ts` 共享同一 `BreakerRegistry`; `scheduler.test.ts` 用 MockLLM 断言 wiki rebuild 写 audit row
- [ ] **doctor --check-llm** 可跑, Ollama 未运行给 exit code != 0 + 可读 hint
- [ ] **全量测试**: `bun test` >= 295 pass / 0 fail (+9 from 286: ~6 triage scan tests + ~2 scheduler integration + ~1 doctor)
- [ ] **文档**: ROADMAP.md "P0-1 triage" 行打勾, Known risks 表移除 "registry 双实例" 行
- [ ] **无 TODO 新增**: 除了 correction-detector:65 的朴素版本注释
- [ ] debate 010 merge-blocker 6 项已在上一 PR 清完 (前置条件), 本周只写新代码

**不阻断合并 (但记录为 Week 5 首选)**: `open_problems` 设计讨论, `correctedText` 语义抽取, PII redactor 威胁模型, bench harness baseline.

## 5. 一句话总评

Day 1 锁 registry + signal kinds 两份 contract, Day 2-3 直接把 P0-1 triage 的 6 种 scan 写满并 CLI 上架, Day 4 补 scheduler 集成测试 + doctor health, Day 5 只做朴素卫生, P1 四项和 9 成 debate-010 余项全部推 Week 5.

DONE_R1_011
