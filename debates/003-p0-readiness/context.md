# Debate 003: Phase 4 P0 Implementation Readiness Gate

**决策类型**: Go / Conditional Go / No-Go
**Date**: 2026-04-14
**Predecessor**: debate 002 (roadmap gap audit)
**Branch**: `feat/phase4-batch-d-myco-integration` (commit 8f3100a)

## 当前状态快照

- 11 migrations applied, 156 tests pass, 10 skip (TDD red phase)
- Schema: 0010 (5 P0 tables) + 0011 (fact_links + bug fix + real v_graph_health view)
- TS stubs: triage / audit / graph-health / correction-detector (throw or null)
- ROADMAP: 8 P0 + 4 P1 + 5 P2

## 待审 8 P0

| # | 项 | 估算 |
|---|---|---|
| P0-0 | fact_links + recursive CTE API | M |
| P0-1 | compost triage (5 signals) | M |
| P0-2 | decision_audit + 写入 | M |
| P0-3 | v_graph_health TS + snapshot | S |
| P0-4 | archive_reason 写入 (reflect.ts) | S |
| P0-5 | correction_events 捕获 (hook) | S |
| P0-6 | LLM circuit breaker + abstraction + Self-Consumption guard | M |
| P0-7 | compost backup/restore + cron | S |

## 必读

- `docs/ROADMAP.md`
- `debates/002-roadmap-gap-audit/synthesis.md`
- `packages/compost-core/src/schema/0010_phase4_myco_integration.sql`
- `packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql`
- TS stubs: `packages/compost-core/src/cognitive/{triage,audit,graph-health,correction-detector}.ts`
- 至少一个 RED test: `packages/compost-core/test/triage.test.ts`
- `packages/compost-core/src/cognitive/reflect.ts` (要被 P0-2/P0-4 改)

## R1 输出结构 (≤ 1200 字)

1. **Go/No-Go 投票** (必答, 三选一)
2. **Top 3 实施风险** (概率 × 影响)
3. **P0 顺序最后裁决** (Week 1-4 是否合理)
4. **测试覆盖盲点** (≥ 2)
5. **撤退条件** (≥ 2)
6. **独特视角** (≤ 150 字, 一句话告诫)

## 硬约束

- 严禁生物学隐喻
- 必须读 0010/0011 schema 和 stub 代码
- Go/No-Go 明确 (Conditional 必须列具体条件)
- 风险必须有具体场景
