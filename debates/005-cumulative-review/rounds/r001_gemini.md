# Compost Cumulative Review R1 - Gemini (Ecosystem/Maintainability)

## 1. Top 5 累积问题 (按严重度降序)

### [P0] Stub 调度空转与集成缺失
- **位置**: `packages/compost-daemon/src/scheduler.ts` (1-509 全文)
- **原因**: Debate 004 侧重于新功能的原子性与正确性（如 backup 原子替换），未审视这些新模块（triage, audit, graph-health, correction-detector）在 daemon 循环中的缺失。
- **影响**: 所有的 Phase 4 P0 模块虽然有了代码库，但在运行时均处于“死代码”状态。`correction_events` 表永远不会被写入，`health_signals` 永远不会生成。
- **修复**: 在 `scheduler.ts` 中新增 `startTriageScheduler` 和 `startGraphHealthScheduler`；并在 `startDrainLoop` 中集成 `detectCorrection`。

### [P0] `reflect.ts` 冲突解决未持久化 `fact_links`
- **位置**: `packages/compost-core/src/cognitive/reflect.ts:220` (resolveTx)
- **原因**: 单 commit 视角下仅关注 `facts` 表的 `archive_reason` 和 `replaced_by_fact_id` 更新。跨 commit 视角发现 P0-0 `fact-links.ts` 已就绪，但 `reflect` 却没用它来建立 `contradicts` 边。
- **影响**: 破坏了 P0-3 `graph_health` 的基础数据。矛盾事实之间的显式图关系丢失，无法进行后续的图路径分析（如 recursive traversal）。
- **修复**: 在 `resolveTx` 事务内，为每个 loser 调用 `addLink(db, loserId, cluster.winner, 'contradicts')`。

### [P0] `decision_audit` 合约违约（Always On 但未写入）
- **位置**: `packages/compost-core/src/cognitive/reflect.ts` (Step 3)
- **原因**: ARCHITECTURE 承诺 "decision_audit always on"，但 `audit.ts` 目前是 throw stub。`reflect.ts` 甚至没有 import `recordDecision`。
- **影响**: 违反了 Phase 4 Pre-P0 核心合约。矛盾仲裁这种“高成本决策”在审计日志中无痕迹，无法回溯仲裁理由（rationale）。
- **修复**: 实现 `audit.ts` 写入逻辑，并在 `reflect.ts` 仲裁逻辑中调用 `recordDecision`。

### [P1] Python/TS 边界：LLM 提取失败的“隐形化”
- **位置**: `packages/compost-ingest/compost_ingest/extractors/llm_facts.py:65`
- **原因**: Python 侧对 Ollama 超时/连接失败采取 `return None` + `continue` 处理。TS 侧 `scheduler.ts:290` 认为提取成功（exit 0）但返回 0 facts。
- **影响**: 导致 `triage` 无法捕捉到 `stuck_outbox` 或 LLM 服务中断信号。对系统而言，这看起来像是正常的“无事实可提”，而非“服务不可用”。
- **修复**: Python 提取器在 LLM 失败时应向 stderr 输出特定标记，TS 侧 `startIngestWorker` 捕获后生成 `health_signals` (kind='stuck_outbox')。

### [P1] 文档漂移：`facts.archive_reason` 约束不一致
- **位置**: `docs/ARCHITECTURE.md` vs `packages/compost-core/src/schema/0010_phase4_myco_integration.sql:91`
- **原因**: 架构文档定义了 `superseded`，但 SQL CHECK 约束中使用的是 `contradicted`；文档要求 `replaced_by_fact_id` 必须在 `duplicate` 时设置，但 `reflect.ts` 尚未实现重复检测。
- **影响**: 导致 schema 约束与代码逻辑、文档说明三方脱节，增加后期维护的心智负担。
- **修复**: 统一 SQL CHECK 约束与 ARCHITECTURE 表定义。补充 `superseded` 到 CHECK 列表。

## 2. 代码复用 / 重构建议 (≥ 2)

- **统一信号生成器**: `triage.ts` 应作为 `health_signals` 的唯一权威源。目前的 `correction-detector.ts` 和 `scheduler.ts` 散落在各处尝试写入信号。建议将所有“扫描异常”的逻辑收拢到 `triage(db)` 的定期全量/增量扫描中。
- **提取器 Provider 化**: `scheduler.ts` 直接硬编码了 `Bun.spawn` 调用 Python。随着 P0-6 `IExtractorClient` 的引入，应重构为依赖注入模式，以便于测试（Mock Python 输出）和未来扩展远程提取节点。

## 3. 文档与代码漂移 (≥ 1)

- **ARCHITECTURE §P0-6**: 提到 "Self-Consumption guard" (拒绝 re-ingest `wiki/**` 路径)。经查 `pipeline/web-ingest.ts` 和 `scheduler.ts` 的 `ingestUrl` 调用点均未实现此检查。

## 4. Week 2 前必修 (≤ 3 项)

1. **Wiring**: 将 `decision_audit` 接入 `reflect.ts`（矛盾仲裁步）。
2. **Correction Loop**: 在 `startDrainLoop` 中调用 `detectCorrection`，确保 `correction_events` 有数据流。
3. **Triage Implementation**: 实现 `triage()` 扫描器对 `stale_fact` 和 `unresolved_contradiction` 的检测，让 `compost triage` 命令不再返回空结果。

## 5. 允许推迟 (≥ 2)

1. **`graph_health_snapshot` 递归 CTE**: 暂时可以用 `connectedComponents` 的 TS Union-Find 实现替代 SQL 侧复杂计算。
2. **`IExtractorClient` 抽象层**: P0-6 的接口化可以推迟，目前直接 `Bun.spawn` 在本地环境下运行良好。

## 6. 一句话总评 (≤ 100 字)

Phase 4 Batch D 的骨架（Schema/API）已基本成型，但功能链路处于“碎片化”状态；核心认知闭环（审计、自愈、纠错）虽有静态代码，却因缺乏调度层集成而未能产生实际的负反馈调节作用。

DONE_R1_005
