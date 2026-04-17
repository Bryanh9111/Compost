## Codex R1

### 1. Q1 裁决
先收尾，不再给 Batch D 继续加“概念层”。顺序:
1. `Hook-shim PII redactor`：这是分享、开源、长期 dogfood 前的硬门槛，且改动边界最清楚。
2. `compost export/import`：`backup` 解决灾备，不解决便携与完整性验收；要尽快验证知识能否带走、带回。
3. `bench harness`：先拿到 `reflect/query/ask` 基线，再谈下一轮优化，不然性能讨论都在猜。
4. `observations.origin_hash + method`：有价值，但它主要服务追责与去重，优先级低于安全、便携、测量。
`open_problems` 暂缓，两周真实 dogfood 后再决定是否值得升成一等数据结构。

### 2. Q2 评判
可能过度工程的有 3 个。第一，`graph_health_snapshot` 的每日定时：现在有读数，但没有稳定的修复闭环，也看不到它进入日常操作路径；view 可留，定时快照不该再加戏。第二，`backup` 的 30 日轮转策略，不是 `backup` 本身；单用户 macOS 已有 Time Machine，Compost 真正独特的是原子快照与恢复演练。第三，`BreakerRegistry` 在纯本地 Ollama 场景偏预防性。相反，`decision_audit` 和 `Self-Consumption guard` 不是过度工程：前者给自动改写留证据，后者以很低复杂度挡住高代价误操作。

### 3. Q3 漏洞
1. `eval harness`：现在能测 pass/fail，不能测召回与回答质量；没有这层，`ask()` 的演进不可比较。
2. 本地使用度量：至少要知道 `query/ask/triage/audit/restore` 的调用频次与结果分布，不然 Q2 永远只能靠体感。
3. Hook failure contract：不仅看 p95，还要定义 p99、超时、静默失败、降级提示；这是真实接入体验的边界，不是小修小补。

### 4. 一句话总评
Compost 现在方向部分对：核心能力已足够，下一步不该继续铺功能面，而该先补安全、便携、评测和真实使用证据。
