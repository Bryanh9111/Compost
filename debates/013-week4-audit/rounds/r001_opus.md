# Debate 013 R1 — Opus (architecture + scan semantics)

## 1. Top 5 缺陷

### D1 (HIGH) `scanUnresolvedContradiction` 实际**永不触发**
`packages/compost-core/src/cognitive/triage.ts:130-155` 的 WHERE 要求
`conflict_group IS NOT NULL AND archived_at IS NULL AND superseded_by IS NULL`.
但 `cognitive/reflect.ts:232-301` 的 `resolveTx` 在**同一事务**里同时
设置: (a) loser `archived_at = datetime('now'), superseded_by = winner,
conflict_group = groupId, archive_reason = 'contradicted'` (`:235-246`),
(b) winner `conflict_group = groupId` (`:244-246`, 不改 archived_at).

结果: 任何 `conflict_group` 非空的行, 要么是 archived loser (被 WHERE 过滤),
要么是 winner (`active_count` 只有 1, `HAVING active_count >= 2` 过滤掉).
→ 扫描器 SQL 恒返回 0 行. 生产中永远不会 insert signal.

真正应该 surface 的是**还没被 reflect 处理的冲突** — 同 (subject, predicate)
不同 object 都 active, 创建过 N 天. 这才是 "reflect 拖延 / 跑挂了" 的信号.
修: 重写 SQL 为
```sql
SELECT f1.subject, f1.predicate, COUNT(DISTINCT f1.object) AS active_objects,
       MIN(f1.created_at) AS oldest
FROM facts f1
WHERE f1.archived_at IS NULL AND f1.superseded_by IS NULL
  AND f1.created_at < datetime('now','-' || ? || ' days')
GROUP BY f1.subject, f1.predicate
HAVING active_objects >= 2
...
```
`target_ref` 用 `contradiction:<subject>/<predicate>`. debate 011 没抓到是因为
contract.md 只 pin 了 scanner 存在, 没 spec SQL. **~30 min 修.**

### D2 (HIGH) `triage()` 在 daemon 路径**永不被调用**
grep 全仓库 `triage\(db`: 唯二 caller 是
`packages/compost-cli/src/commands/triage.ts:49` (`compost triage scan`) 和
测试. scheduler / drain / MCP server **零处调用**. 结果: 5 个 scanner 只在
用户手敲命令时运行; `stale_fact` / `stuck_outbox` / `stale_wiki` / `orphan_delta`
信号永远不会自动出现.

`correction_candidate` 是例外 (correction-detector 在 drain hook 直写), 所以
triage() 聚合它看着像 "signals 自己会来", 遮掩了其他 4 种不会来的事实.

修 (Week 4 范围内可修): 要么 (a) `startReflectScheduler` 在 reflect 后也跑
`triage(db)`, 要么 (b) 文档明说 "signals need manual `compost triage scan`".
推 (a), 大约 10 行代码 + 1 个 test. **~30 min.**

