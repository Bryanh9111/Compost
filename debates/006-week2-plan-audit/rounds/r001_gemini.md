# R1 — 🟡 Gemini (Integration / Long-term / Ecosystem)
## 1. P0-3 Graph-Health Scope 完整度 (Gap)

- **Gap 1: `stale_cluster_count` 逻辑缺失**
  - **现状**: `fact-links.ts` 中的 `connectedComponents` 仅返回 `Map<fact_id, component_id>`。
  - **建议**: `graph-health.ts` 需要实现 `computeStaleClusters(db, components)`。该函数必须：1. 按 `component_id` 聚合 `fact_id`；2. 查询每个 cluster 内所有 fact 的 `created_at`；3. 只有当 cluster 内 **所有** fact 均超过 90 天且无活跃 `access_count` 时（参考 P0-4 `archive_reason='stale'` 定义），才计入 `stale_cluster_count`。
- **Gap 2: 缺乏从 Snapshot 到 `health_signals` 的转换逻辑**
  - **现状**: 计划提到 `delta(db)` 计算增量，但未明确写入 `health_signals`。
  - **建议**: `takeSnapshot` 之后必须调用 `checkHealthThresholds(db)`。如果 `orphan_delta > 5`（根据 0010 迁移注释），必须在 `health_signals` 插入 `kind='orphan_delta'` 的记录。否则，P0-1 的 triage 表面将对 P0-3 的感知结果处于盲视状态。

## 2. P0-5 Correction_Events Scope 完整度 (Gap)

- **Gap 1: Daemon 挂载点不明确与性能风险**
  - **现状**: `scheduler.ts` 的 `startDrainLoop` 目前仅调用 `drainOne(db)`。
  - **建议**: 不应在 `drainOne` 之后立即执行 `detectCorrection`，因为高频 IO 下正则匹配开销过大。建议在 `scheduler.ts` 新增 `startCorrectionDetector(db)`，每 5-10 分钟运行一次。该函数应记录 `last_processed_observation_id` 在 `internal_state` 中，以实现真正的增量扫描，而非“扫描最近 N 条”。
- **Gap 2: `related_fact_ids` 匹配召回率过低**
  - **现状**: 仅对 `retracted_text` 做子串匹配。
  - **建议**: 必须至少支持 **`session_id` 关联优先**。自纠正通常发生在同一个会话中。建议逻辑：1. 过滤当前 `session_id` 下产生的最新 N 个 facts；2. 对这些 facts 的 `object` 或 `subject` 执行 `fuzzy-match` 或关键词提取匹配。仅靠全局子串匹配会产生大量误报或零召回。

## 3. 未预见失败模式

- **模式 1: 03:30 UTC 锁冲突**
  - **场景**: 03:00 执行 `backup` (VACUUM INTO)。若数据库较大，30 分钟内未完成，03:30 的 `takeSnapshot`（涉及全量 `facts` 和 `fact_links` 扫描）将触发 `SQLITE_BUSY`。
  - **预防**: `startGraphHealthScheduler` 必须具备 `exponential backoff` 重试机制，且在执行前通过 `PRAGMA busy_timeout` 延长容忍度。
- **模式 2: `connectedComponents` 内存溢出**
  - **场景**: 事实量级达到 10^5 以上时，TS 层的 Union-Find 算法在 `Map` 操作中可能触发 V8 堆内存上限（daemon 长期运行）。
  - **预防**: 在 `graphStats` 中增加 `memoryUsage` 监控，若 `totalFacts > 200,000`，强制 `connectedComponents` 回退到多步 SQL 迭代或增加 `v8-options` 限制。

## 4. 估算裁决

- **P0-3 (Graph-Health)**: **S** (3d)。SQL View 已就位，TS 算法已在 `fact-links.ts` 存在，主要工作量在时序持久化。
- **P0-5 (Correction)**: **M** (5d)。正则模式的鲁棒性调试和 daemon 调度逻辑比预期复杂，且需要建立 `correction_events` 与 `health_signals` 的联动测试。
- **Week 2 总计**: 8-10 工作日（含测试）。

## 5. Week 2 Go / Conditional Go / No-Go

**Conditional Go.** 条件如下：
1. **显式处理 `orphan_delta` 信号**: `takeSnapshot` 必须闭环写入 `health_signals`。
2. **纠正检测增量化**: 放弃“扫描最近 N 条”，改为在数据库中持久化 `correction_detector_cursor`。
3. **隔离 `session_id`**: `findRelatedFacts` 必须优先检索当前 Session 下的事实。

## 6. 一句话告诫

不要为了性能规避 LLM 纠正检测，就容忍子串匹配这种极低质量的信号，如果它找不到相关的 fact，纠正事件就只是一堆死掉的字符串。

DONE_R1_006
