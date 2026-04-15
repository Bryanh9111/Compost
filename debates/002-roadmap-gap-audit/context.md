# Debate 002: Compost Phase 4-6 路线图 Gap 审计

**Topic**: 反向审计当前路线图 (Phase 4 / 5 / 6) 是否有盲点 / 遗漏 / 假设错位
**Date**: 2026-04-14
**Style**: thorough, 2 rounds
**Participants**: Codex (🔴) / Gemini (🟡) / Sonnet (🟠) / Opus (🐙)
**Predecessor**: debate 001 (Myco integration) — synthesis_v2.md

---

## 当前 Compost 状态

- Phase 0-3 完成
- Phase 4 Batch D 骨架已 commit (a83287b on `feat/phase4-batch-d-myco-integration`)
- 8.5K lines TS+Python, 156 tests pass, 10 migrations applied
- migration 0010 创建了: `health_signals`, `decision_audit`, `graph_health_snapshot`, `correction_events` 4 表 + `v_graph_health` view + facts 表三新列

## 必读文件

- `docs/ROADMAP.md` (新版, post-Batch D)
- `docs/ARCHITECTURE.md`
- `packages/compost-core/src/schema/0010_phase4_myco_integration.sql`
- `debates/001-myco-integration/synthesis_v2.md` (上一次裁决)

## 当前路线图

### Phase 4 — Active Learning (weeks 9-12)
**Batch D — Myco P0 (5 项)**: triage / decision_audit / graph_health / archive_reason / correction_events
**Carried from Phase 3**: episodic memory, fact-to-fact links, semantic chunking, memory_procedural
**P1 (after P0)**: open_problems, compression_pressure, shareable export, crawl_queue, inlet provenance, four-layer dashboard
**P2**: semantic cohort, milestone retrospective
**Removed**: ~~curiosity agent~~, ~~gap tracker~~, ~~autonomous crawl~~

### Phase 5 — Multi-Host (later)
- Cross-machine sync, HTTP transport, compost export/import, multi-host concurrency

### Phase 6 — Ecosystem (later)
- Adapters (openclaw/hermes/airi), source types (PDF/code/video), compost relearn, OpenTelemetry

## 辩论核心问题

1. **Phase 4 范围合理吗?** 17 项 / 4 周, P0 排序与隐藏依赖
2. **缺什么? (盲点)** 备份 / 性能基线 / migration 回滚 / observability / LLM 故障 / 隐私 / 增长曲线 / embedding 升级 / UX
3. **Batch D P0 是否完整?** 5 P0 之间的依赖, 测试覆盖
4. **Phase 5/6 假设是否成立?** Multi-host 真有需求? Ecosystem 是否过早?
5. **更大问题** Long-term north star, 与 Engram 边界, 开源策略, LLM 模型替换风险

## 硬约束

- 不重新辩论 Myco 那 10 候选 (已裁决)
- 必须读 ROADMAP.md 和 0010 migration, 不许凭空批评
- 每个盲点必须有具体场景, 不许 "应该考虑安全" 这种空话
- Reject 必须给替代

## R1 输出结构 (≤ 1500 字)

1. **Top 5 盲点** (按严重度) — 每项: 描述 / 触发条件 / 影响 / 最小修复 / Phase
2. **P0 顺序与依赖图** — 5 个 P0 实施顺序 + 跨依赖
3. **应该砍掉/降级的** (≥ 2 项) — cargo cult / 过度工程
4. **应该新增的** (≥ 2 项) — 路线图完全没提的硬需求
5. **独特视角** (≤ 200 字) — 一个长期风险
