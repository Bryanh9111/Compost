# Debate 006 — Synthesis: Week 2 Plan Audit

> 🐙 Opus 主持终裁 · 2026-04-15
> Participants: 🔴 Codex / 🟡 Gemini / 🟠 Sonnet / 🐙 Opus
> Rounds: R1 only (focused audit, 4/4 strong convergence)

---

## 🟡 最终裁决: **Conditional Go for Week 2**

**4/4 一致**: Plan 有漏洞但可修. Week 2 初估 2 天严重**低估**, 实际 **3-4 天**. 两个 P0 都应升级为 M (not S).

**核心发现**: `v_graph_health.cluster_count` 硬编码 0 (占位符) + `detectCorrection` 返回的 `retractedText` 是口语化 regex 短语 (不是 subject). 如果 Plan 不明确这两个点, Week 2 会写出"看起来工作但静默失效"的代码.

---

## 🔴 Pre-Week-2 Must-Fix (Plan 锁定, ≤ 1 小时, 不动代码)

### Fix 1 (HIGH, 4/4 共识): P0-3 锁定 cluster_count 责任分离
- **问题**: v_graph_health.cluster_count = 0 (TODO). Plan 说 `takeSnapshot` "query v_graph_health" — 如果照搬, snapshot 永远写 0. delta() 诊断价值第一天就死.
- **Plan 锁定**: `currentSnapshot` 明确两路:
  - v_graph_health 只取 `total_facts`, `orphan_facts`, `density`
  - `cluster_count` + `stale_cluster_count` 由 TS 独立计算 (`connectedComponents` + 新 `countStaleClusters`)
- **新增 fact-links.ts 导出**: `countStaleClusters(db, minAgeDays=90): number` — "组件内全部 active facts created_at < now-90d"

### Fix 2 (HIGH, 4/4 共识): P0-3 同日 snapshot 幂等语义
- **问题**: `taken_at TEXT PK DEFAULT (datetime('now'))` 秒精度. Daemon 重启或 grace window 可能同秒/同日冲突.
- **Plan 锁定**: `takeSnapshot` 同事务 `DELETE FROM graph_health_snapshot WHERE date(taken_at) = date(?)` 再 INSERT. 不改 schema. 注释明说"每日一行, 当天重触发覆盖".

### Fix 3 (HIGH, Sonnet+Codex): P0-5 `retractedText` 来源 + 提取路径
- **问题**: `detectCorrection` 返回 `match[0]` = 口语化短语 ("I was wrong about"). 不是 subject. `findRelatedFacts` 用它做 LIKE 匹配 = 永远返回 []. Plan 说"从 observations 扫" 但 `observations.raw_bytes BLOB`, 不能直接 regex.
- **Plan 锁定**:
  - P0-5 scanner 不再"扫最近 N observations", 改为 **per-observe_id 增量** (drain 成功后 post-drain 挂钩)
  - 从 `observations.raw_bytes` 反序列化 hook payload, 取 `turnText` 字段
  - `detectCorrection` 输入是完整 turn text (不是 match[0])
  - `recordCorrection` 存**整个 turnText** 到 `retracted_text` (或截断 500 chars), match[0] 只放 `pattern_matched`

### Fix 4 (HIGH, 4/4 共识): P0-5 `findRelatedFacts` 签名 + 精度
- **问题**: 子串匹配产生 "paris" 洪水 / 零命中二选一. Gemini+Codex 都说必须 session isolation.
- **Plan 锁定**: 签名改:
  ```ts
  findRelatedFacts(
    db: Database,
    retractedText: string,
    opts?: { sessionId?: string; limit?: number; minTokenOverlap?: number }
  ): string[]
  ```
  实现: tokenize + stopword 过滤 + 按 session 内 facts 优先 (last 24h) + 至少 2 token overlap. 或 — **也可接受的 Stub**: Week 2 返回 `[]` + health_signal.message 明说 "related_facts tbd (Week 4 P0-1)". **必须二选一**, 不许"看似工作"的中间态.

