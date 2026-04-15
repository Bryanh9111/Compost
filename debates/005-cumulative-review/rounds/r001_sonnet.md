# Debate 005 Cumulative Review — R1 Sonnet 4.6
> Reviewer stance: KISS / scope / code reuse  
> Scope: 7 commits as one PR, cross-commit / global issues only (debate 004 per-commit fixes excluded)

---

## 1. Top 5 累积问题 (严重度降序)

### P1. `SignalKind` 类型与 migration 0012 的 `correction_candidate` 脱节 — 会在编译期静默逃逸

**file:line**: `cognitive/triage.ts:7-12` (类型定义), `schema/0012_correction_signal_kind.sql:19` (SQL CHECK)

**问题**: `SignalKind` union 仍只有 5 个成员，缺少 `'correction_candidate'`。`correction-detector.ts` 在注释里写了"结果通过 `health_signals` (kind='correction_candidate') 流向 triage"（`correction-detector.ts:88`），但 `triage.ts` 的 `byKind` 字段的键类型是 `Record<SignalKind, number>`。当 correction-detector 实际写入数据库后，`triage()` 将无法在 `byKind` 里统计该 kind。更糟的是，TypeScript 不会报错——`byKind` 只是运行时的 SQL GROUP BY 结果映射，编译器不感知。

**为何 debate 004 没抓**: 004 是逐 commit 视角，0012 fix 和 triage.ts 落在不同 commit，跨 commit 的类型-SQL 一致性没人盯。

**修复**:
```diff
// cognitive/triage.ts:7
 export type SignalKind =
   | "stale_fact"
   | "unresolved_contradiction"
   | "stuck_outbox"
   | "orphan_delta"
-  | "stale_wiki";
+  | "stale_wiki"
+  | "correction_candidate";  // added by migration 0012

// triage.ts:55 — byKind 初始值补齐
   byKind: {
     stale_fact: 0,
     unresolved_contradiction: 0,
     stuck_outbox: 0,
     orphan_delta: 0,
     stale_wiki: 0,
+    correction_candidate: 0,
   },
```

---

### P2. `audit.ts:recordDecision` throw 但 `reflect.ts` 的矛盾仲裁从未调用它 — `decision_audit` 表"always on"的合同空跑

**file:line**: `cognitive/audit.ts:47` (throw), `docs/ARCHITECTURE.md:164` ("Always on"), `cognitive/reflect.ts:220-246` (矛盾仲裁写路径)

**问题**: ARCHITECTURE.md §"Audit log responsibilities" 明确写 `decision_audit` "Always on"，`contradiction_arbitration` 是合规写入点。`reflect.ts` 的矛盾仲裁逻辑 (line 220-246) 已完整实现并写 DB，但完全没导入或调用 `recordDecision`。每次矛盾被仲裁，`decision_audit` 表为空。这不只是"stub 未实现"——已实现的写路径已经绕过了审计表，等 stub 补好时需要双重改动。

**为何 debate 004 没抓**: 004 把 stub 问题和"写路径缺调用"当同一件事看。实际上 reflect Step 3 是已实现的逻辑，它绕过 audit 是独立 bug，不依赖 stub 实现完成。

**修复**:
```diff
// cognitive/reflect.ts — top import
+import { recordDecision } from "./audit";

// reflect.ts line ~240, inside resolveTx, after winStmt.run(...)
+    // P0-2: one decision_audit row per cluster (one arbitration event per
+    // (subject, predicate) group). recordDecision throws until stub implemented,
+    // so wrap in try/catch — audit failure MUST NOT abort the arbitration itself.
+    try {
+      recordDecision(db, {
+        kind: "contradiction_arbitration",
+        targetId: cluster.groupId,
+        confidenceTier: "instance",
+        confidenceActual: 0.85,
+        rationale: `cluster winner=${cluster.winner}`,
+        decidedBy: "reflect",
+      });
+    } catch {
+      // stub not yet implemented — non-fatal until P0-2 lands
+    }
```

---

### P3. `graph-health.ts:GraphHealthSnapshot` 接口字段 `orphanFacts: number | null` 与 0011 后重建表的 `NOT NULL DEFAULT 0` 不一致 — TS 允许 null 但 DB 拒绝

**file:line**: `cognitive/graph-health.ts:7-10` (接口), `schema/0011_fact_links_and_health_fix.sql:45-52` (重建表定义)

**问题**: 0011 修复了 Sonnet B3 bug，把 `graph_health_snapshot` 所有列改为 `NOT NULL DEFAULT 0`。但 `graph-health.ts` 的 TS 接口和 `takeSnapshot` stub 仍把 `orphanFacts / density / clusterCount` 声明为 `number | null`（line 8-10）。当 `takeSnapshot` 实现后，如果直接传 `null`，`INSERT INTO graph_health_snapshot` 会在 SQLite 层抛 `NOT NULL constraint failed`——类型系统不会阻止这个错误。

