# Debate 013 — Phase 4 Batch D Week 4 pre-PR Audit

## 背景

Week 4 Day 1-5 全部 land 在分支 `feat/phase4-batch-d-week4`, 5 commits.
P0-1 triage 功能完整, 准备 pre-PR 最终审查. 全量 315 pass / 0 fail / 3 skip (31 files).

契约参照: `debates/011-week4-plan/contract.md` (6 signal kinds + single registry + CLI shape).

## 5 commits under audit

```
eace98e Day 1  registry 合并 + contract.md + scheduler.ts import 整理
4e3b790 Day 2  scanStuckOutbox + scanStaleWiki + upsertSignal + 11 tests
332865a Day 3  剩 3 scanner + listSignals + compost triage CLI
1b0de8b Day 4  scheduler integration test + compost doctor --check-llm
23decad Day 5  ask() hits=0 wiki slug fallback + CLI validation tests + hygiene
```

## 关键新/改文件

### 新增
- `packages/compost-cli/src/commands/triage.ts` (triage CLI)
- `packages/compost-cli/test/audit-cli.test.ts` (subprocess-based CLI validation)
- `packages/compost-daemon/test/reflect-scheduler.test.ts` (scheduler hook)
- `debates/011-week4-plan/contract.md` (pin 6 kinds + single registry)
- `debates/012-correctedtext-scoping/` (Week 4 vs Week 5 micro-debate)

### 修改
- `packages/compost-core/src/cognitive/triage.ts` (5 scanners + upsertSignal + listSignals + resolveSignal)
- `packages/compost-core/test/triage.test.ts` (21 tests across 5 describe blocks)
- `packages/compost-core/src/query/ask.ts` (hits=0 wiki slug fallback; stderr log on CircuitOpenError)
- `packages/compost-core/test/cross-p0-integration.test.ts` (+Scenario B2: hits=0 wiki)
- `packages/compost-daemon/src/scheduler.ts` (intervalMs test override)
- `packages/compost-daemon/src/main.ts` (传 registry 给 mcp-server)
- `packages/compost-daemon/src/mcp-server.ts` (startMcpServer(db, registry) 签名)
- `packages/compost-cli/src/commands/doctor.ts` (--check-llm flag)
- `packages/compost-cli/src/main.ts` (registerTriage)
- `packages/compost-core/src/cognitive/correction-detector.ts:65` (debate 012 注释)
- `packages/compost-core/src/schema/0010_phase4_myco_integration.sql:82` (TODO 更新)
- `docs/ROADMAP.md` (Week 4 section + Known-risks row 3 resolved)
- `docs/ARCHITECTURE.md` (LLM call sites row 双 registry 改为单 registry)

### 已知推迟 (按 debate 012 / contract.md 排除清单)
- `correctedText` 语义抽取 → Week 5+
- half-open 长任务饿死 → Week 5+ (合并 registry 后观察)
- union signature 重构 → 等第 3 种 wrapper
- Phase 4 P1 (open_problems / origin_hash / bench / PII) → Week 5+

## 审查重点

### 1. 契约兑现 (contract.md vs 代码)
- 6 SignalKind 从 `triage.ts:12-18` 导出, CLI 从这里读, migration CHECK 同步 — 真是单一源?
- 单 registry 真落地? `main.ts` 构造 → `startMcpServer(db, registry)` + `startReflectScheduler(db, { llm })` 都接同一实例?
- 所有 scanner 都 `LIMIT maxPerKind` cap 了?
- surface-only: scanner 有没有意外 mutate facts / fact_links?

### 2. upsertSignal 语义正确性
`upsertSignal` 只去重 **unresolved** 信号. `resolveSignal` 后再 triage, 会写新信号 (代码注释说是 "correct surfacing behavior"). 但测试 `triage P0-1 aggregate + resolveSignal > resolveSignal flips a row to resolved; subsequent triage re-emits for still-stuck target` 验证了 target_ref 产生 2 行 (1 resolved + 1 new unresolved). 生产环境一个 stuck outbox 永远修不好 (e.g. poison pill), 会导致 health_signals 表无限增长吗?