### Fix 5 (MEDIUM, Sonnet+Codex): `processed_at` 写入契约
- **问题**: `correction_events.processed_at` 定义是"reflect consumed". 但 scanner 在 daemon post-drain, 不在 reflect.
- **Plan 锁定**: processed_at 定义修正为 **"成功写 health_signals 后的时间戳"**. 同事务内: INSERT correction_events → INSERT health_signals → UPDATE correction_events SET processed_at. 失败则全 rollback. 这保证"每 correction_event 最多 1 个 health_signal".

### Fix 6 (MEDIUM, 4/4 共识): ARCHITECTURE.md scheduler table 加 graph-health
- **问题**: 03:30 离 03:00 backup 太近, VACUUM INTO 在大 DB 可能超 30min → `SQLITE_BUSY`.
- **Plan 锁定**: `startGraphHealthScheduler` @ **04:00 UTC** (避开 backup). ARCHITECTURE.md scheduler 表加一行. 仍然避开 reflect 的 00/06/12/18.

---

## 🟡 接受风险 (Week 2 过程中警惕)

| 风险 | 发现者 | 缓解 |
|---|---|---|
| `connectedComponents` 100K+ facts 内存 | Gemini + Sonnet + Codex | Week 2 接受; Week 4 P1 加 benchmark fixture. 现阶段加 LIMIT 200K 防爆 |
| daemon 主线程阻塞 (Union-Find 同步) | Sonnet unique | P0-3 loop 里 `await Bun.sleep(0)` yield 到 event loop. 不做 Worker 抽象 |
| correction false positive 洪水 (10KB paste 里有 "I was wrong about") | Opus + Codex | 加 `max_span_length = 200` 限制; paste 大 chunk 跳过 |
| 同日 daemon 重启 2 次 snapshot | Codex unique | Fix 2 DELETE+INSERT 同事务覆盖 |

---

## 📊 估算裁决 (4-way consensus)

| 项目 | Plan 原估 | 真实 | 理由 |
|---|---|---|---|
| P0-3 graph-health | S | **M** | stale_cluster_count 新函数 + 同日幂等 + scheduler 挂点 + 测试 |
| P0-5 correction | S | **M** (Sonnet 给 S 条件) | per-observe_id scanner + hook payload 反序列化 + findRelatedFacts 签名 + processed_at 事务 + 测试 |
| **Week 2 总计** | 2 天 | **3-4 天** | 4-way 一致翻倍 |

---

## 📋 实施顺序 (R1 共识整合)

```
Pre-Week-2 (锁 Plan, ≤ 1 小时):
  - ARCHITECTURE.md: scheduler 表加 graph-health @ 04:00 UTC
  - fact-links.ts: 声明将加 countStaleClusters (fixture 参数 minAgeDays=90)
  - graph-health.ts: 更新 JSDoc 写明 cluster_count TS-side, v_graph_health 只取 3 字段
  - correction-detector.ts: findRelatedFacts 新签名 (sessionId/limit/minTokenOverlap) 或 stub 注释
  - Plan 写 "processed_at 在 health_signals 写入后同事务设置"

Week 2 Day 1-2: P0-3
  - fact-links.ts: 加 countStaleClusters
  - graph-health.ts: currentSnapshot (view + connectedComponents + countStaleClusters)
  - graph-health.ts: takeSnapshot (DELETE same-date + INSERT 同事务)
  - graph-health.ts: delta (MAX(taken_at) 两行)
  - scheduler.ts: startGraphHealthScheduler @ 04:00 UTC
  - tests (6-8): 空 DB / 小图 / 孤儿 / 多 snapshot delta / 同日幂等 / staleCluster

Week 2 Day 2-4: P0-5
  - correction-detector.ts: recordCorrection 真实现 + 事务
  - correction-detector.ts: findRelatedFacts 按 Fix 4 (签名 / stub+注释 二选一)
  - 新 scanObservationForCorrection(db, observe_id) — drain 成功后挂钩
  - scheduler.ts startDrainLoop 加钩调用
  - tests (8-10): 中/英 patterns / paste 大 chunk 跳过 / 无 match / 命中写入 / related_facts / session 隔离 / 去重 / processed_at 同事务

Day 4: Cross-P0 集成测试
  - reflect 写 contradicts 边 → takeSnapshot → cluster_count 更新
  - hook simulate correction → drain → correction_events → health_signal
```