**为何 debate 004 没抓**: 0011 的修复是针对 view-to-table INSERT 路径，但 0011 和 graph-health.ts 接口的不一致跨了两个 commit，per-commit 视角没对齐。

**修复**:
```diff
// cognitive/graph-health.ts:7
 export interface GraphHealthSnapshot {
   takenAt: string;
   totalFacts: number;
-  orphanFacts: number | null;        // null until fact_links table exists
-  density: number | null;
-  clusterCount: number | null;
+  orphanFacts: number;               // DEFAULT 0 in DB after 0011
+  density: number;
+  clusterCount: number;
   staleClusterCount: number;
 }

// currentSnapshot stub 同步更新默认值:
-    orphanFacts: null,
-    density: null,
-    clusterCount: null,
+    orphanFacts: 0,
+    density: 0,
+    clusterCount: 0,
```

---

### P4. `fact_links` 表已落地，`reflect.ts` 矛盾仲裁写 `superseded_by` 但从不写 `contradicts` 边 — 图永远缺少最有价值的边类型

**file:line**: `cognitive/reflect.ts:223-238` (supStmt 写路径), `cognitive/fact-links.ts:50` (addLink API), `schema/0011_fact_links_and_health_fix.sql:23` (`contradicts` kind)

**问题**: `fact_links` 的 `contradicts` kind 是图谱中语义最强的边——"这个事实推翻了那个"。`reflect.ts` 矛盾仲裁已知道 winner/loser 对，却只写 `facts.superseded_by`，没有调用 `addLink(db, winnerId, loserId, 'contradicts')`。`v_graph_health` 的 density 计算、`findOrphans`、`connectedComponents` 全部依赖 fact_links 边。没有 `contradicts` 边，经过仲裁的 loser 仍然算 orphan，density 被低估，图结构误导 P0-3 指标。

**为何 debate 004 没抓**: 004 捕获了"reflect 没调 addLink"作为一个 fix，但把它归类为"stub 问题"而非"已实现写路径缺边"。`addLink` 不是 stub，它已完全实现（fact-links.ts line 50-91）——只是 reflect 没导入它。

**修复**:
```diff
// cognitive/reflect.ts — top import
+import { addLink } from "./fact-links";

// inside resolveTx, after supStmt.run(...)
     for (const loserId of cluster.losers.keys()) {
       supStmt.run(cluster.winner, cluster.groupId, cluster.winner, loserId);
+      // Record graph edge: winner contradicts loser (non-fatal if fails)
+      try { addLink(db, cluster.winner, loserId, "contradicts"); } catch { /* ignore */ }
     }
```

---

### P5. `stale_cluster_count` 列已在两个 migration 里声明，但 `graphStats()` 和 `takeSnapshot` 从不计算它 — 列永远是 0

**file:line**: `schema/0010_phase4_myco_integration.sql:72`, `schema/0011_fact_links_and_health_fix.sql:51`, `cognitive/fact-links.ts:353-376` (graphStats 不含 stale_cluster)

**问题**: `graph_health_snapshot.stale_cluster_count` 定义为"clusters with all facts older than 90d"。`graphStats()` 返回 `componentCount` 但没有 `staleClusterCount`。`takeSnapshot` 是 stub，调用 `graphStats()` 后仍无法填充该字段。当 takeSnapshot 实现时，开发者会发现 `graphStats` 不足以支撑该字段，需要二次修改。

**为何 debate 004 没抓**: per-commit 视角分别看了 graphStats 和 takeSnapshot，但没有追踪"stale_cluster_count 需要 90d-filter 的组件计算"这条跨 API 依赖链。

**修复**: 在 `fact-links.ts:graphStats` 新增 `staleClusterCount` 字段：
```diff
 export function graphStats(db: Database): {
   totalFacts: number;
   totalLinks: number;
   density: number;
   orphanCount: number;
   componentCount: number;
+  staleClusterCount: number;
 } {
+  // stale cluster = component where ALL member facts have created_at < 90d ago
+  const { components, count: componentCount } = connectedComponents(db);
-  const { count: componentCount } = connectedComponents(db);
+  // count components where no member is younger than 90d
+  const compActivity = new Map<number, boolean>(); // compId -> hasRecentFact
+  const facts90 = db.query(
+    "SELECT fact_id, created_at FROM facts WHERE archived_at IS NULL"
+  ).all() as Array<{ fact_id: string; created_at: string }>;
+  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
+  for (const f of facts90) {
+    const cid = components.get(f.fact_id);
+    if (cid === undefined) continue;
+    if (!compActivity.has(cid)) compActivity.set(cid, false);
+    if (f.created_at >= cutoff) compActivity.set(cid, true);
+  }
+  const staleClusterCount = [...compActivity.values()].filter(v => !v).length;
   ...
+  return { ..., staleClusterCount };
 }
```

