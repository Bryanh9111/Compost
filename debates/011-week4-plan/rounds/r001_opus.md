# Debate 011 R1 — Opus (architecture + week-scale sequencing)

## 1. Week 4 Day-by-Day

### Day 1: Registry consolidation + scheduler integration test (依赖链顶端)
**目标**: 消除双 `BreakerRegistry` + 让 scheduler wiki hook 有直接测试.
- AM: `main.ts:82` 的 `llmRegistry` 改为 export; `startMcpServer(db)` 签名
  加第二参 `registry: BreakerRegistry` (`compost-daemon/src/mcp-server.ts`);
  删除 mcp-server 内 lazy ctor. 改 `main.ts:104` 调用处传入.
- PM: 新 `packages/compost-daemon/test/scheduler.test.ts` — 用 1-2ms interval
  + `MockLLMService` + `BreakerRegistry`, 断言: (a) `reflect` 后 `wiki_rebuild`
  audit 行写入, (b) 注入 `mode:"error"` 后 `wiki_pages.stale_at` 被 set.
- 依赖: 无. 必须先做, 因为 Day 2 起的每项 P0-1 改动都可能触及 scheduler.
- **Plan-lock 时刻**: Day 1 结束前冻结 `LLMCallSite` 列表 (`"ask.expand" |
  "ask.answer" | "wiki.synthesis"` 当前 3 项), 如果 P0-1 要新 site, Day 2
  morning 补 lock.

### Day 2: P0-1 `compost triage` — schema + 5 signal kind 扫描器
**目标**: 实装 `triage.ts` 全 stub 去掉.
- AM plan-lock: 冻结 5 signal kind schema (已由 debate 005 定):
  `stale_cluster` / `orphan_fact` / `correction_candidate` / `stale_wiki` /
  `low_coverage`. 确认 `health_signals` CHECK constraint 覆盖这 5 个 (migration
  0010 + 0012 已加; 只需 verify).
- PM 实装扫描器 (`packages/compost-core/src/cognitive/triage.ts:56,82`):
  - `scanStaleCluster` → `graph_health_snapshot.stale_cluster_count > 0` 触发
  - `scanOrphanFact` → `v_graph_health.orphan_facts` 当前值
  - `scanCorrectionCandidate` → 从 `correction_events` 直接聚合
  - `scanStaleWiki` → `SELECT * FROM wiki_pages WHERE stale_at IS NOT NULL`
  - `scanLowCoverage` → ask 有 hit 但 confidence 全低 的查询 (`access_log` 聚合)
- 测试: `packages/compost-core/test/triage.test.ts` 5 个信号各一 happy path.
- 依赖: Day 1 registry merge (wiki 路径) + schema 0010/0012 现有表.

### Day 3: `compost triage` CLI + `stale_wiki` 信号闭环
**目标**: CLI 可见 + wiki fallback 写信号行.
- AM: `packages/compost-cli/src/commands/triage.ts` 新建:
  `compost triage list --kind <kind> --limit N --since <iso>`.
  enum validation 参考现有 `audit.ts` 模式. surface-only (不 mutate facts).
- PM: `wiki.ts synthesizePage` LLM 失败路径除了 `stale_at` 再写一行
  `health_signals` (kind='stale_wiki', target_id=pagePath). 这把 debate 010
  Codex #4 契约落地.
- 测试: CLI test + wiki fallback test 加一个 assertion 验证 `health_signals`
  行写入.
- 依赖: Day 2 scanner 实装.

### Day 4: `ask()` 空结果 wiki 兜底 + `compost doctor --check-llm`
**目标**: 闭合 ROADMAP known-risk row 3 + LLM UX.
- AM: `query/ask.ts:154` 改 `if (hits===0 && wikiContexts.length===0)` 前,
  先按 `question` slug (小写+连字符) 查 `wiki_pages.path` — 若 match, 加载
  该页并把 `stale_at` banner 也带上. 测试覆盖 hits=0 but wiki 命中场景.
- PM: `packages/compost-cli/src/commands/doctor.ts` 扩展 `--check-llm` flag
  — 尝试构造 `OllamaLLMService` + 1-shot `generate("ping")` with 3s timeout,
  report pass/fail/URL. 不自动跑, 避免 hook 副作用.
- 依赖: 无强依赖, 可与 Day 3 部分并行.

