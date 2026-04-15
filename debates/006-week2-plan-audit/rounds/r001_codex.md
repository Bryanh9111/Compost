# R1 Codex

## 1. P0-3 scope
- gap1: `graph-health.ts:24-35` 现在计划混用 `v_graph_health` 和 TS；`0011` 的 `orphan_facts` 已与 `fact-links.ts:258-279` 重复。建议 `cluster_count` 明确定 TS；并在 `fact-links.ts` 补 `countStaleClusters(db, minAgeDays=90): number`，定义为“组件内全部 active facts 的 `created_at < now-90d`”。`currentSnapshot(db)` 只走 `graphStats()+countStaleClusters()`。
- gap2: `takeSnapshot` 没定义同日幂等。`graph_health_snapshot.taken_at` 是完整时间戳，不做 replace 会同日多行。建议 `takeSnapshot(db, opts?: { takenAt?: string }): GraphHealthSnapshot`，事务内先 `DELETE FROM graph_health_snapshot WHERE date(taken_at)=date(?)` 再 `INSERT`。
- gap3: `scheduler.ts/main.ts` 还没挂载。补 `startGraphHealthScheduler(db): Scheduler`，03:30 UTC，写 snapshot 即止；`graph -> health_signal` 留到 Week 4 `triage`，Week 2 不写。

## 2. P0-5 scope
- gap1: 不要“最近 N observations 全扫”。`scheduler.ts:35-40` 已拿到 `observe_id`，应补 `scanObservationForCorrection(db, observeId: string): { eventId?: number }`，在 drain 成功后只处理该 observation，天然增量。
- gap2: 读表应是 `observations.raw_bytes`；hook 的 `session_id` 存在整包 JSON，不在 `facts/captured_item/metadata`（`hook-shim:68-108`,`outbox.ts:114-125,167-195`）。只对 `source.kind='claude-code'` 解析。
- gap3: `processed_at` 语义未定。建议定义为“已成功写出 `correction_events` 与对应 `health_signals` 的时间”，同事务更新；否则重复扫描必然重报。
- gap4: `findRelatedFacts` 只做 subject/object 子串太弱。建议签名改为 `findRelatedFacts(db, text, opts?: { sessionId?: string; limit?: number })`，做分词/停用词过滤，按 token overlap + recency 排序，优先同 session/source facts。

## 3. 未预见失败模式
- 同日 daemon 重启两次，写两条 snapshot，`delta()` 基线错误；预防：同日 replace。
- “actually/其实” 命中泛化句，子串把旧 topic facts 全带上，`correction_candidate` 噪声爆炸；预防：session/source 限域 + 至少 2 个有效 token overlap。
- `connectedComponents` 全量装内存（`fact-links.ts:292-347`），03:30 与 backup 邻近时拉高尾延迟；预防：10K facts/50K links benchmark gate，超阈值不合并。

## 4. 估算裁决
- P0-3: M，不是 S；原因是 `stale_cluster_count`、同日幂等、scheduler、benchmark/test 一起算。
- P0-5: M，不是 S；原因是挂点、增量语义、`processed_at`、related-fact 排序都未定。
- Week 2: 3.5-4.5 天。

## 5. 裁决
**Conditional Go**
- 条件1: P0-3 只保留一个计算源，并补齐 `stale_cluster_count`。
- 条件2: P0-5 改成 `observe_id` 增量处理，不用“最近 N 扫描”。
- 条件3: 两项都带 benchmark/e2e：graph snapshot 性能门 + correction 去重/信号测试。

## 6. 一句话告诫
别把“最近 N 扫描 + 子串匹配”伪装成增量管道，它会同时漏检和重报。