### D3 (MEDIUM) `upsertSignal` 对永不修复的 target 会让 health_signals 无界增长
`triage.ts:56-71` 只去重 unresolved 信号. 但 `resolveSignal` 只 mark resolved,
底层 stuck outbox 行可能永远卡着 (poison pill). 用户每次 resolve 一次 →
下次 scan 又写新行 (测试 `triage.test.ts:368-374` 验证了这个 "正确 surfacing
behavior"). 一年内每日 resolve 一次 poison pill → 365 行 health_signals.

小规模个人工具 OK, 但缺一个"同 target 最近 N 天只写一次" 的软窗口.
修: `upsertSignal` 多查"过去 24h 内是否已写过同 target_ref" (resolved 与否),
有则跳过. **~15 min.** 降到 tech debt 可, 但 Week 5 长跑 dogfood 会踩.

### D4 (MEDIUM) `ask()` hits=0 slug fallback 不 tokenize
`query/ask.ts:135-155` 我 Day 5 加的: `question.toLowerCase().trim()` 做整
字符串 match `title` / `path` / `path.md`. 用户问 "tell me about paris" 不
匹配 "paris.md". 意图是兜底 ROADMAP risk 3, 但只覆盖了 "用户原话==wiki title"
的精确场景.

替代: (a) 取 question 第一 noun phrase (复杂), (b) FTS5 查 `wiki_pages`
title 列 (要额外索引), (c) **Week 5 再做**, 现在加个 TODO 注释说明限制.
偏 (c). ~5 min 加注释. 做 (b) 正解 ~2h.

### D5 (LOW) `doctor --check-llm` 语义检查薄弱
`cli/commands/doctor.ts:46-52`: 只验 `generate("ping")` 不 throw. 如果 Ollama
返回 HTTP 200 含 garbage (debate 007 MockLLM "garbage" mode 场景), doctor
报 `ok:true, sample_response: "<<garbage>>..."`. 用户看到 ok 就以为健康了.

修: success path 加 `if (/^\s*$/.test(answer) || answer.length < 2)` 降级为
`ok: "degraded"`. **~5 min.**

## 2. Tech debt (位置 / 保持成本 / 修复收益 / 触发条件)

### T1 `scanOrphanDelta` 不是 delta, 是 snapshot
`triage.ts:177-199`. 契约名 `orphan_delta` 暗示"vs baseline delta > 5"
(schema 0010:19). 实际扫单个 fact 是否 orphan, 无 baseline 对比. 保持: 用户看
"orphan_delta" 以为涨势提醒, 实际是"orphan 快照". 修: Week 5 引入 baseline
from `graph_health_snapshot`, 算 delta.
触发: Week 5 graph_health_snapshot baseline 稳定后做 (目前只跑了几天,
baseline 无意义).

### T2 `upsertSignal` 无 time window
见 D3. 现在: resolve-then-re-emit 循环. 修: 24h cool-down. 触发:
dogfood 观察到 health_signals > 1k 行.

### T3 `scanner` 无 shared test fixture
6 个 scanner 的 test 各自 `beforeEach` 构造 tmpdir + applyMigrations +
seedSource. 每个测试文件重复 ~30 行. 保持: 新 scanner 加新 describe 都
复制一遍. 修: `test/helpers/scanner-fixture.ts` 共享. 触发: Week 5+
加第 7 / 第 8 scanner 时做.

### T4 `reflect-scheduler.test.ts` 用 `Bun.sleep(40)` + `waitFor` 有 flaky 风险
`packages/compost-daemon/test/reflect-scheduler.test.ts:38-50`. 本机 135ms
通过, CI 慢可能超 2s timeout. 保持: 偶尔 flaky 不报警. 修: inject 时钟
(像 `CircuitBreakerLLM` 的 `now: () => number` pattern) 或改成 "触发
一次 tick + synchronous assert". 触发: CI 首次 flaky.

## 3. 契约偏离

### C1 `contract.md §1` 声称 `scanStaleCluster` — 代码没有这个函数
`debates/011-week4-plan/contract.md:15` 的 table 说 kind=`stale_cluster`
扫 `scanStaleCluster`. 实际**所有 6 kind 都是** `triage.ts:12-18` 那 6 个,
其中 `unresolved_contradiction` 的 scanner 叫 `scanUnresolvedContradiction`,
不叫 `scanStaleCluster`. 写 contract.md 时我 (Opus) 抄错了 debate 002 旧
术语. 修: contract.md:15 纠正为 6 正确的 SignalKind 对应 5 scanner (+
correction_candidate 不 scan). **5 min.**

### C2 ARCHITECTURE.md 没写 `compost triage` CLI
Week 4 land 的 `compost triage scan/list/resolve` 三个子命令 + `--include-
resolved` flag 在 `docs/ARCHITECTURE.md` 完全没提. `compost audit list`
有一行, triage 零行. Week 5 reader 找 "triage 怎么用" 只能读代码. 修:
加一段 "§ CLI inventory" 或在 "Scheduler hook points" 后面补一段 "CLI
surfaces". **10 min.**

### C3 ROADMAP Week 4 声称 `correctedText 注释更新` 但代码注释太长
`docs/ROADMAP.md:130` 说 "`correction-detector.ts:65` 注释更新 per debate
012". 代码 `:65` 注释长达 1 行 200 字符, 多数 linter 会 warn. 不是功能
问题, 是行长风格. 修: 折行成 `//` 多行. **2 min.** 算 tech debt 更合适,
放这里标记 doc 声明匹配实际, 但未审行宽.

## 4. Merge-blocker vs nice-to-have

### Merge-blocker (PR 前必修, ≤ 1.5h 总)
1. **D1** — scanUnresolvedContradiction 重写 SQL. 永不触发的 scanner = 契约
   虚假兑现, 不能开 PR 说 P0-1 完成.
2. **D2** — triage() 在 scheduler 里接一笔或文档明说. 不修 = 信号自动流
   只有 1/5 生效.
3. **C1** — contract.md 误写 scanStaleCluster, PR 审阅者会被误导.

### Nice-to-have (Week 5 补)
- D3 upsertSignal cool-down
- D4 ask slug fallback tokenize
- D5 doctor 语义降级
- T1-T4 全部
- C2 ARCHITECTURE CLI section
- C3 correction-detector 行宽

## 5. 一句话总评

P0-1 形式上 land 了 6 scanner + CLI + 21 tests, 但 `scanUnresolvedContradiction`
SQL 实际永不触发 + `triage()` 没接 daemon 循环两个硬伤让 4/5 signal kind
在生产路径 dead-on-arrival; 修完 D1+D2+C1 (~1h) 再 PR 才对得起 "P0-1 done"
的 commit message.

DONE_R1_013
