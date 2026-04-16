# Debate 013 — Synthesis (Opus, Week 4 pre-PR)

4/4 R1 landed. Findings decompose cleanly into **functional blockers** (5
items, must fix) + **doc-drift blockers** (4 items, for integrity) +
**tech debt** (Week 5+).

## 共识矩阵

| # | 议题 | Opus | Codex | Gemini | Sonnet | 层级 |
|---|---|---|---|---|---|---|
| F1 | `scanUnresolvedContradiction` SQL 恒 0 行 | D1 | — | — | (避让) | 功能 |
| F2 | `triage()` 在 daemon 路径不被调用 | D2 | — | — | (避让) | 功能 |
| F3 | `orphanDeltaThreshold` 参数未接线, 误用 `staleFactDays=90` | — | #1 | — | — | 功能 |
| F4 | `resolveSignal` 对 missing/already-resolved id 假成功 | — | #2 | — | — | 功能 UX |
| F5 | `ask()` hits=0 slug 不 slugify, 多词失败 | D4 (tech debt) | — | D1 (blocker) | (避让) | 功能 |
| F6 | `scanStaleWiki` 漏 NULL `last_synthesis_at` | — | — | D2 | — | 功能 (1 行修) |
| D1 | ROADMAP + 3 处代码注释仍写 "5 signal kinds" | — | CD3 | — | D1/D2 | 文档 |
| D2 | ARCHITECTURE.md LLM call sites file:line 过期 | — | — | — | D3 | 文档 |
| D3 | contract.md:15 误写 `scanStaleCluster` | C1 | — | — | (避让) | 文档 |
| D4 | ARCHITECTURE.md 无 CLI inventory (triage/audit) | C2 | — | — | — | 文档 |
| TD | orphan_delta 命名骗局 (snapshot 非 delta) | T1 | #3 | — | T2 | tech debt |
| TD | resolveSignal 无 TTL / health_signals 无界增长 | D3 | T1/T2 | — | — | tech debt |
| TD | `auto-cleared` dead enum | — | — | — | D5/T1 | tech debt |
| TD | reflect cadence 未 UTC 对齐 | — | #4 | — | — | tech debt |

## 终裁 — Merge-blocker (≤ 2h 总)

按依赖/效率排序:

### 功能层 (5 项, ~1h)

1. **[F3, 5 min] 接好 `orphanDeltaThreshold` 参数**
   `triage.ts` `triage()` 当前用 `opts.staleFactDays ?? 90` 作 orphan 窗口;
   应使用 `opts.orphanDeltaThreshold` (默认 5)**或**新增 `orphanAccessDays`
   (默认 30) 以匹配 contract.md table 语义 "no access in last 30d". 修:
   `triage.ts:323-331` 改回 `opts.orphanDeltaThreshold ?? 30` 并在 interface
   注释里明确单位是"天".
   Codex 正确指出 scanner 单测用的 30 没经过 `triage()` 默认路径.

2. **[F1, 30 min] 重写 `scanUnresolvedContradiction` SQL**
   当前 WHERE 要求 `conflict_group IS NOT NULL AND archived_at IS NULL` —
   reflect.ts 在同一事务内设 `conflict_group + loser.archived_at + winner
   conflict_group` 所以 `HAVING active_count >= 2` 永不满足. 改为按
   `(subject, predicate)` 分组找 **reflect 尚未处理** 的冲突:
   ```sql
   GROUP BY subject, predicate
   HAVING COUNT(DISTINCT object) >= 2
      AND created_at < datetime('now','-? days')
   ```
   target_ref 改 `contradiction:<subject>/<predicate>`. 测试相应 retrofit.

3. **[F2, 30 min] 把 `triage()` 接到 `startReflectScheduler` 成功路径**
   reflect 后、wiki synth 前（或并行）跑一次 `triage(db)`. try/catch
   包裹 (triage 错不能拖垮 scheduler cadence). Day 4 测试模式复用.
   否则 5 signal kind 里只有 `correction_candidate` 自动出现, 其余 4 种
   完全不工作.

4. **[F5, 15 min] `ask()` hits=0 fallback 用 wiki.ts 同款 slugify**
   `ask.ts` 从 `wiki.ts` 抽取 slugify helper (或 copy regex
   `topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")`)
   对 question 做同样转换. 多词 "Paris France" → `paris-france.md` 可命中.

5. **[F4, 10 min] `resolveSignal` 返回 affected rows + CLI 非 0 退出**
   `resolveSignal(db, id, by)` return `boolean` (基于 `db.run().changes`).
   CLI 里: `if (!resolved) { stderr "signal id ... not found or already
   resolved"; process.exit(1); }` 避免假成功消息.

### 文档层 (4 项, ~45 min)

