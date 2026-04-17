# Debate 015: Compost + Engram 双栈最终发展路线

**Started**: 2026-04-16
**Rounds**: 1 (thorough, 500 words/advisor)
**Mode**: cross-critique
**Advisors**: gemini, codex, sonnet, opus

## Context
- Compost 现状: Phase 0-3 + Phase 4 Batch D Week 4 完成, 318 tests pass, main @ 72ebb77
- Engram 现状: 50 条记忆 (该项目), 35 agent / 15 human / 0 compiled, 权威 handoff fact #5
- 已 pinned 决策 #1: Compost=我知道什么, Engram=我该怎么做, 未来 compost.query 与 engram recall 并行
- 争议起因: 用户发现 Engram v4-v7 roadmap (LLM compile / multi-path recall / embedding / memory graph) 与 Compost L2-L3 + daemon 高度重叠

## 三个方案

### 方案 A (用户原始建议)
Engram 停在 v3.x, 砍掉 v4-v7。v3.4 Engram recall FTS5 miss 时**同步 fallback** 到 compost ask()。

### 方案 B (Opus 修订, 当前倾向)
- 同意砍 v4-v7
- 边界按"触发时机/延迟预算"划而非内容类型: Engram proactive p95<50ms 禁 LLM, Compost on-demand p95=3-10s
- v3.3: recall_miss 日志 + kind-lint 前置校验
- v3.4: Engram→Compost 单向 suggest_ingest (不阻塞 recall)
- v3.5: Compost→Engram 异步回写 (origin=compiled), 物化 LLM 答案, 常查零 LLM 命中
- Engram 永远不同步调 LLM

### 方案 C (独立路线)
Engram 坚持独立发展 LLM 能力, 与 Compost 竞争而非互补。

## 辩论判决点
1. 边界划分: 按内容类型 vs 按触发时机?
2. v3.4 同步 fallback vs 异步 compile 回写?
3. origin=compiled 通道 (当前为 0) 值得复活吗?
4. 双栈真能避免 Engram 重建简化版 Compost?
5. Engram 有独立 LLM 的合法场景吗 (如 Compost 离线降级)?
6. v3.3 kind-lint 该多严?

## 要求
每位请 ≤500 字, 给出 6 个判断点的立场+理由+风险, 结尾给 Engram v3.2/v3.3/v3.4/v3.5 的路线表 + 是否砍 v4-v7 的判决。
