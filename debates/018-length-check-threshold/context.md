# Debate 018: length(content) CHECK 阈值

**Date**: 2026-04-16
**Scope**: v3.3 migration 的 `CHECK(length(content) <= N)` 该设多少
**Participants**: Opus 4.7, Codex, Sonnet (Gemini 配额耗尽)
**Rounds**: 1

## 触发

Step 0 audit 发现：
- 现有 471 active + 4 resolved 记忆
- **7 条 >2000 字（6 条 pinned）**
- 这 7 条都是用户/AI 近期写的正当记忆：
  - 3468: Athena EOD handoff (procedure)
  - 3466: Debate 016 roadmap v2 (decision)
  - 2375: Debate 016 roadmap v2 engram 镜像 (decision)
  - 2163: Compost v2.2 spec finalized (decision)
  - 2153: Athena P0-1 DrawdownMonitor wire (fact)
  - 2129: Engram 最终形态 v2 (decision)
  - 2062: Compost session-handoff (fact)

debate 016 共识写的是 `CHECK(length(content) <= 2000)`，但当时没有 audit 数据。
现在数据出来，真实使用场景里 1-2% 记忆会超标，且都是**高价值** session handoff / debate outcome / spec。

## 4 个选项

### A. 放宽 CHECK 到 `length ≤ 4000`
- 最简单，现有数据全过
- 放弃 debate 016 的 2000 硬约束
- 风险：口子开大了，未来更大的记忆会爬进来

### B. 保持 2000 CHECK，7 条 migration 时被拒
- 严格遵守 debate 016
- 需要人工拆分或移到 archive
- 风险：丢失信息（如果 truncate）或阻塞 migration（如果人工拆）

### C. 保持 2000 CHECK + 一次性 truncate + 移到独立 archive 表
- 中间路线
- 保留原文到 archive 表，主表只存 2000 前缀
- 复杂，需要新 `memories_archive` 表 + 查询路径

### D. 临时放宽到 4000 + migration-plan.md TODO
- 同 A 但有文档承诺未来拆分
- 在 10 年时间尺度上和 A 等价（TODO 永远是 TODO）

## 三个核心问题

### Q1: 2000 字这个阈值从哪来？debate 016 的依据？
查 debate 016 synthesis 找不到具体推导。可能是拍脑袋，或借鉴某个其他系统。**如果没有硬证据，阈值本身可议。**

### Q2: session handoff / debate outcome 这类长记忆是 anti-pattern 吗？
两种立场：
- **是**: 应该拆成多条小记忆，Engram 是便条夹不是 wiki。handoff 属于 Compost session。
- **否**: 这类记忆本质上就需要整块读取（拆开就失去 context），是 Engram 的合法用例。

### Q3: 长度 CHECK 应该 kind-specific 吗？
- `fact` / `guardrail`: 天然短（一个约束、一个事实）→ 500 字够
- `decision`: 需要解释选择理由 → 1500 字
- `procedure`: 步骤列表可能长 → 3000 字
- `constraint`: 中等 → 800 字

vs. 一刀切 N 字：简单但牺牲表达力。

## 输出契约

每方对 4 个选项（A/B/C/D）给一个排序（1 最优 → 4 最差）+ 一句话理由。
对 Q1/Q2/Q3 给立场。
最后给 **最终推荐方案**（可以是 A/B/C/D 之一，也可以提新方案 E）。

共识规则：如果 3 方（Opus + Codex + Sonnet）排序第一的是同一个选项 → 采纳。否则看 Top 2 重叠 + 综合权重。
