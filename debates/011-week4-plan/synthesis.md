# Debate 011 — Synthesis (Opus, Week 4 Plan)

3/4 R1 landed (Codex / Sonnet / Opus). Gemini quota-exhausted, no output.

## 共识

| 议题 | Codex | Sonnet | Opus | 共识 |
|---|---|---|---|---|
| Day 1 = BreakerRegistry 合并 | ✓ | ✓ | ✓ | 3/3 |
| P0-1 triage = 本周核心价值 | ✓ | ✓ | ✓ | 3/3 |
| scheduler wiki hook 集成测试 (Day 1-4 某日) | ✓ | ✓ | ✓ | 3/3 |
| `compost doctor --check-llm` 本周可做 | ✓ | ✓ | ✓ | 3/3 |
| Phase 4 P1 四项全部 Week 5+ | ✓ | ✓ | ✓ | 3/3 |
| union signature 重构推迟 | ✓ | ✓ | ✓ | 3/3 |
| half-open 饿死不做实装, 先观察 | ✓ | ✓ | ✓ | 3/3 |
| `correctedText` 提取本周做朴素 substring | ✓ | ✓ | — | 2/3 (Opus 倾向推 Week 5) |

## 关键纠正 (Sonnet 抓到, 我 R1 漏了)

**Prompt §B 写的 signal kinds 与代码不符**. 以**代码为准** (`packages/compost-core/src/cognitive/triage.ts:12-18`):

```ts
"stale_fact" | "unresolved_contradiction" | "stuck_outbox"
| "orphan_delta" | "stale_wiki" | "correction_candidate"
```

(我 prompt 误写成 `stale_cluster / orphan_fact / low_coverage` 等 — 那是 debate 002 早期草案, 已被 migration 0010+0012 CHECK 覆盖).

**Day 1 必须写 `debates/011-week4-plan/contract.md`** pin 死这 6 kind, 否则 Day 2-3 全部返工 migration/CHECK/CLI.

## 最终 Week 4 执行计划 (采纳 Sonnet 节奏 + Opus/Codex 细节)

### Day 1 — 平台地基 + 契约冻结
- T1 (30 min): `main.ts:82` export `llmRegistry`; `startMcpServer(db, registry)` 加参; 删 mcp-server lazy ctor; `main.ts:104` 注入同一份
- T2 (30 min): 写 `debates/011-week4-plan/contract.md`: (a) pin 6 signal kinds per triage.ts:12-18 (b) pin CLI shape `compost triage list --kind <kind> --limit N` (c) pin surface-only (never mutates facts)
- T3 (15 min): `scheduler.ts:1-30` import 整理扫一遍
- 产出: 单 registry + 契约冻结, 后面几天直接用

### Day 2 — P0-1 triage scan Part 1 (2 easiest)
- 实装 `triage.ts:55` (`runTriage`): 只做 `stuck_outbox` + `stale_wiki` 两种最便宜的 scan
  - `stuck_outbox`: `observe_outbox` age > 24h 且未 drain
  - `stale_wiki`: `wiki_pages.stale_at IS NOT NULL` 聚合
- 新建 `packages/compost-core/test/triage.test.ts` (>= 4 case: 每 kind 阳性 + 阴性)
- 各 scanner 加 `LIMIT 100` cap + 注释 (Opus 风险 R2, Sonnet 风险 2)

### Day 3 — P0-1 scan Part 2 + CLI
- 剩 4 scan: `stale_fact` / `unresolved_contradiction` / `orphan_delta` / `correction_candidate` (后者从 `correction_events` 聚合, 最便宜; `orphan_delta` 用 `fact_links` 零入边)
- `resolveSignal()` (`triage.ts:82`) 实装 — 简单 UPDATE status
- CLI: 新建 `packages/compost-cli/src/commands/triage.ts` 仿 `audit.ts`
  - `compost triage list --kind <k> --limit N`
  - `compost triage resolve <id> --by <user|agent>`
  - 注册到 CLI main
- 产出: P0-1 done, 6/6 scan + CLI 可跑

