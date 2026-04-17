# Debate 020 — Phase 5 Session 4 切片决策

**Debate ID**: 020-phase-5-session-4-slicing
**Rounds**: 1 (quick)
**Mode**: cross-critique
**Advisors**: gemini, codex, sonnet, claude-opus
**Started**: 2026-04-17T18:29:23Z

## Question

Compost Phase 5 Session 4 (~150-600 LoC 单次可 ship) 应选 A/B/C/D/E 中哪个切片?

## Context snapshot

- Compost main @ 96f2960 (374 tests, clean). Phase 4 shipped, Phase 5 unblocked.
- Engram main @ ea223fa — MCP tools live: `stream_for_compost`, `invalidate_compost_fact`, `remember(origin='compost')`.
- 契约不变量: append-only; 2000-char per entry; origin='compost' schema-enforced; expires_at MANDATORY default=synthesized_at+90d; pinned origin=compost 也被 invalidate; stream 默认排除 origin=compost 防回环.
- 全 scope ~500-800 LoC 跨多 session: Migration 0015 三表 (user_patterns + user_pattern_observations + user_pattern_events) + `packages/compost-engram-adapter/` 四模块 (splitter / pending-writes / stream-puller / writer).

## Options

| # | 切法 | LoC |
|---|---|---|
| A | Schema-only thin slice (Migration 0015 + 空骨架 pkg) | ~150 |
| B | Write-path vertical (Migration 0015 + splitter + pending-writes + writer) | ~350 |
| C | Full vertical happy path (Migration 0015 + 四模块最小版 + 测试) | ~500-600 |
| D | Read-path first (Migration 0015 + stream-puller + ingest adapter) | ~350 |
| E | Splitter-only isolated (只 splitter.ts + exhaustive 边界 suite) | ~200 |

## 辩论焦点 (必答)

1. 先 write 还是先 read? Compost→Engram 回填 vs Engram→Compost 摄入哪边价值/风险更大?
2. Migration 0015 是否本 session 必须做? (与 adapter 无直接耦合, Phase 7 依赖)
3. Splitter-only (E) 是过度拆分还是明智风险隔离?
4. 500-600 LoC (C) 单 session 对 Compost 纪律项目是否太激进? 前 sessions 普遍 200-400 LoC.
5. pending-writes.db 是否该跟 writer 一起落 (B), 还是独立设计?

## 决策约束

- User guardrail: decision surface > execution speed, 每步 3+ options, 不只给最优解.
- Anchor v2: 双向核心非 opt-in, Substrate↔Effector; Phase 5 是首次跨系统写入.
- 前 sessions 实际 LoC: ~50-500 区间, 中位 ~400.
