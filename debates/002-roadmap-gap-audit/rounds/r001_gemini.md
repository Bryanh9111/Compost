# Compost Phase 4-6 Roadmap Gap Audit (R1) — 🟡 Gemini

## 1. Top 5 盲点 (按严重度降序)

### 1.1 嵌入模型偏移 (Embedding Model Drift)
- **描述**: 更换或升级嵌入模型（如从 `nomic-embed-text` 换到更先进模型）会使 LanceDB 中的存量向量完全失效。
- **触发条件**: 用户在 `package.json` 或环境变量中切换模型，但未执行全量重导。
- **影响**: 混合检索（Hybrid Search）的语义部分失效，返回不相关的 fact，系统退化为纯文本检索，用户失去对“智能”的信任。
- **最小修复**: 在 `chunks` 表中记录 `model_signature`，查询时校验模型一致性；不一致时强制回退到 BM25。
- **应放入**: P4 P1 (作为 `compost doctor --rebuild` 的子任务)。

### 1.2 审计日志爆炸 (Audit Log Bloat)
- **描述**: `decision_audit` 记录了每一次 contradiction arbitration 和 wiki rebuild。在高频摄入场景下，审计数据量可能迅速超过事实（facts）本身。
- **触发条件**: 长期运行且有大量重复/矛盾信息输入（如持续抓取动态网页）。
- **影响**: `ledger.db` 文件体积膨胀，导致磁盘空间耗尽及反射（reflect）性能下降。
- **最小修复**: 为 `decision_audit` 引入 TTL（如保留 30 天）或“重要性过滤”（仅审计低置信度或用户更正的决策）。
- **应放入**: P4 P1。

### 1.3 离线/故障模式下的静默失效 (Silent Failure in LLM Layer)
- **描述**: 当 Ollama 挂掉或响应超时，`compost.ask` 或 `wiki synthesis` 可能会返回错误信息或空值，而没有明确的降级提示。
- **触发条件**: Ollama 服务崩溃或网络超时。
- **影响**: Wiki 页面被置空或损坏，用户无法通过 `ask` 获得答案，且系统可能错误地记录反馈。
- **最小修复**: 实现 Circuit Breaker 模式，LLM 不可用时显式标记 Wiki 为“stale”或在 `ask` 响应中明确标注“仅基于事实检索”。
- **应放入**: P4 P0。

### 1.4 回滚机制缺失 (Migration Rollback Vacuum)
- **描述**: 当前 `migrator.ts` 仅支持向上升级。一旦 `0010` 等复杂迁移在生产环境出现性能瓶颈（如大型索引创建失败），无法安全退回。
- **触发条件**: 执行 `npm run migrate` 时发生磁盘空间不足或 SQL 约束冲突。
- **影响**: 数据库处于不一致状态，系统无法启动。
- **最小修复**: 为 `0010` 编写对应的 `down.sql` 或在迁移前强制执行 `VACUUM INTO 'backup.db'`。
- **应放入**: P4 P0。

### 1.5 正则纠错的过拟合 (Regex Over-correction Overfit)
- **描述**: P0-5 的 `correction_events` 依赖正则捕获。过于激进的正则可能将正常的对话修正误判为对事实的否定。
- **触发条件**: 用户说 "No, I meant..." 但其实是在纠正自己的语法而非 Compost 的事实。
- **影响**: 导致高质量事实被错误降权或撤销。
- **最小修复**: 纠错信号不直接修改 `facts.confidence`，而是先作为 `health_signals` 挂载到 triage，由用户在 `compost triage` 中确认。
- **应放入**: P4 P0。

---

## 2. P0 顺序与依赖图

针对 `graph_health` 与 `fact_links` 的依赖悬案，我的裁决是：**必须先做 `fact_links`（或将其并入 P0-3）**。没有边的图（Graph）只是一个统计列表，`v_graph_health` 将毫无意义。

**推荐实施顺序：**

1. **P0-1: `compost triage` (health_signals)** — 依赖: 无。这是感知层的入口，必须最先落地以观察后续变更。
2. **P0-4: Archive Reason + replaced_by** — 依赖: 无。这决定了存储层的物理结构，越早做，存量数据清洗越容易。
3. **Carried-P3: `fact_links` 表** — 依赖: 无。这是 P0-3 的前置。
4. **P0-3: `v_graph_health` + Snapshot** — 依赖: `fact_links`。
5. **P0-2: `decision_audit`** — 依赖: `reflect` / `wiki` 逻辑更新。需要嵌入到各个决策点。
6. **P0-5: `correction_events`** — 依赖: `hook-shim` 更新。属于外部信号捕获，优先级排在内核感知之后。

---

## 3. 应该砍掉/降级的 (≥ 2 项)

- **项**: `memory_procedural` 独立表
- **当前 tier**: P4 Carried (P1)
- **建议 tier**: P6 或 Reject
- **理由**: Procedural memory（技能、规程）在单机版 Compost 中完全可以通过带有 `pinned` 标签的高权重 `facts` 实现。单独建表会增加 `query` 和 `ask` 的复杂度，属于典型的架构过拟合。

- **项**: `compression_pressure` SQL view
- **当前 tier**: P4 P1
- **建议 tier**: P2
- **理由**: 在 `archive_reason` 和 `triage` 尚未在大规模数据集验证前，单纯定义“压缩压力”是一个玄学指标。建议先让 `health_signals` 跑通，通过 `stale_fact` 的堆积来感知压力，而不是专门做一个 view。

---

## 4. 应该新增的 (≥ 2 项)

- **项**: `ledger.db` 损坏恢复机制 (Safe Recovery)
- **理由**: 所有的 P0 审计和健康检查都建立在 SQLite 正常的基础上。作为单机软件，断电导致的 WAL 损坏是高频风险。应增加 `compost backup` 和基于 `observations` 重新提取 `facts` 的灾后重建脚本。

- **项**: 性能基线测试与遥测 (Performance Baseline)
- **理由**: Roadmap 提到了 100 万 facts 的目标，但没有提及如何衡量。应在 P4 引入 `performance_telemetry` 表，记录每 1000 次查询的 P95 耗时，并在 `triage` 中对查询退化发出告警。

---

## 5. 独特视角 (LLM 模型风险)

作为 LLM 模型风险视角，我认为大家忽略了 **“模型生成的 Wiki 被其后续版本作为 Source 再次吸纳”的递归污染风险（Self-Consumption Pollution）**。

目前 Wiki 被存储为 Markdown 文件，如果用户不小心通过 `compost add` 将 wiki 目录重新 ingest，或者 LLM 在 `ask` 路径中过度依赖已生成的（可能含有幻觉的）Wiki，系统会进入“幻觉正反馈循环”。

**长期风险 (12+ 个月)**：Compost 可能会从“事实库”演变为一个“由 LLM 生成、并由 LLM 持续强化的虚构世界”。我们必须在 `observations` 层级强行禁止任何来自 `wiki/` 目录的再摄入，并严格区分“事实事实”与“合成事实”。

DONE_R1_GEMINI_002
