# Debate 024: Compost insight 写入去重 — 归 Compost 还是 Engram?

**Topic**: 同一份 digest 重复推送产生重复 insight 行，dedup 责任该挂在哪一侧
**Style**: quick / 1 round / cross-critique
**Advisors**: gemini, codex, sonnet + claude(opus) moderator
**Started**: 2026-04-23

## 背景

2026-04-23 的 dogfood session 验证 debate 023 落地后，顺手 audit 了 Engram 侧 origin=compost 数据：

```sql
SELECT id, kind, origin, datetime(created_at,'unixepoch','localtime'), substr(content,1,40)
FROM memories WHERE origin='compost' ORDER BY created_at;

35a8f7dcbf73 | insight | compost | 2026-04-18 02:13 | # Compost Digest — 2026-04-11 to 2026-04-18
e60b6e78a236 | insight | compost | 2026-04-18 02:13 | (conf=0.80)\n- compost-ingest stores_data...
51862f2211ce | insight | compost | 2026-04-18 03:03 | # Compost Digest — 2026-04-11 to 2026-04-18  ← 同一份
89985a0261fc | insight | compost | 2026-04-18 03:03 | (conf=0.80)\n- compost-ingest stores_data...   ← 同一份
```

50 分钟内同一份 digest 被推了两次，产生 4 行 (= 2 次 push × 2 chunks) 而非应有的 2 行。

## 关键事实 (sqlite + grep 证实)

**事实 1: Compost 侧的确定性 idempotency key 算对了，且 4 行都拿到同一个 key**

`packages/compost-engram-adapter/src/splitter.ts:40-46`:
```typescript
export function computeRootInsightId(project: string, factIds: string[]): string {
  const sorted = [...factIds].sort();
  const key = `${project}:${sorted.join(",")}`;
  return uuidv5(key, COMPOST_INSIGHT_UUID_NAMESPACE);
}
```

4 行的 `source_trace.root_insight_id` 全部 = `2ffbf27d-4949-55fd-8508-15d966e6bc03`。
4 行的 `source_trace.compost_fact_ids` 也完全相同（11 个 fact_id 排序一致）。
chunk_index 分布: (0, 1) × 2 次。

**事实 2: Compost writer 拿到 root_insight_id 后没做"已存在则跳过"预检**

`packages/compost-engram-adapter/src/writer.ts:111-168`:
```typescript
async writeInsight(opts) {
  const chunks = splitInsight(opts);
  const rootInsightId = chunks[0]!.source_trace.root_insight_id;
  for (const chunk of chunks) {
    validateSourceTrace(chunk.source_trace);
    const args = this.buildRememberArgs(chunk, ...);
    const result = await this.safeRemember(args);  // <— 直接写，无前置 recall
    // ... outcomes
  }
}
```

**事实 3: Engram 侧 schema 没有 (origin, root_insight_id, chunk_index) UNIQUE，也没有应用层去重**

`Engram/src/engram/migrations/002_slice_b_compost_integration.sql:32-65` 列出对 origin=compost 的 CHECK：必须 kind=insight、必须 source_trace、必须 expires_at。**没有任何 idempotency 约束**。
`Engram/src/engram/store.py` 的 remember 实现（待查证；初步 grep 未看到 content_hash / idempotency 关键字）。

**事实 4: 重复触发原因 — 推测是手工 `compost digest --push` 跑了两次**

50 分钟间隔 + 02:13 / 03:03 整时附近 → 不像 cron，更像用户操作。日程表查不到 scheduler 在那个时段触发 digest-push。Phase 6 P0 ship 节点附近 (commit cbcbcd2 在 04-17 落地)，作者很可能为验证 push 路径手工跑了两次。

## 三条路

### (a) Engram 侧加约束 — 通用兜底

在 `memories` 表加 partial UNIQUE INDEX：

```sql
CREATE UNIQUE INDEX idx_compost_insight_idempotency
ON memories(json_extract(source_trace, '$.root_insight_id'), json_extract(source_trace, '$.chunk_index'))
WHERE origin = 'compost';
```

或在 `remember()` 入口对 origin=compost 做 application-level pre-check (SELECT WHERE root_insight_id=? AND chunk_index=?)。

行为选项: 重复时**返回已有 id**（推荐，幂等 PUT 语义），或**报错**（CHECK 风格）。

- **Pro**: 所有 compost 客户端（不仅 Compost 本身，未来其他 producer）受益。Engram 是 schema 真理来源，约束写在这里语义正。Postgres-style partial-unique 是工业标准。
- **Con**: SQLite partial-unique 索引可用但 `json_extract` 索引性能要测。Migration 003 风险（已有 4 行重复需手动清理或 DROP+CREATE 时报错）。改 Engram 影响所有 origin=compost 客户端的错误处理路径。

### (b) Compost writer 加 pre-check — 客户端自律

`writeInsight` 在 `safeRemember` 前先 `recall({root_insight_id, chunk_index})`，命中则跳过。

```typescript
const existing = await this.safeRecall({
  query: rootInsightId,
  // ... filter to source_trace.root_insight_id == rootInsightId
});
if (existing.matches?.some(m => m.source_trace?.chunk_index === chunk.source_trace.chunk_index)) {
  outcomes.push({ status: "skipped-duplicate", existing_id: existing.matches[0].id });
  continue;
}
```