### Day 5: Tech debt sweep + dogfood + PR
**目标**: 清 debate 010 backlog 剩余小项.
- `compost audit list` CLI 测试 (30 min)
- `scheduler.ts` 头部 import 整理 (5 min, 顺手)
- schema/0010:82 删 stale TODO 注释 (1 min)
- `archive_reason='superseded'` schema CHECK 收紧 (新 migration 0014) OR
  文档锁定 "reserved, migration 可写但无 producer" (5 min 选后者)
- 手动 dogfood: daemon 启动 → 几条 `compost add` → `compost triage list`
  → `compost audit list` → `compost doctor --check-llm` — 截图 / 日志贴
  PR description.
- 跑全量测试, 开 PR, 按 debate 010 模式 pre-PR 1 轮 code audit.

## 2. 排除项 (本周不做)

- **半开长任务饿死** (Gemini debate 010 #1): 只有**registry 合并后**这个场景
  才真实存在, Day 1 合并, 先观察是否实际踩到. 没踩到 → Week 5 再 design.
- **union signature 重构 → `ILLMProvider.forSite()`**: 触发条件是 "出现
  第 3 种 wrapper". 本周无此计划 (Retry/RateLimit 都非 P0-1 依赖), 推迟.
- **`reconstructConfidenceTier` 浮点阈值**: 触发条件是 "migration 引入计算
  floor". Week 4 schema 没这个需求 (triage 表不带 floor). 推迟.
- **Phase 4 P1** (open_problems / origin_hash / bench / PII): 全部 P1, 与
  P0-1 并行只会 scope creep. 留给 Week 5+ 当独立 batch.
- **`correction-detector.ts:65` correctedText 提取**: 这是"把 correction
  signal 做得更准", P0-5 contract 是 surface-only, "准确提取纠错片段"
  是 Phase 5+ LLM 辅助工作. 本周不碰, 只 stub 返空.

## 3. 风险预警

### R1: Day 1 registry 合并引入 subtle regression
`startMcpServer` 签名加参影响任何尚在 playtest 的外部 harness.
同时, `main.ts` 若 Ollama 未启动, 新 registry 的构造 side-effect 必须
严格为零 (OllamaLLMService ctor 已验证为 no-op, 但 socket ctl server 启动
后如果有其他 import 带副作用就会踩). **缓解**: 加一个 "daemon cold-start
without Ollama" integration test (Day 1 PM 顺便).

### R2: Day 2 triage scanner SQL 可能扫大表
`scanOrphanFact` / `scanStaleCluster` 要 JOIN `facts` + `fact_links` +
`graph_health_snapshot`. 当前 dogfood 数据集小, 但 bench harness 没上
(P1 被我排除了本周). 如果 scanner 在 10k facts 卡 1 秒, triage CLI 体感
差. **缓解**: Day 2 PM 各 scanner 加 `LIMIT 100` cap + 注释说明; 真实
bench 到 Week 5.

### R3: CLI enum drift 重演
`audit list --kind` 和 `triage list --kind` 都是 enum-gated CLI. 如果
triage.ts 的 `TriageSignalKind` 与 schema CHECK 约束不一致, 运行时才会
炸. **缓解**: Day 2 plan-lock 明确"enum 从一处导出": `triage.ts` export
`type TriageSignalKind = typeof TRIAGE_KINDS[number]`, CLI 从 cognitive
导入而非 hardcode.

## 4. Done-definition

Week 4 merge gate (PR 前必清):
- [ ] `triage.ts` 5 个 scanner 全实装, 无 TODO
- [ ] `compost triage list` CLI 可用, 5 个 kind 各有一个 happy test
- [ ] `health_signals` 在 `stale_wiki` 路径真正写入 (code + test)
- [ ] Day 1 registry merge + scheduler integration test land
- [ ] `ask()` hits=0 wiki 兜底有测试覆盖
- [ ] `compost doctor --check-llm` 可用
- [ ] ROADMAP known-risks 表: row 1 (dual registry) 消除, row 3 (wiki empty
      fallback) 消除, 其余 6 项保留
- [ ] 全量测试 >= 296 pass (估算 +10 新测试), 0 fail
- [ ] pre-PR 1 轮 4-way code audit (重复 debate 010 pattern)

## 5. 总评

Day 1 合并 registry 是**先决硬依赖**, 错过这天后面所有 wiki/triage 工作
都会在双 registry 下做二次重工; P0-1 triage + stale_wiki 闭环是本周核心
价值, 其余 backlog 按重要性分批做 Day 3-5, P1 整批留 Week 5.

DONE_R1_011
