# Debate 013 R1 — Sonnet (KISS + 跨文件 drift)

Avoiding duplication: Opus 已占 D1 (`scanUnresolvedContradiction` SQL 恒 0)、
D2 (`triage()` 不在 daemon 路径)、C1 (`scanStaleCluster` 名)、C2 (ARCHITECTURE
缺 CLI 段). Gemini 已占 slug 多词失配、`scanStaleWiki` NULL、doctor sanity.
本轮专攻文档谎言 + 命名漂移 + KISS 冗余.

## 1. Top 5 defects

### D1 (HIGH) ROADMAP.md 仍写 "5 signal kinds" — 与 contract + 代码冲突
`docs/ROADMAP.md:168` P0-1 cell: `(5 signal kinds, surface-only)`.
contract.md:5-21 + `triage.ts:12-18` 都是 6 种. 同文件 :128 另说 "6
`SignalKind` values", 自相矛盾. 会让外部 reader 拿 :168 当 authority.
**Merge-blocker, 5 min**: 改 :168 "5 → 6".

### D2 (HIGH) 两处代码注释 + 迁移头都谎称 "5 kinds"
- `packages/compost-cli/src/commands/triage.ts:46`: scan 子命令 description
  `"scan the 5 signal kinds"` — CLI `--help` 输出对用户说谎.
- `packages/compost-core/src/schema/0010_phase4_myco_integration.sql:5`: 头注释
  `"5 signal kinds, no auto-execute"` — 0012 已补到 6, 0010 header 没跟进.
- `packages/compost-core/src/cognitive/triage.ts:313`: `"Day 2-3 scope: 5
  active scanners run"` — 技术上对 (correction 是 drain-hook 直写) 但读者看到
  "5" 会与 "6 SignalKind" 疑惑. 应写 "5 scanners + 1 drain-hook producer = 6
  kinds". **Merge-blocker, 10 min**: 统一口径.

### D3 (HIGH) ARCHITECTURE.md LLM call sites 表 file:line 锚点全部过期
`docs/ARCHITECTURE.md:244` 写 `query/ask.ts:35 llm.generate`, 实际
`ask.ts:36` (expandQuery 内); `:245` 写 `query/ask.ts:152 llm.generate`,
实际 `ask.ts:200` (Day 5 插入 slug fallback block 导致行号下移 ~48 行).
`:243` 写 `cognitive/wiki.ts:86`, 需复核. 表头承诺 "inventory at lock time",
但 Day 5 改动没同步更新. 文档撒谎 = PR 审阅者按锚点读错地方.
**Merge-blocker, 15 min**: grep `llm.generate` + `llmOrRegistry` 对齐所有锚.