### 3. scanner SQL 正确性
- `scanStaleFact`: `last_reinforced_at_unix_sec < ?` 用 unix time 比较. 但 `importance_pinned` 是 BOOLEAN — `= FALSE` 在 SQLite 里是什么语义?
- `scanUnresolvedContradiction`: `GROUP BY conflict_group HAVING active_count >= 2`. 但 winner 已 `archived_at=null, superseded_by=null`, loser 也一样, 直到 reflect 跑. 如果 conflict_group 只有 1 条 active (winner 已选出但 loser 还没 archive), 会被漏掉吗? 或者 `conflict_group` 只在 reflect 后 set, 所以 active 数 >= 2 恒成立?
- `scanOrphanDelta`: NOT EXISTS 双 join (fact_links + access_log), 单表扫描 facts. 大表 (100k+) 性能?
- `scanStaleWiki`: WHERE `stale_at IS NOT NULL OR last_synthesis_at < ?`. 如果 `last_synthesis_at` 是 NULL (迁移后新建行)? TEXT column NULL 比较会返回 UNKNOWN, 被 WHERE 过滤掉. 是否缺首次 synth 的信号?

### 4. ask() hits=0 wiki slug fallback
- 查 `LOWER(title) = ? OR LOWER(path) = ? OR LOWER(path) = ? || '.md'` — 第三个条件是 `slug + ".md"` 是否永远匹配不到 (slug 可能已经包含 .md)?
- `question.toLowerCase().trim()` — 如果 question 包含空格 ("paris france"), slug 还是 "paris france", 不会匹配 "paris.md". 需要 tokenize?
- 新加入的 wiki 页如果有多个匹配, LIMIT 1 挑哪个 (按 rowid)? 是否非确定性?

### 5. CLI 行为
- `compost triage scan/list/resolve` 3 个子命令齐了? `compost triage scan` 真实用例是什么 (vs. reflect 自动跑)?
- `compost audit list` 有 CLI 测试, `compost triage list` 呢? (subprocess test 里有)
- `--include-resolved` 是新 flag, 文档 ARCHITECTURE.md 没写

### 6. scheduler integration test 真覆盖度
- `reflect-scheduler.test.ts` 3 test 全过, 但每个都用 `Bun.sleep(40)` 或 `waitFor` 等. 快机器可能 flaky?
- "no llm opts" test 断言 `wikiCount.c === 0` — 如果 reflect 本身意外触发 wiki synth (不该发生) 会静默通过吗? 缺反向断言?

### 7. doctor --check-llm UX
- 失败 JSON 输出包含 `error.name, error.message, hint`. 但如果 Ollama 真的 return 200 but garbage, `generate` 不会 throw, 会被判成 ok. 缺 LLM 行为正确性验证?
- 3s timeout 固定, 不可配

### 8. 文档 vs 代码 drift
- ARCHITECTURE.md LLM call sites 表改过 — 所有 site 名对齐 `breaker-registry.ts:20-24`?
- ROADMAP Week 4 section test count 315 对齐?
- debate 011 contract.md 里 `maxPerKind` 默认 100, 代码里 `DEFAULT_MAX_PER_KIND = 100` 对齐?

## R1 任务 (≤ 1200 字)

### 1. Top 3-5 缺陷 (按严重度, file:line)
### 2. Tech debt 清单 (≥ 3) — 位置 / cost / benefit / 推迟触发条件
### 3. 契约偏离 (≥ 2) — contract.md / ARCHITECTURE.md / ROADMAP 锁定 vs 代码
### 4. Merge-blocker vs nice-to-have — 具体可执行
### 5. 一句话总评 (≤ 100 字)

## 硬约束
- 严禁生物学隐喻
- file:line 锚点
- 不重复 debate 002-012 已裁决项
- Merge-blocker 必须可 ≤ 1h 修
- Tech debt 必须包含 cost/benefit

## 参赛者
- Codex (SQL + schema + 并发)
- Gemini (LLM / failure modes)
- Sonnet (KISS + 跨文件 drift)
- Opus (架构 + 终裁 synthesis)

## 输出
写入 `<repo>/debates/013-week4-audit/rounds/r001_<名字>.md`,
末尾 print `DONE_R1_013`.
