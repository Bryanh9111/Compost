# Debate 006 — Week 2 Plan Audit R1
> 参赛者: Sonnet 4.6 (范围/KISS/诚实估算)
> 日期: 2026-04-15

---

## 1. P0-3 (graph-health) Scope Gap

### Gap 1: `stale_cluster_count` 没有计算路径

**缺什么**: schema 列 `stale_cluster_count` 定义为"clusters with all facts older than 90d", 但 `graphStats()` 只返回 `componentCount`, 没有 90d filter 版本. `connectedComponents()` 返回 `Map<fact_id, component_id>`, TS 层需要额外查每个组件内所有 fact 的 `created_at` 才能判断 stale. Plan 里 `currentSnapshot` 的实现路径是 "query `v_graph_health` + TS-side cluster_count", 但 `v_graph_health` 里 `cluster_count` 永远是 0 (注释明确: "View returns 0; takeSnapshot computes real"), 而 `stale_cluster_count` 的计算完全没被 Plan 提及.

**建议**: P0-3 实现 `takeSnapshot` 时, 在 `connectedComponents()` 结果上叠加: 对每个 component 查其所有 fact 的 `MAX(created_at)`, 若整个组件的最新 fact 也 `< datetime('now', '-90 days')` 则计为 stale cluster. 或给 `graphStats()` 加可选 `staleAgeDays` 参数, 避免两处重复 query.

---

### Gap 2: `takeSnapshot` 的同日重复写冲突 (INSERT vs REPLACE)

**缺什么**: `graph_health_snapshot.taken_at` 是 PRIMARY KEY, `DEFAULT (datetime('now'))` 精度到秒. Plan 说"同日 REPLACE? INSERT?"但没给出答案. 若 scheduler 03:30 UTC 触发, daemon 重启后 grace window (`msUntilNextBackupWindow` 逻辑) 使其在 03:31 再次触发 --- 此时同一天已有一行, INSERT 会抛 UNIQUE constraint. `startBackupScheduler` 用 `after_backup_sleep = 24h - 1min` 规避重触发, 但 `startGraphHealthScheduler` 没有对应逻辑, Plan 没有明确写出 INSERT OR REPLACE/INSERT OR IGNORE 的选择及其语义含义.

**建议**: 明确用 `INSERT OR REPLACE` (覆盖当天旧数据以获得最新快照), 并在 `takeSnapshot` 加 guard: 若当天已有行且调用方不是 force-mode, 直接返回已有快照而不写入, 避免同 UTC 日多次无效写.

---

### Gap 3: Scheduler 时间窗冲突未声明

**缺什么**: Plan 写 "startGraphHealthScheduler 每天 03:30 UTC". ARCHITECTURE.md scheduler 表只有 `startBackupScheduler` 在 03:00 UTC, 没有 03:30 槽. 两者均持有 SQLite writer lock. Backup 用 VACUUM INTO (会临时提升到 exclusive lock ~1-5s), graph-health snapshot 是普通 INSERT. 如果 backup 慢 (大 DB, NFS 挂载) 超过 30min, 03:30 的 snapshot writer 会在 `db.run()` 处阻塞而非报错, 因为 SQLite 默认 busy_timeout=0. Plan 没有写明 busy_timeout 设置或时间窗文档更新.

**建议**: 在 `startGraphHealthScheduler` 注释里声明 "04:00 UTC"(在 backup 之后), 并在 ARCHITECTURE.md scheduler 表补这一行. 与 `startReflectScheduler` (00/06/12/18 UTC) 和 `startBackupScheduler` (03:00) 均不重叠.

---

## 2. P0-5 (correction_events) Scope Gap

### Gap 1: `correction_events.related_fact_ids_json` 与 `health_signals.target_ref` 的序列化合约缺失