- **Pro**: 不动 Engram。Compost 自己拥有的 producer 自己负责幂等。pre-check 命中直接早退，省 Engram 写入流量。
- **Con**: 每个未来的 origin=compost producer (假设有第二个) 都得各抄一份。recall + remember 两次 RTT (vs 一次 PUT)。pre-check 与 remember 之间存在 TOCTOU 窗口（两个 Compost 进程同时推就还会撞）。

### (c) 双层 — Engram 强约束 + Compost 用响应做幂等 PUT

Engram 侧加 UNIQUE INDEX (同 a)，但**遇重复时返回已有 row 的 id 而非报错**。Compost writer 不做前置 recall，直接 remember；Engram 返回 id 后，Compost 区分"new" vs "existing"。

- **Pro**: 一次 RTT。无 TOCTOU。Engram 是约束权威，Compost 不重复实现 idempotency 逻辑。这是 HTTP PUT 的标准语义。
- **Con**: 需要 Engram 改 remember 返回值 schema (`{id, status: "created"|"existing"}`)。所有现有 Engram 客户端的 response handling 都得过一遍兼容性检查（origin=human/agent 路径不受影响，但 SDK 接口契约变了）。最大改动面。

## 硬约束

1. **schema 002 已上线**: `CHECK(origin != 'compost' OR source_trace IS NOT NULL)` — root_insight_id 永远可读取，不需要 NULL 处理。
2. **UUIDv5 namespace 锁死**: `COMPOST_INSIGHT_UUID_NAMESPACE` 在 `packages/compost-engram-adapter/src/constants.ts` 是稳定常量；改了会让所有历史 root_insight_id 失效（debate 022 §Q5 教训：UUIDv5 idempotency seed 不能动）。
3. **Engram 是多客户端共享系统**: 不只 Compost 一个 producer，未来 origin=compost 可能扩展（aggregator / cross-project synthesizer）。约束改动要考虑非 Compost 客户端。
4. **PendingWritesQueue 与 dedup 的交互**: `writer.ts:147-156` 在 remember 失败时入队重试。如果选 (a) 且行为=报错，重试逻辑要能识别 "duplicate" 错误并视为成功（否则 queue 永远卡住）。
5. **现有 4 行历史数据**: 不论选哪条路，都要决定怎么收拾。删 2 行（保留时间最早 chunk0 + chunk1）？还是留着 + 加 dedup 防未来？deletion 涉及 `compost_insight_sources` FK 一并清。

## 四个子问题

1. **Q1 (dedup key shape)**: 用 `(root_insight_id, chunk_index)` 还是 `(content_hash)` 还是 `(project, root_insight_id, chunk_index)`?
   - root_insight_id 已带 project (UUIDv5 输入含 project)，加不加 project 列冗余？
   - content_hash 抓的是字面相等；root_insight_id 抓的是 fact_id 集合相等。如果 splitter 在两次推送间产生了 chunk 边界差异（理论上可能），content_hash 不同但 root_insight_id 相同 — 哪个是"重复"的真相？

2. **Q2 (重复时的行为)**: silent skip / error-409 / return-existing-id?
   - silent skip: compost 客户端无感，但 lost write 检测困难
   - 报错: 客户端必须显式处理 duplicate；与 PendingWritesQueue 重试要兼容
   - return-existing-id: HTTP PUT 语义，最干净，但接口契约变更

3. **Q3 (约束 scope)**: 只对 origin=compost 加 dedup，还是对 origin=agent/human 也开放？
   - origin=agent/human 没有 source_trace，没有"自然"的 idempotency key
   - 但 agent 写入也可能产生重复（同一个 procedure 被两次发现）；是否需要 (origin, content_hash) 兜底？
   - 本次 debate 应只解决 compost 路径还是顺便定 origin-agnostic 范式？

4. **Q4 (历史数据处理)**: 上线 dedup 前的 4 行重复怎么收拾？
   - 删除后 2 行 (51862f / 89985a0)，保留前 2 行
   - 留着 + 后续 dedup 只防新增
   - 走 `compost_insight_sources` FK cascade 清，还是直接 DELETE 主表

## 期望输出

四方结构化发言 + 最终推荐。带 split vote 照办 022/023 的 tiebreak 格式。重点关注:
- (a)/(b)/(c) 选哪条 — Engram 通用兜底 vs Compost 客户端自律 vs 双层 PUT
- Q1 dedup key 选择对未来 producer 的影响
- Q2 行为语义对 PendingWritesQueue 的影响（重试一致性）
- Q3 是否扩到 origin-agnostic（防止 scope creep / 但避免错过统一范式机会）
- Q4 历史 4 行的清理方案

## Reference

- Engram CLAUDE.md L46 (已修, commit 4f11831): "insight 不独占 compost" 口径
- Compost commit 068c414: CJK tokenizer 修复（dogfood 同 session 发现）
- Compost commit cc6e54b: debate 023 落地（logGap 下沉 ask() core）
- Compost commit 4c5c751: `compost mcp` 独立子命令
- 历史 root_insight_id `2ffbf27d-4949-55fd-8508-15d966e6bc03` 对应 11 个 fact_id 集合
