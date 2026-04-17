# Debate 010 — Week 3 + Day 4 Cumulative Code Audit

## 背景

Phase 4 Batch D Week 1-3 + Day 4 全部 land, 准备 pre-PR 最终审查.
分支: `feat/phase4-batch-d-myco-integration`.

## 审查范围

**已 committed** (9 commits, 最新 fe7849f):
- P0-0 fact_links (Week 1)
- P0-4 archive_reason + replaced_by_fact_id (Week 1)
- P0-7 backup/restore + scheduler (Week 1)
- P0-3 graph-health snapshot (Week 2)
- P0-5 correction_events (Week 2)
- P0-2 decision_audit wiring + compost audit CLI (Week 3)
- P0-6 CircuitBreakerLLM + MockLLMService + BreakerRegistry + Self-Consumption (Week 3)
- 先前 debate 003-008 的各种 fix

**未 committed** (本次审查主体):
```
M docs/ARCHITECTURE.md                                 (文档状态 update)
M docs/ROADMAP.md                                      (Week 1-3 progress + 8 风险表)
M packages/compost-core/src/cognitive/reflect.ts       (audit try/catch isolate)
M packages/compost-core/src/cognitive/wiki.ts          (audit try/catch + union signature)
M packages/compost-core/src/llm/circuit-breaker.ts     (half-open concurrent probe throw)
M packages/compost-core/src/query/ask.ts               (union signature + per-site breaker)
M packages/compost-core/test/circuit-breaker.test.ts   (更新测试 for 新 half-open 语义)
M packages/compost-daemon/src/main.ts                  (daemon-boot BreakerRegistry)
M packages/compost-daemon/src/mcp-server.ts            (per-server lazy registry)
M packages/compost-daemon/src/scheduler.ts             (startReflectScheduler 新 opts, wiki hook)
?? packages/compost-core/test/cross-p0-integration.test.ts (Day 4, 3 tests)
```

**测试状态**: 286 pass / 0 fail / 3 skip (29 files).

## 审查重点

### 1. 009 四修之后是否又产生新的 contract drift
- Fix 1 (union signature): `ask.ts:62` 和 `wiki.ts:207` 同时用 `LLMService | BreakerRegistry`. `instanceof` 分派. 坑?
- Fix 2 (scheduler wiki hook): `startReflectScheduler` 新签名, `main.ts` 唯一 production caller 改了, test caller 没检查
- Fix 3 (audit try/catch): reflect 推 `report.errors`, wiki 用 `console.warn`. 两处不一致 — 问题?
- Fix 4 (half-open throw): 并发 caller 拿 CircuitOpenError. 但测试 `circuit-breaker.test.ts:179-224` 用 setTimeout(30) 模拟延迟 — 真实 Ollama P99 100-500ms, 测试能反映真实并发行为吗?

### 2. Day 4 cross-P0 测试的覆盖真实性
- 3 个 scenario 全部用 `MockLLMService`. 没测 Ollama 真实 502/timeout 的行为
- Scenario B 的 breaker 用 `minFailures: 1, failureRate: 0` — 为了快速 trip. 但 production 是 `min=3, rate=0.5`. 测试能发现 prod 参数下的 race 吗?
- Scenario A 的 reflect idempotency 测了. 但 `addLink` 的 `reinforceIfExists: true` 默认会 bump `observed_count` — 二次 reflect 真的不重复还是只是 edge 数量相同?
- **缺**: scheduler.ts startReflectScheduler wiki hook 的集成测试. `main.ts` 的 daemon-boot BreakerRegistry 没有端到端验证

