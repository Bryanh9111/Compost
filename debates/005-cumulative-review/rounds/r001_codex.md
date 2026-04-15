## 1. Top 5 累积问题
1. `reflect.ts:136-247` 从不调 `fact-links.ts:50-91 addLink('contradicts')`，`fact_links` 仍是死表。004 漏因: P0-0/P0-4 分审。修: `reflect.ts:236` 前补 `addLink(loser,winner,'contradicts')`。
2. `audit.ts:42-60` 仍 stub，`reflect.ts:115-127,220-245` 与 `wiki.ts:151-167` 不写 `decision_audit`，违背 `ARCHITECTURE.md:163-179`。漏因: 先看 stub，没回看 caller。修: 实现 `recordDecision()`，并在三条成功路径调用。
3. `0011_fact_links_and_health_fix.sql:59-91` 已有 `v_graph_health`，但 `graph-health.ts:17-51` 仍 stub，`scheduler.ts:397-508` 未调 `takeSnapshot()`。漏因: SQL/TS/scheduler 跨 commit。修: `currentSnapshot()` 查 view，daemon 加 daily snapshot。
4. `scheduler.ts:257-268,361-368` 失败只写 `ingest_queue.last_error`；`outbox.ts:224-229` 已 drained；`ARCHITECTURE.md:189-199` 却要求 triage surface。漏因: queue/triage 分审。修: `triage.ts:49-79` 改扫 `ingest_queue`。
5. `0012_correction_signal_kind.sql:10-32` 已加 `correction_candidate`，但 `triage.ts:7-12,53-61` 与 `triage.test.ts:48-60` 仍固定 5 个 kind。漏因: 补丁 migration 后未回补。修: 扩 `SignalKind/byKind`。

## 2. 代码复用 / 重构建议
- `graph-health.ts` 直接复用 `fact-links.ts:258-376` 的 `findOrphans/connectedComponents/graphStats`，别保两套图统计。
- `backup.test.ts:37-210` 已覆盖 backup 主体；`backup-restore.test.ts:63-68` 只重复成功形状，CLI 测试应只保留 PID/exit code/JSON contract。

## 3. 文档与代码漂移
- `ARCHITECTURE.md:164,175-182` 写 `decision_audit always on` 且 6 个 enum 可审计；实际 `reflect.ts:117-120,221-229` 只写 `stale/contradicted`。

## 4. Week 2 前必修
- 接上 `recordDecision`，补 reflect/wiki 审计写入。
- 接上 `addLink` + `currentSnapshot/takeSnapshot`。
- 补 `hook -> drain -> ingest -> reflect -> backup -> restore -> query` E2E，并覆盖 Python 失败可见性。

## 5. 允许推迟
- `0010/0011/0012` 历史整理可后做；`migrator.test.ts:24-43` 已证明 fresh clone apply 可用。
- `fact-links traverse/connectedComponents` 性能基准可放到 Week 2 后。

## 6. 一句话总评
当前分支是 schema 先行、runtime 落后；Week 2 前先把审计、图边、失败信号接通。