**缺什么**: `correction_events.related_fact_ids_json` 是 `TEXT` (JSON array), `health_signals.target_ref` 是 `TEXT`. `recordCorrection` stub 接收 `relatedFactIds?: string[]` 参数, 但 Plan 没有指定: (a) `related_fact_ids_json` 如何序列化 (b) 写 `health_signals` 时 `target_ref` 填 `correction_event.id` 还是逐条写每个 `fact_id`. 0012 migration 的 `target_ref` 注释写"correction_event_id", 但 `CorrectionEvent` 接口 (`relatedFactIds: string[]`) 给调用者的印象是存 fact_ids. 两者语义不同: 前者 1 行/event, 后者 N 行/fact.

**建议**: Plan 显式规定: `health_signals` 写 1 行 per correction_event, `target_ref = correction_event.id.toString()`, message 包含 fact_ids 列表. `related_fact_ids_json` 序列化用 `JSON.stringify(relatedFactIds ?? [])`.

---

### Gap 2: `findRelatedFacts` 的 subject/object 子串匹配无下限精度保证

**缺什么**: Plan 写 "subject/object 子串匹配". `findRelatedFacts` stub 接收 `retractedText` (原始 regex match[0], 如"我之前说的有误"), 而不是从中提取的主题词. Regex match[0] 是包含口语化短语的完整匹配串 (如 "I was wrong about"), LIKE '%I was wrong about%' 会匹配 0 行. Plan 没有写"先提取主题词再匹配"还是"直接用 retractedText 的 substring". `correctedText: null` (stub TODO) 意味着修正后的文本也无法参与匹配. 结果: `findRelatedFacts` 极大概率返回 `[]`, health_signal 的 `relatedFactIds` 为空数组, correction_candidate 信号失去诊断价值.

**建议**: Plan 要么 (a) 明确 retractedText 存整句、findRelatedFacts 做 tokenize + stopword 过滤后再做 LIKE 匹配, 要么 (b) 承认 Week 2 该函数返回 [] 是可接受的 stub 并在 health_signal message 里说明"related facts TBD". 不要实现一个看起来工作但实际永远空的 heuristic.

---

### Gap 3: `processed_at` 字段没有写入计划

**缺什么**: `correction_events.processed_at` 用于标记"reflect() consumed this event", 但 Plan 里 P0-5 的位置是 "daemon post-drain", 不在 `reflect()` 里. Plan 没有说明: 谁负责写 `processed_at`, 以及写入时机. 若 `processed_at` 永远为 NULL, `idx_correction_events_unprocessed` 索引会无限增长, 且下次 daemon 重启后同一 event 会被重复处理 (产生重复 health_signal).

**建议**: Plan 明确: correction scanner 在成功写入 `health_signals` 后, UPDATE `correction_events SET processed_at = datetime('now')` 同一事务内完成, 避免重处理.

---

## 3. 未预见失败

### 场景 1: `connectedComponents()` 在大 DB 上阻塞主线程

**场景**: `connectedComponents()` 先全量 SELECT facts (无 LIMIT), 再全量 SELECT fact_links, 在内存做 Union-Find. 10万 facts × 5 LinkKinds = ~500k 行. `graphStats()` 同步调用, 没有 async. `startGraphHealthScheduler` 在 daemon 主进程跑 (Bun 单线程), 全量扫描期间 drain loop 和 ingest worker 的事件循环会卡住.

**影响**: MCP observe 调用在 03:30 UTC 窗口期会堆积在 outbox, 用户侧看到 "observation not drained" 延迟. 若 fact count 持续增长, 每天都会变慢.

**预防**: `startGraphHealthScheduler` 的 loop 里把 `currentSnapshot(db)` + `takeSnapshot(db)` 用 `setTimeout(..., 0)` 或 Worker thread 隔离 (Bun 支持 `new Worker`); 或给 `connectedComponents` 加 `LIMIT 100000` 上界 + 截断日志.

---

### 场景 2: Daemon post-drain correction scan 与 session context 脱节