### D4 (MEDIUM) `ask.ts:148` 第二个 WHERE 子句是死代码
```sql
WHERE LOWER(title) = ? OR LOWER(path) = ? OR LOWER(path) = ?
```
第 1 参数 = slug, 第 2 参数 = slug, 第 3 参数 = slug + ".md".
`LOWER(path) = ?` (raw slug, 无 .md 后缀) 几乎**永不命中** — `wiki.ts`
生成的 path 永远 `<slug>.md`. 留着是 KISS 违反 (读者疑惑 "为何同 column
查两次?"). 要么删中间条款, 要么注释说明 "legacy no-extension paths".
~5 min. Gemini D1 已提 tokenize 主问题; 这是 review-quality 冗余.

### D5 (MEDIUM) `resolvedBy` 类型签名含 `auto-cleared`, 无 producer 无 CLI 入口
- `triage.ts:420`: `resolvedBy: "user" | "agent" | "auto-cleared"`
- `triage.ts CLI:36`: `VALID_RESOLVERS = new Set(["user", "agent"])` — 拒绝
  auto-cleared
- `0010:28`, `0012:26` schema 注释提到 `auto-cleared` 但 CHECK 无约束
- 全仓库 0 个 caller 传 `"auto-cleared"`
与 `profile_switch` 未使用 variant (ROADMAP known-risks row 6 已登记) 同构的
dead enum. 但这次没被登记. **Tech debt**, 见 §2.

## 2. Tech debt (>= 3)

### T1 `auto-cleared` dead enum 扩散 3 处
位置: `triage.ts:420` (type), `0010:28` / `0012:26` (注释).
- Cost of keeping: 每个 reviewer 遇到都要问 "谁写这个?"; 加 CHECK 约束时
  需决定是否允许; type narrows 空占一位.
- Benefit of fixing: 删掉 = 契约清晰, 或加 "reflect auto-clear loop" producer
  (超 Week 4 scope, 入 Week 5+).
- 推迟触发: Week 5 如 reflect 要加 "stuck_outbox quarantined 后自动 resolve
  对应 signal" 的自动清理路径, 那时用起来; 否则删.

### T2 `orphan_delta` 扫的是 snapshot 不是 delta (命名骗局)
位置: `triage.ts:226-264` + schema `0010:19` "new orphan facts vs baseline > 5".
Opus T1 已指出. 我加一条: 命名漂移层 — 既叫 `_delta` 就该是 delta 语义,
kind 名和行为不符是契约谎言.
- Cost: 用户拿 `compost triage list --kind orphan_delta` 以为看 "最近涨的",
  实际是"当前 orphan 清单"; 做告警规则会配错阈值.
- Benefit of fixing: 或改名为 `orphan_fact` (准确), 或 Week 5 真做 delta.
- 推迟触发: `graph_health_snapshot` baseline 满 7 天稳定后做 delta 实现.

### T3 Week 4 测试数超出 contract 目标 20 项, 无 call-out
contract.md:77 目标 `>= 295 pass`, Day 5 结束 315 pass. +20 项: triage.test.ts
21 (原计划 12), audit-cli.test.ts 9, reflect-scheduler.test.ts 3, cross-p0
+1. 超配本身 OK, 但契约 "merge gate" 没说 "≤ 上限", 没记录**为什么超**.
- Cost: 未来 Week 5 target 定多少无参考基准; 新人不知哪些是 contract
  必备、哪些是溢出.
- Benefit of fixing: `debates/011-week4-plan/contract.md` 加一段 "Actuals
  (2026-04-15 close): 315, reasons for overshoot".
- 推迟触发: Week 5 plan 审计时顺手补.

### T4 `triage.ts` CLI 与 core 用相对路径跨包 import
`packages/compost-cli/src/commands/triage.ts:5,11`:
`"../../../compost-core/src/..."`. 与 `doctor.ts:5` 同模式. 非 workspace
protocol (`@compost/core`). 重构 package 或抽提 shared lib 时**每处都要改**.
- Cost: 每次 cross-package refactor 要批量改路径.
- Benefit: 改 workspace `exports` + `"compost-core": "workspace:*"`,
  ~1 次重构收尾.
- 推迟触发: 增加第 5+ cross-package import 文件, 或 pnpm workspace 正式化时.

## 3. Contract drift (>= 2)

### CD1 ROADMAP 计数说谎 (D1) + ARCHITECTURE 锚点过期 (D3)
已在 §1 展开. 根因: Day 5 hygiene sweep 改代码没回写 doc 锚点; P0-1 表
cell 从 Week 3 粘贴后没更新.

### CD2 contract.md:77 "no new TODOs except correction-detector.ts:65"
实际 Week 4 新增 TODO 位置需 spot-check. grep `TODO\|FIXME` 在 5 commits
diff 内的新增是否仅 :65 一处? (prompt 未给全量 diff, 留给 final 裁决者
确认.) 若发现新 TODO 未在 contract 豁免清单, 则是 contract 违约.
**Nice-to-have**, 5 min grep 可验.

### CD3 ARCHITECTURE.md:246 "compost doctor --check-llm is a Week 4 deliverable"
已 Day 4 交付, 文档仍用 future-tense. 文档历史状态未更新.
**Nice-to-have, 2 min**: 改为 "shipped Week 4 Day 4".

## 4. Merge-blocker vs nice-to-have

### Merge-blocker (合计 ~30 min, 全部 ≤ 1h)
1. **D1** — `ROADMAP.md:168` "5 → 6 signal kinds". 5 min.
2. **D2** — 三处 "5 kinds" 字样统一: `triage.ts CLI:46` + `0010:5` +
   `triage.ts:313`. 10 min.
3. **D3** — ARCHITECTURE.md LLM call sites 表重新锚 file:line
   (`ask.ts:36` / `ask.ts:200` / 复核 `wiki.ts:86`). 15 min.

这三项都是**文档/注释与代码不一致**, 非功能缺陷, 但合并时打脸"Week 4 close"
声明. Opus 的 D1+D2+C1 (功能层) + 我的 D1+D2+D3 (文档层) 合计 <2h, 可并
作一次 cleanup commit.

### Nice-to-have (Week 5)
- D4 `ask.ts:148` 死 SQL 条款
- D5 + T1 `auto-cleared` dead enum
- T2 `orphan_delta` 命名 (等 graph_health baseline)
- T3 contract 补记 actuals
- T4 workspace import 重构
- CD2 TODO grep 抽查, CD3 future-tense 改 past

## 5. 一句话总评

功能代码质量高, 但 Week 4 的 doc/注释/契约表面留下至少 4 处 "5 signal kinds"
谎言 + 2 处过期 file:line 锚点, 30 分钟就能扫清, 不清零不配开 PR 标 "P0-1
complete".

DONE_R1_013