---

## 2. 代码复用/重构建议

### R1. `backup.test.ts` 与 `backup-restore.test.ts` 覆盖重叠，可整合

`compost-core/test/backup.test.ts` (323 行) 测试 `backup/restore/pruneOldBackups/resolveBackup` 的核心逻辑。`compost-cli/test/backup-restore.test.ts` (108 行) 测试同一 `restore` 的 PID 检测逻辑，但用 subprocess 模式。两个文件有重复的"backup succeeds + restore from it"路径。

建议: 将 `backup-restore.test.ts` 缩减为纯 CLI 集成测试（只保留 PID 检测 3 个 case），删除与 `backup.test.ts` 重叠的 happy-path。减少约 30 行重复装置代码。

### R2. `findOrphans` 与 `v_graph_health` 的 orphan 查询逻辑重复

`fact-links.ts:findOrphans` (line 259-280) 和 `0011:v_graph_health` (line 76-81) 都实现了"active fact + no fact_links edge + age > threshold"逻辑，两者 SQL 结构几乎相同但 view 用 24h 硬编码而 `findOrphans` 接受参数。

建议: `graphStats()` 已调用 `findOrphans(db, 24)`，将 `takeSnapshot` 实现后同样通过 `graphStats()` 填充 `orphanFacts`，废弃对 `v_graph_health.orphan_facts` 的直接依赖，保留单一计算源。

---

## 3. 文档与代码漂移

`docs/ARCHITECTURE.md:164` 写 `decision_audit` "Always on"，并列出 `cognitive/reflect.ts` 为写入方。但 `reflect.ts` 当前完全没有导入 `audit.ts`（已确认无任何 `import` 或 `recordDecision` 调用）。文档说 always on，代码说永远没有写入。

另一处漂移: `ARCHITECTURE.md` 的 module map (line 118) 列 `cognitive/` 下只有 `reflect.ts` 和 `wiki.ts`，没有 `triage.ts / audit.ts / graph-health.ts / fact-links.ts / correction-detector.ts`——5 个 Phase 4 新模块全部缺失。

---

## 4. Week 2 前必修 (≤ 3 项)

1. **修复 `SignalKind` 类型缺 `correction_candidate`** (问题 P1)。migration 0012 已落地，correction-detector 已实现信号写入，triage 的类型/初始值不同步会导致运行时 byKind 统计缺项，静默错误最难排查。

2. **`reflect.ts` 矛盾仲裁调用 `addLink('contradicts', ...)`** (问题 P4)。`addLink` 已完全实现，reflect 已知 winner/loser 对，两行 import+调用即可修复。不修复则 fact_links 表的 `contradicts` 边在整个系统生命周期内一直为空，P0-3 所有图指标失真。

3. **同步 `GraphHealthSnapshot` 接口的 null 标注** (问题 P3)。0011 已重建表为 `NOT NULL DEFAULT 0`，接口继续标 `null` 会在 takeSnapshot 实现时引发 runtime 约束错误，且 TypeScript 不提前报警。

---

## 5. 允许推迟 (≥ 2 项)

1. **`stale_cluster_count` 计算** (问题 P5): `takeSnapshot` 本身是 stub，在 P0-3 正式实现前该字段始终是 0，占位无害。stale cluster 检测是诊断功能，Week 2 再补不影响核心写路径。

2. **backup.test.ts vs backup-restore.test.ts 去重** (建议 R1): 两套测试逻辑独立，重叠部分有冗余但不影响正确性。测试代码清理属于 housekeeping，可随 Phase 4 P1 批次处理。

3. **ARCHITECTURE.md module map 补全** (文档漂移第二条): 纯文档更新，不影响运行时，Week 2 末或 P0 全实现后统一刷新一次成本最低。

---

## 6. 一句话总评

7 个 commit 作为整体看，骨架扎实但存在三条断掉的闭环: `SignalKind` 类型与 0012 SQL 脱节、`decision_audit` 合同在 reflect 写路径缺调用、`fact_links` 的 `contradicts` 边永远不会被填充——三者都是已实现代码之间的连接缺失，不是 stub 问题，Week 2 前修完代价极低但不修则会在 P0 验收时集体爆发。

---

DONE_R1_SONNET_005