### 3. union signature (LLMService | BreakerRegistry) 的设计债
- `ask.ts:73-82` 和 `wiki.ts:213-218` 各做一次 `instanceof BreakerRegistry` 分派. 如果未来要加 RetryWrapperLLM 或 RateLimitedLLM, 这两处都要改
- 参数命名 `llmOrRegistry` 反映了这是 hack 而非 design
- 替代方案: (a) 把 BreakerRegistry 改成 implements LLMService (代理默认 site?) (b) 提取 `ILLMProvider.get(site)` 接口 (c) 强制 caller 提前 `.get(site)` 再传进来
- **问题**: 3 种替代都有代价. 当前 `instanceof` 是不是真的最小代价选择?

### 4. 文档 vs 代码 drift
- ARCHITECTURE.md line 280 说 `startReflectScheduler` 接受 `{ llm, dataDir }` — 对上了
- ROADMAP 风险表提到 "wikiContext drops when hits.length===0" (ask.ts:155) — 代码里没 comment 标记
- ROADMAP 风险表第 5 行 "reconstructConfidenceTier float equality" — audit.ts 代码里也没 comment 说明为什么现在安全
- LLM call sites 表 line 242 现在指向 `mcp-server.ts:52` 但真实代码 `mcp-server.ts` 有多少行? 更新了没?
- `archive_reason` 'superseded' 仍然 ⏳ reserved — 真的没用还是 reflect.ts 某条路径已经写了?

### 5. P0-0..P0-7 锁定契约未兑现清单
对照 debate 007/008 lock 锁:
- Lock 1 evidence_refs_json shapes — code 匹配? 特别是 `fact_excretion` 未实现但 `EvidenceRefs` union 已声明
- Lock 2 reflect step 2 NO audit — 已验证
- Lock 3 confidence_floor tier — code/schema 对齐?
- Lock 4 circuit breaker params (60s/30s/3/0.5) — 对齐
- Lock 5 Self-Consumption regex — 仅 Unix path; Windows 漏是 accepted risk
- Lock 6 fallback contract (LLM call sites 5 行表格) — 每行都 wire 了?
- Debate 008 Q5 `wiki_rebuild` evidence 用 `input_fact_ids` — wiki.ts 代码匹配

### 6. Pre-PR gates 之外的漏洞
- 286 tests pass 但 `compost-daemon` 启动路径**没**集成测试 (startDaemon() 这个函数本身没 happy path test)
- `main.ts` 新的 BreakerRegistry 如果 Ollama 未运行, 首次 `ask()` 会怎样? Breaker 会 trip? 用户体验?
- `mcp-server.ts` 的 `llmRegistry` 是 closure 变量, daemon restart/reload (通过 socket) 时它会保留吗? 还是被垃圾回收?
- 迁移顺序: 0010-0013 同一 session 应用. 回滚 (compost restore 到 P3 快照) 会怎样?
- CLI coverage: `compost audit list` 有 happy test 吗? invalid enum test 呢?

## R1 任务 (≤ 1200 字)

### 1. Top 3-5 缺陷
按严重度排列. file:line 锚点. 为何 debate 009 漏了. 修复建议.

### 2. Tech debt 清单 (≥ 3)
每项: 位置 / cost 保持 / benefit 如果还 / 推迟到何时 OK.

### 3. 契约偏离 (≥ 2)
ROADMAP/ARCHITECTURE.md 锁定 vs 代码实际不符的.

### 4. Merge-blocker vs nice-to-have
具体可执行. blocker 是 "不修不能开 PR"; nice-to-have 是 "Week 4 可以补".

### 5. 一句话总评 (≤ 100 字)

## 硬约束
- 严禁生物学隐喻
- file:line 锚点
- 不重复 debate 003-009 已裁决项
- Merge-blocker 必须具体
- Tech debt 必须包含 cost/benefit

## 参赛者
- Codex (schema/SQL/并发)
- Gemini (LLM 失败模式/安全)
- Sonnet (KISS/跨文件 drift)
- Opus (架构 + 终裁 synthesis)

单轮 focused R1 + Opus synthesis.

## 输出
写入 `<repo>/debates/010-week3-day4-audit/rounds/r001_<你的名字>.md`,
末尾 print `DONE_R1_010`.