**场景**: `detectCorrection` 在 daemon 里扫 observations, 但 observations 不存储 turn_text (只存 source_uri + raw_bytes). 实际对话文本通过 claude-code hook 以 `appendToOutbox` 写入, raw_bytes 存放的是 hook payload JSON. correction scan 如何拿到 turn_text? `startDrainLoop` 的 `drainOne` 只调 ledger/outbox, 没有暴露 observation content 给 correction scanner.

**影响**: P0-5 scan 位置 "daemon post-drain" 在代码层面找不到 turn_text 的直接来源, 实现时会发现需要 JOIN observations.raw_bytes + JSON parse, 这是 Plan 没提的额外步骤.

**预防**: Plan 里显式写出: "从 `observations.raw_bytes` 反序列化 hook payload, 取 `turnText` 字段传入 `detectCorrection`", 并确认 hook payload schema 里有 turnText.

---

### 场景 3: `v_graph_health` cluster_count 永远是 0, 被当成真值存入快照

**场景**: `takeSnapshot` 的 Plan 写"query `v_graph_health`". 但 `v_graph_health` 明确注释 `cluster_count = 0` (placeholder). 如果 `takeSnapshot` 实现直接 `INSERT INTO graph_health_snapshot SELECT ... FROM v_graph_health`, 则 `cluster_count = 0` 会写死进快照. `delta()` 查最近 2 snapshots 时永远拿到 `clusterDelta = 0`, 没有任何报错.

**影响**: 静默语义错误 — 快照行里 cluster_count 永远 0, 下游用 delta() 的诊断信号失效.

**预防**: `takeSnapshot` 必须独立调用 `connectedComponents(db).count` 填 `cluster_count`, 不能从 `v_graph_health` 取这个字段. Plan 里要分开两条 query 路径: v_graph_health 取 total_facts/orphan_facts/density, TS 计算 cluster_count/stale_cluster_count.

---

## 4. 估算裁决

| 项目 | Plan 估算 | 实际判断 | 理由 |
|------|----------|---------|------|
| P0-3 graph-health | S (隐含) | **M** | `stale_cluster_count` 计算需要额外 JOIN; `takeSnapshot` 不能照搬 v_graph_health; scheduler 时间窗文档更新; busy_timeout 设置; 测试覆盖 cluster + stale 两路. 最少 2-3 小时 |
| P0-5 correction | S | **S** | 核心路径 (detect + record + health_signal) 代码量确实小; 但 `findRelatedFacts` 和 `processed_at` 逻辑需要澄清. 维持 S 但须先定合约再写代码, 否则返工 |
| Week 2 实际天数 | 未给出 | **3-4 天** | P0-3 M + P0-5 S + 测试 (graph-health 测试涉及 connectedComponents 两条路径, 需要 fixture DB) + 005 遗留的 stale_cluster_count 承诺. 2天是乐观下界 |

---

## 5. Week 2 Go/Conditional Go/No-Go

**Conditional Go**

前置条件 (≤ 3):

1. **`takeSnapshot` 实现合约锁定**: 明确写出 v_graph_health 只取 total_facts/orphan_facts/density, cluster_count 和 stale_cluster_count 独立 TS 计算. 写入 ARCHITECTURE.md scheduler 表补 graph-health 行 (时间窗不晚于 04:00 UTC).

2. **P0-5 `retractedText` 来源路径确认**: 在 Plan 里写明"从 observations.raw_bytes 反序列化 hook payload 取 turnText", 并确认 `processed_at` 在同一事务内写入.

3. **`findRelatedFacts` 精度选择二选一**: 要么 Week 2 接受 `[]` stub + 明确记录, 要么实现 tokenize + LIKE 匹配. 不允许写一个看似工作但实际永远返回 `[]` 的实现而不记录.

---

## 6. 一句话告诫

`v_graph_health.cluster_count` 是 0 的占位符, Plan 如果不分开两条查询路径就直接 INSERT FROM view, 每天 03:30 都会安静地把 "cluster_count=0" 写进快照, `delta()` 的诊断价值在第一天就死了.

---

DONE_R1_SONNET_006
