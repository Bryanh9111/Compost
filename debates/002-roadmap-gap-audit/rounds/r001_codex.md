## 1. 5个盲点
1. **描述**: `graph_health` 是假交付。**触发条件**: 跑 `triage`/快照。**影响**: `v_graph_health` 关键列是 `NULL`，`orphan_delta` 无意义。**最小修复**: 先做 `fact_links`+双 `ON DELETE CASCADE`。**应放入**: 跨 phase
2. **描述**: Batch D 多数仍是“有表无行为”。**触发条件**: 0010 合入即继续排 P1。**影响**: 多个 P0 仍是 stub，完成度失真。**最小修复**: P0 完成标准改成 `writer+reader+e2e`。**应放入**: P4 P0
3. **描述**: `archive_reason` 没有状态机。**触发条件**: reflect 归档、矛盾仲裁、旧事实重摄取。**影响**: 不写 `archive_reason/replaced_by_fact_id/revival_at`，无法解释归档。**最小修复**: 在 reflect/ingest 统一写这三列。**应放入**: P4 P0
4. **描述**: 恢复路径只有文档。**触发条件**: migration 出错或 WAL/DB 损坏。**影响**: 只有手工备份、没有恢复工具，事故时只能人工回退。**最小修复**: 加 `doctor backup/verify/restore` + 恢复测试。**应放入**: 跨 phase
5. **描述**: 性能 gate 只测 hook。**触发条件**: facts 到 10K+ 后跑 triage、reflect、graph CTE。**影响**: 延迟悬崖会在 Phase 5 前先爆。**最小修复**: 先补 benchmark fixture + CI 阈值。**应放入**: P4 P1

## 2. P0 顺序与依赖图
0. `fact_links` — 依赖: 无；必须先于 P0-3，且两端 FK 都要 `ON DELETE CASCADE`
1. `decision_audit` — 依赖: 无
2. `archive_reason` — 依赖: `decision_audit`
3. `correction` — 依赖: `decision_audit` 可选
4. `graph_health` — 依赖: `fact_links`
5. `triage` — 依赖: `graph_health_snapshot`
裁决: **应先做 `fact_links`**；否则 P0-3 只是返回 `NULL` 的占位 view。

## 3. 应该砍掉/降级的
- `four-layer dashboard`｜P1 → P6｜底层指标未闭环；替代: `compost stats`
- `crawl_queue`｜P1 → Reject｜在 first-party 原则下只是“待办表”；替代: `open_problems` + 手动 `compost add <url>`

## 4. 应该新增的
- `backup/restore + corruption drill`
- `10K/100K/1M facts` 基线

## 5. 独特视角
长期风险是派生层慢慢变成真相源。多机同步后，如果新表没有确定性重放和恢复测试，普通 migration 会升级成 split-brain。

DONE_R1_CODEX_002
