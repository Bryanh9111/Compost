# Debate 022: wiki-only digest 的 insight 塑形

**Topic**: Phase 6 P0 slice 2 Round B 预备
**Style**: quick / 1 round / cross-critique
**Advisors**: gemini, codex, sonnet + claude(opus) moderator
**Started**: 2026-04-17

## 背景

Compost 是个人 KB。Phase 5 已通双向 Engram MCP。Round A 刚落地 `compost digest` selector (deterministic，扫最近 N 天的 new_facts / resolved_gaps / wiki_rebuilds)，dry-run 可用。`digestInsightInput()` 把报告塑形成 `{compostFactIds, content, synthesizedAt}` 喂给 `EngramWriter.writeInsight()`。

## Dogfood 实测

- default `--since-days 7` / `--confidence-floor 0.85`：11 wiki rebuild，0 fact，0 resolved gap
- `--since-days 30`：同上，仍然 0 fact
- `--confidence-floor 0.5 --since-days 30`：冒出 11 条 fact（都压在 0.5-0.85 之间）
- `facts.confidence` schema 默认值 0.8 (migration 0001 line 94)
- `--insight-input` → `null`（wiki-only 不贡献 fact_id）

## 硬约束

1. **Engram 合约**: Compost 写入 `kind=insight` 必须带 `source_trace.compost_fact_ids` (zod `min(1)`, writer.ts:15). R3 写边界校验.
2. **scope=meta + tag=digest** 已约定 (不污染 semantic facts).
3. **人审门槛**: `--push` 手动触发.
4. **S6-2 MCP write transport 第一次活体 dogfood** — 故障归因越简单越好.

## 三条路

### (a) Default floor 0.85 → 0.75
一行改动。匹配 "personal KB digest" 叙事，不碰合约。
- Con：含 exploration-tier 噪声；阈值粗暴覆盖 digest + arbitration 两个场景。

### (b) Wiki-only 合成 synthetic fact_id
`sha1("wiki:"+path)` 作 fake fact_id 塞 compost_fact_ids。
- Con：破坏合约；Engram 溯源/invalidate 失语；技术债进 R3 校验边界。

### (c) Wiki-only 时 Round B skip
`digestInsightInput() === null` → 打印 "no insight-worthy content"。
- Con：wiki-active-but-fact-quiet 的 user (项目作者本人) 长期看不到 push 生效 → dogfood 反馈链延迟。

## 四个子问题

1. (b) 的合约破坏是否被 scope=meta 的 "meta-level notes" 语义豁免？还是说 compost_fact_ids 必须严格是 facts 表行 id？
2. (a) 改默认到 0.75，是否应保留 `--confidence-floor` 覆盖 + 在 CLI help 标注 "digest 语义 != arbitration 语义"？
3. 有没有第四条路？比如 wiki_pages 接一个 `contributing_fact_ids` join (spec 是否有？现状是 `wiki_page_observe` 在 0002 migration)？
4. 决策对 Round B "一次活体 dogfood" 的失败归因复杂度影响多大？

## 期望输出

四方结构化发言 + 最终推荐（接受 split vote，说明 tiebreak rationale）。