### Day 4 — scheduler integration + doctor --check-llm
- `packages/compost-daemon/test/scheduler.test.ts`: 1ms interval + MockLLM registry, 断言 `wiki_rebuild` audit row 写入 + error mode 下 `stale_at` set (使用 Day 1 合并后的单 registry)
- `compost-cli/src/commands/doctor.ts` 加 `--check-llm` flag: 1-shot `OllamaLLMService.generate("ping")` with 3s timeout, exit code != 0 + 可读 setup hint when fail
- 测试 **必须用 MockLLM**, 不依赖真实 Ollama

### Day 5 — 卫生 sweep + pre-PR audit + PR
- `schema/0010_phase4_myco_integration.sql:82` 删 stale TODO 注释
- `compost audit list` CLI 测试 (enum validation + exit code)
- `ask()` hits=0 查 wiki title slug short-circuit (~20 行, 仅判断, 不做 FTS 重查)
- `correction-detector.ts:65` `correctedText` 朴素版: `content.slice(end, end+200)` + 注释 "TODO Week 5+: semantic extraction"
- 跑全量 `bun test` 要求 >= 295 pass
- **pre-PR 跑 1 轮 4-way code audit** (重复 debate 010 pattern) — 若无 blocker, 直接开 Week 4 PR

## 排除项 (全部 Week 5+)

| 项 | 理由 |
|---|---|
| Phase 4 P1 (open_problems / origin_hash / bench / PII) 4 项 | 非 Week 4 路径依赖; scope creep |
| half-open 长任务饿死 design | Day 1 合并后先观察, 无 incident 别动 |
| union signature → `ILLMProvider.forSite()` 重构 | 触发条件"第 3 种 wrapper"本周不会出现 |
| `reconstructConfidenceTier` 浮点阈值 | 触发条件"migration 引入计算 floor"未到 |
| `archive_reason='superseded'` schema 收紧 | 无 bug report, 5 min 事但无回报 |
| `circuit-breaker.test:179` flaky 调查 | 无新信号, debate 010 已决 "先观察" |
| `correctedText` 语义抽取 | Week 5+ LLM-aided 工作, 本周只做朴素 substring |

## 风险预警

**R1 (HIGH) — 契约漂移**: 本 debate prompt §B 的 signal kinds 过时, 与代码 + migration CHECK 不符. Day 1 必写 `contract.md` pin 以代码为准 (6 kind), 否则 Day 2-3 全返工.

**R2 (HIGH) — P0-1 scope 肿胀**: 每种 scan 都能继续挖 (阈值/自适应/跨表 join). 预设规则: 阈值**写死**在 `TriageOptions`, 不做跨表 join, 每 scan `LIMIT 100`. 这是 "surface-only" 原意.

**R3 (MEDIUM) — Day 1 registry 合并 subtle regression**: `startMcpServer(db, registry)` 签名加参可能影响 playtest harness. 同时 `main.ts` 若 Ollama 未启, 新 registry 构造必须 side-effect 为零 (Ollama ctor 已确认 no-op). 缓解: Day 1 跑全量测试 + manual daemon cold-start smoke.

**R4 (MEDIUM) — "correctedText 扩展"诱惑**: Day 5 这项容易滑坡到 NLP. 强制朴素版 + 注释.

## Done-definition (Week 4 PR merge gate)

- [ ] P0-1 done: triage.ts 6 种 scan + resolveSignal 实装, `compost triage list/resolve` CLI, >= 12 个测试 (每 scan 阳+阴)
- [ ] registry 单例: `main.ts` + `mcp-server.ts` 共享; scheduler integration test land
- [ ] `compost doctor --check-llm` 可跑
- [ ] `ask()` hits=0 wiki 兜底有测试
- [ ] 全量测试 >= 295 pass, 0 fail
- [ ] ROADMAP: P0-1 triage 打勾, Known-risks 表移除 "registry 双实例" 行 + "wiki empty fallback" 行
- [ ] 无新 TODO (除 correction-detector:65 朴素版注释)
- [ ] pre-PR 1 轮 4-way audit 无 blocker

## 总评

Day 1 锁 registry + 6-kind 两份契约是全周的硬依赖; Day 2-3 P0-1 triage 落地是核心产出; Day 4 补 Week 3 遗留的 scheduler 集成覆盖; Day 5 只清最小卫生, P1 四项 + 9 成 debate-010 余项全部推 Week 5.

DONE_011