---

## 🟢 Week 2 Go Checklist

- [ ] Pre-Week-2 6 项 Plan-lock (ARCHITECTURE + JSDoc + 签名, 不动业务代码)
- [ ] 认可 3-4 天 Week 2 预算 (vs 原 2 天)
- [ ] 接受 `findRelatedFacts` Week 2 是 stub (返 []) + Week 4 P0-1 填实 **或** 实现 tokenize 版本 — 二选一
- [ ] ARCHITECTURE.md 锁 "graph-health @ 04:00 UTC" 时间窗

完成这 4 项 checklist 后 **Full Go**. 预计完成时间: **Week 2 Day 4 晚**.

---

## 4-Voice Convergence Matrix

| 问题 | Opus | Sonnet | Codex | Gemini |
|---|---|---|---|---|
| cluster_count SQL vs TS 责任 | Gap 2 | Gap 3 + 场景 3 | gap1 | — |
| 同日 snapshot PK 冲突 | Gap 1 | Gap 2 | gap2 | — |
| stale_cluster_count 定义 + 实现 | Gap 3 | Gap 1 | gap1 | Gap 1 |
| graph → health_signal 时机 | Gap 4 (defer) | — | gap3 (defer) | Gap 2 (do now) |
| Scheduler 03:30 vs backup | Risk 1 | Gap 3 | — | Risk 1 |
| retractedText 来源 (observations 没 text) | Gap 5 | 场景 2 | gap2 | — |
| findRelatedFacts 子串匹配弱 | Gap 7 | Gap 2 | gap4 | Gap 2 (session) |
| processed_at 契约 | — | Gap 3 | gap3 | — |
| 增量 vs 全扫 | Gap 6 | — | gap1 | Gap 1 (cursor) |
| connectedComponents 大图阻塞 | Risk 3 | 场景 1 | failure 3 | 模式 2 |
| 估算 S → M | 4/4 | 4/4 | 4/4 | P0-5 给 M / P0-3 S |
| Week 2 Conditional Go | ✅ | ✅ | ✅ | ✅ |

---

## 元教训

1. **"Plan audit 之前先实现"是陷阱**: 如果先写 P0-3 的 `takeSnapshot` 直接查 v_graph_health, 就会把 `cluster_count=0` 每天写一次, 整套 delta 诊断静默失效. Plan audit 捕获这种"看起来对但静默错"的类型, 比 code review 更早.

2. **4/4 一致意味着真盲点**: v_graph_health cluster_count 占位符这个问题, 0011 commit 时 migrator 已指出 "TODO TS recursive CTE", 但 8 commits 过去了没人想起 P0-3 plan 应该绕开这个字段. 累积审 + plan 审双重才抓到.

3. **估算 S vs M 不是小事**: 两个 P0 同时翻倍 = Week 2 预算翻倍. 如果不在 plan 阶段承认, 就会 Week 2 末发现"差一天", 然后 Week 3 被压缩, 级联失败.

4. **Sonnet 最善捕获跨表语义缺口**: `retractedText` 是 match[0] 不是完整 turn text — 只有 Sonnet 精确指出; `processed_at` 契约缺失也是 Sonnet. 未来 Plan audit 应主动让 Sonnet agent 跑"字段语义一致性"扫描.
