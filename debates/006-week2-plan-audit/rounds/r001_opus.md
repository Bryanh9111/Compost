# R1 — 🐙 Opus (Week 2 Plan Audit, Architecture)

验证依赖: `graph_health_snapshot.taken_at TEXT PRIMARY KEY DEFAULT (datetime('now'))` (0010:67) — **second-精度**. 这对 snapshot 语义是大坑. `observations` 没有 TEXT content 列 — raw_bytes BLOB 或 blob_ref. `chunks.text_content` (0006) 才是正确的扫描源.

---

## 1. P0-3 scope 完整度 (4 gaps)

### Gap 1 (HIGH): `taken_at PRIMARY KEY` 在同秒冲突
- **问题**: `datetime('now')` 返回 `'2026-04-15 11:23:45'` (秒精度). takeSnapshot 写 PK=now. 两次调用同秒 → constraint violation. Daemon 重启或手动 `compost snapshot` 容易触发.
- **修复**: migration 0013 改为 `taken_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))` (毫秒精度) + 独立 `id INTEGER PK AUTOINCREMENT`. 或改 PK 为 `date` (YYYY-MM-DD), 同日 INSERT OR REPLACE. 后者更简单且匹配"每日快照"语义.
- **推荐**: migration 0013 重建表, PK=date. `takeSnapshot` 用 `INSERT OR REPLACE`.

### Gap 2 (MEDIUM): `cluster_count` 的 SQL/TS 责任未定
- **问题**: v_graph_health (0011:71-91) 硬编码 `0 AS cluster_count` (TODO). fact-links.ts `connectedComponents` 在 TS 做 Union-Find. `currentSnapshot` 需决定: 读 view 的所有字段 **或** 读 view + 覆盖 cluster_count.
- **修复**: `currentSnapshot` 签名:
  ```ts
  export function currentSnapshot(db: Database): GraphHealthSnapshot {
    const view = db.query("SELECT total_facts, orphan_facts, density FROM v_graph_health").get() as ...;
    const { count: clusterCount } = connectedComponents(db);
    const staleClusterCount = countStaleClusters(db);
    return { takenAt: new Date().toISOString(), totalFacts, orphanFacts, density, clusterCount, staleClusterCount };
  }
  ```

### Gap 3 (MEDIUM): `stale_cluster_count` 定义缺失
- **问题**: 0010 schema 有字段, 0011 view 有列但从未定义 "stale cluster".
- **修复**: 定义: "cluster 内所有 fact 均 `created_at < now - 90d`". 新增 `fact-links.ts#countStaleClusters(db, ageDays=90)`:
  ```ts
  export function countStaleClusters(db: Database, ageDays: number = 90): number {
    const { components } = connectedComponents(db);
    const clusterAgeMap = new Map<number, boolean>(); // component_id -> allStale
    for (const [factId, cid] of components) {
      const { created_at } = db.query("SELECT created_at FROM facts WHERE fact_id = ?").get(factId);
      const isOld = Date.parse(created_at) < Date.now() - ageDays * 86400000;
      if (!clusterAgeMap.has(cid)) clusterAgeMap.set(cid, isOld);
      else clusterAgeMap.set(cid, clusterAgeMap.get(cid)! && isOld);
    }
    return [...clusterAgeMap.values()].filter((v) => v).length;
  }
  ```

### Gap 4 (LOW, defer): orphan_delta → health_signal 是否 P0-3 做?
- debate 003 synthesis 说 P0-1 (Week 4) triage 消费 graph-health delta. P0-3 只负责存 snapshot.
- **结论**: 不在 P0-3 做. P0-3 只 `takeSnapshot`, signal 生成留 P0-1.

---

## 2. P0-5 scope 完整度 (4 gaps)

### Gap 5 (HIGH): 扫描源未定 — observations 没 TEXT 列
- **问题**: `observations.raw_bytes BLOB` / `blob_ref TEXT`. 不能直接 regex. `chunks.text_content TEXT NOT NULL` 才是 regex-ready.
- **修复**: correction-detector 扫描 `chunks` 表 (post-ingest 后, 每个 chunk 已 extracted text):
  ```ts
  SELECT c.chunk_id, c.observe_id, c.text_content, o.idempotency_key AS session_hint
  FROM chunks c JOIN observations o ON o.observe_id = c.observe_id
  WHERE c.chunk_id NOT IN (SELECT chunk_id FROM correction_events_scan_cursor)
  ORDER BY c.chunk_id
  LIMIT 100
  ```
  需要新 cursor 机制 (下面 Gap 6).

### Gap 6 (MEDIUM): 增量扫描 cursor 缺失
- **问题**: Plan 说"扫最近 N observations"但没说 N 和起点. 重启后是否重扫? dedup?
- **修复**: 不新建 cursor 表 (过度设计). 用 correction_events 自己做 dedup via UNIQUE index:
  ```sql
  -- migration 0013 (与 Gap 1 同)
  CREATE UNIQUE INDEX idx_correction_events_dedup
    ON correction_events(session_id, pattern_matched, substr(retracted_text, 1, 100));
  ```
  扫描逻辑: 每次跑时查 `MAX(created_at) FROM correction_events`, 扫 chunks WHERE `created_at > that`. INSERT OR IGNORE on dedup index.