6. **[D3 + D1, 15 min] "5 / 6 signal kinds" 口径统一**
   - `contract.md:15` 的 `scanStaleCluster` 改为 6 正确 scanner 名
   - `docs/ROADMAP.md:168` "5" → "6"
   - `packages/compost-cli/src/commands/triage.ts:46` CLI description
   - `packages/compost-core/src/schema/0010:5` header 注释 (或 just
     "6 signal kinds (0010 original 5 + 0012 correction_candidate)")
   - `triage.ts:313` 改为 "5 scanners + 1 drain-hook producer = 6 kinds"

7. **[D2, 15 min] ARCHITECTURE.md LLM call sites 重新锚 file:line**
   - `:243` `wiki.ts:86` → 实际 `:92` (debate 009 Fix 3 后)
   - `:244` `ask.ts:35` → `:36` (expandQuery)
   - `:245` `ask.ts:152` → `:200` (Day 5 插入 slug fallback 后下移)
   或改成 **函数名锚点** (`ask.ts expandQuery llm.generate`) 一次性解决.
   Sonnet D3 建议函数名方案, 采纳.

8. **[D4, 10 min] ARCHITECTURE.md 加 CLI inventory 小节**
   列 `compost audit list / triage scan/list/resolve / doctor --check-llm`
   + 简要 exit code 契约. Reader 不用 grep 源码找用法.

### Quick 1-line 修 (顺手, 5 min)

9. **[F6, 5 min] `scanStaleWiki` NULL 保护**
   `triage.ts:241` WHERE 改为
   `WHERE stale_at IS NOT NULL OR last_synthesis_at IS NULL OR last_synthesis_at < ?`.
   新建 wiki_pages 行没 synth 过的情况能被 surface.

## 不阻断 Merge (Week 5+)

| 项 | 源 | 触发 |
|---|---|---|
| `orphan_delta` 真做 delta (vs baseline) | 3/4 | `graph_health_snapshot` baseline 满 7 天 |
| `upsertSignal` 24h 冷却窗口 | Opus D3 + Codex T2 | 观察到 health_signals 增长异常 |
| `auto-cleared` dead enum 清理 | Sonnet D5 | reflect 加自动清理 producer 或 Week 5 删 |
| `doctor --check-llm` 语义/sanity check | Gemini D3 | 观察到 Ollama 坏行为但 200 OK |
| `ask.ts:148` 死 SQL 条款 | Sonnet D4 | F5 slugify 修完后重构该 SQL |
| reflect cadence UTC 对齐 | Codex #4 | Week 5 scheduler audit |
| workspace `exports` 重构 | Sonnet T4 | 第 5+ cross-package import 出现 |
| contract.md 补 actuals 超配记录 | Sonnet T3 | Week 5 plan 时 |
| CLI `triage scan` 输出默认 summary | Gemini D4 | 用户 >100 signals 时踩 |

## 分歧 (已裁决)

- **Opus D4 vs Gemini D1 对 ask slug fallback**: Opus 初判 tech debt (限制范围
  + Week 5 FTS 方案), Gemini 判 merge-blocker (多词就坏). 裁决: **Gemini 正确**
  — Day 5 声明 "Known-risks row 3 resolved" 但多词 question 不匹配, 是功能
  regression. 15 min 加 slugify helper 可修, 不做 FTS. 归 merge-blocker F5.
- **Opus D3 vs Codex T1+T2 对 upsertSignal 无界增长**: 一致为 tech debt, 非
  blocker. 推 Week 5, 观察期.

## 执行顺序

```
1. F3  (5 min)  orphanDeltaThreshold wiring
2. F6  (5 min)  scanStaleWiki NULL
3. F1  (30 min) scanUnresolvedContradiction SQL 重写 + test
4. F2  (30 min) scheduler -> triage() + test
5. F5  (15 min) ask slug helper
6. F4  (10 min) resolveSignal 返回值 + CLI exit
7. D3 + D1 (15 min) 统一 "6 kinds" 口径
8. D2  (15 min) ARCHITECTURE 函数名锚点
9. D4  (10 min) ARCHITECTURE CLI inventory
10. bun test 验证 >= 320 pass / 0 fail
11. 一次性 commit: "apply 9 fixes from debate 013 pre-PR audit"
12. 开 PR + squash merge
```

预计总耗 **~2h**.

## 总评

Week 4 功能实装形式完整 (6 scanner + CLI + 21 tests), 但 **3 个 scanner
行为未兑现契约** (scanUnresolvedContradiction SQL dead / orphan_delta 参数
错线 / triage 不自动跑), 加 ask hits=0 多词失配, 合计 5 功能 blocker;
另有 4 处"5 vs 6 signal kinds"文档撒谎需统一. 2h cleanup 后可开 PR 且
诚实标注 "P0-1 done".

DONE_013