### Gap 7 (MEDIUM): `findRelatedFacts` 子串匹配太弱
- **问题**: retracted_text = "我说的 Paris is in Germany 是错的". subject 子串匹配会命中所有 Paris / Germany / is / in 相关 fact. False positive 洪水.
- **修复**: (a) 只匹配 subject **或** object (不 predicate), (b) 限制 age: 仅 fact.created_at > session 开始时间 (approximation: last 24h), (c) limit 5, (d) 按 confidence desc. 不是 P0 的事 — 但 stub 实现必须足够克制. 最小可行:
  ```ts
  SELECT fact_id FROM facts
  WHERE archived_at IS NULL
    AND (INSTR(?, subject) > 0 OR INSTR(?, object) > 0)
    AND created_at > datetime('now', '-24 hours')
  ORDER BY confidence DESC LIMIT 5
  ```
  注意 INSTR 参数顺序: `INSTR(haystack, needle)`. 这里 `retracted_text` 是 haystack, subject/object 是 needle.

### Gap 8 (LOW): health_signals 写入必须带 target_ref 和 message
- **问题**: 当前 plan 只说"写 kind='correction_candidate'". 但 health_signals schema 要求 severity + message (NOT NULL).
- **修复**: 生成 signal 时:
  ```ts
  INSERT INTO health_signals (kind, severity, message, target_ref)
  VALUES ('correction_candidate', 'info',
          'User may have corrected ' || related_count || ' fact(s): ' || retracted_text_preview,
          'correction_event:' || correction_event_id)
  ```

---

## 3. 未预见的失败模式 (3)

### Risk 1 (HIGH): graph-health 与 reflect 竞争 SQLite writer
- **场景**: P0-3 scheduler 03:30 UTC 跑 takeSnapshot. reflect scheduler 6h 周期, 也可能在 03:30 附近 (如果最近一次是 21:30 UTC). 两者都加 writer lock, daemon 短暂挂住.
- **预防**: scheduler.ts 把 graph-health 排到 03:45 UTC (backup 03:00 + reflect-safe gap). 或在 `docs/ARCHITECTURE.md` scheduler table 显式排: 03:00 backup, 03:15 graph-health, 避开 00/06/12/18 的 reflect slots.

### Risk 2 (MEDIUM): correction-detector false positive 洪水
- **场景**: 用户 paste 一个大 markdown log (10KB), 里面有 "I was wrong about X" 字串 — 但是 **引用** 别人写的话, 不是用户自承错误. 正则命中, 写 correction_event + health_signal.
- **预防**: Gap 7 的 age gate (created_at > 24h ago) 只选近期 fact 降风险. 另: pattern 需要**锚定** 在短 span 内 (e.g. "我/I" 在句首, 不在 paste 中间), 当前 regex 已经部分锚定. 加一条 max_span_length = 200 char 限制, 超过 reject.

### Risk 3 (MEDIUM): connectedComponents 100K facts 内存 + 延迟
- **场景**: 6 个月 dogfood 后 50K-100K facts + 100K links. takeSnapshot 每日跑 connectedComponents — O(N+E) Union-Find, 但 JS Map overhead 约 150 bytes/entry → 100K = 15MB, 可接受. 但 `db.query("SELECT fact_id FROM facts WHERE archived_at IS NULL").all()` 100K 行一次性拉 → 10-50MB rows in TS.
- **预防**: takeSnapshot 用 `db.prepare(...).iterate()` 而非 `.all()` 流式读 facts. 或先查 count, 若 > 50K 就 skip 当天 snapshot + 写 error signal. 后者更保守.

---

## 4. 估算裁决

- **P0-3**: 初估 S, 真实 **M** (1.5 工作日). 加 gap 1 migration + gap 3 stale cluster + scheduler 集成 + 跨 P0 测试 + migration 测试.
- **P0-5**: 初估 S, 真实 **M** (1.5 工作日). 加 gap 5 chunks 扫描 + gap 6 cursor + gap 7 findRelatedFacts + gap 8 signal 写入 + scheduler 集成 + 中/英 patterns 覆盖测试.
- **Week 2 总**: 3-4 工作日 (vs 原 2 工作日估算). 翻倍.

---

## 5. Week 2 Go / Conditional Go / No-Go

**Conditional Go** — 3 项前置, ≤ 1 小时:

1. **Migration 0013**: 重建 `graph_health_snapshot` 用 `date TEXT PRIMARY KEY` (YYYY-MM-DD) + INSERT OR REPLACE 语义. 加 `correction_events` dedup UNIQUE INDEX.
2. **定义 `stale_cluster_count` 语义**: 在 ARCHITECTURE.md 写一句 "cluster 内所有 fact `created_at < now - 90d`".
3. **调整 scheduler 窗口表**: ARCHITECTURE.md 加 graph-health @ 03:15 UTC, backup @ 03:00 UTC. 或把 graph-health 放 03:45 avoid reflect 可能的 06:00 slot drift.

完成后 Go.

---

## 6. 一句话告诫

Week 2 两个 P0 的"S"估算**都是乐观**: 每个实际是 M, 加在一起是 Week 2 预算的 200%. 要么接受 3-4 天 Week 2, 要么裁掉 stale_cluster_count + findRelatedFacts 的完整实现, 留 stub + TODO 到 P0-1.
