# r001_sonnet — Debate 024: insight write dedup ownership

**Advisor**: Sonnet (pragmatic / ship-this-week)
**Date**: 2026-04-23

---

## 选择: (a) Engram 侧加约束

(a) 是本次唯一有意义的选择。理由三条:

1. **root 原因在 Engram 侧没有 UNIQUE 约束**，而不是 Compost writer 没做前置 recall。对症下药，把约束写到数据所在的层。
2. (b) 的 pre-check 是治标 — TOCTOU 窗口和"未来第二个 origin=compost producer 要各抄一份"这两个缺陷在 context.md 里已明确列出，且 50 分钟两次手动 push 的场景再现极容易。
3. (c) 需要改 `remember()` 返回值 schema，所有客户端 response handling 都要过兼容检查 — 这是三条路里改动面最大的，但收益仅比 (a) 多了"一次 RTT"这个微优化，不值。

---

## Q1 dedup key shape

**选择: `(root_insight_id, chunk_index)`**

`root_insight_id` 的 UUIDv5 输入包含 `project ?? "" | sorted_fact_ids`（`splitter.ts:45`），所以 project 信息已经编码进 root_insight_id，加 project 列纯冗余。

`content_hash` 误判的风险太高: `splitter.ts:88-107` 的 greedy paragraph/sentence/hard-cut 算法边界不稳定，理论上同一 fact 集合重跑可能产生不同 chunk 边界，此时 content_hash 不同但 root_insight_id 相同 — 用 content_hash 做 dedup key 会把这类情况当成"不重复"放进去，反而制造混乱。`(root_insight_id, chunk_index)` 精确表达"同一 insight 的同一分块"，语义干净。

索引 DDL:
```sql
CREATE UNIQUE INDEX idx_compost_insight_idempotency
ON memories(
    json_extract(source_trace, '$.root_insight_id'),
    json_extract(source_trace, '$.chunk_index')
)
WHERE origin = 'compost';
```

SQLite `json_extract` partial index 已在 3.38+ 可用，无需担心版本问题。

---

## Q2 重复时行为

**选择: silent skip (返回已有 id，不报错)**

`store.py:57-60` 的 `_find_duplicate` + `_strengthen` 路径就是 Engram 已有的"重复返回现有对象"语义。对 compost insight 保持一致:

- `store.py:35-60` 的 `remember()` 已经有 "dedup check → return existing" 的模式，只是 FTS5 相似度检查（threshold 0.75）不够精确抓 compost 重复。在同样位置加 source_trace 精确检查后，行为对齐: **返回已有 row 的 id，不写入新行，调用方无需感知"是否重复"**。
- `writer.ts:147-156` 的 `PendingWritesQueue` 重试逻辑在 `result.ok && result.data?.id` 分支里走 "written" 状态 — 只要返回 `{ok: true, data: {id: existing_id}}`，queue 不会卡住，也不会误判为失败。
- 报错 (409) 会让 PendingWritesQueue 的 `markFailed` 路径被触发，需要额外改重试逻辑辨别"duplicate 错误 = 视为成功"，净增代码复杂度且与 context.md 硬约束 4 冲突。

---

## Q3 约束 scope

**选择: 只对 origin=compost 加约束**

origin=agent/human 没有 `source_trace`，没有 `root_insight_id` 字段，无法复用同一 dedup key。强行给 agent/human 加 content_hash 约束是不同问题，不属于本次 debate 范围。

context.md 明确列出"本次 debate 应只解决 compost 路径" — 这是正确的 scope。Scope creep 到 origin-agnostic 需要定义 agent/human 的 idempotency key，是独立的 debate。`WHERE origin = 'compost'` partial index 天然防止越界。

---

## Q4 历史 4 行处理

**具体建议: 删除后 2 行，保留时间最早的 chunk0 + chunk1**

```sql
-- 事务内执行，先确认 FK cascade 覆盖 compost_insight_sources
BEGIN IMMEDIATE;

DELETE FROM memories
WHERE id IN ('51862f2211ce', '89985a0261fc');

-- compost_insight_sources 通过 memories_compost_map_ad trigger 自动级联删除
-- (migration 002:142-144)

COMMIT;
```

理由:
- `002_slice_b_compost_integration.sql:142-144` 定义了 `AFTER DELETE ON memories` trigger，级联删 `compost_insight_sources`，不需要手动清 FK。
- 保留时间最早的两行 (`35a8f7dc`, `e60b6e78`) 语义正确：先写入的是真实来源，后写入的是误操作副本。
- 加了 UNIQUE index 之后，先跑 DELETE 再创建 index（或在 migration 003 里先 DELETE 再 `CREATE UNIQUE INDEX`），避免 index 创建时因现有重复行报错。

**migration 003 顺序**:
1. DELETE 重复行
2. `CREATE UNIQUE INDEX idx_compost_insight_idempotency ...`
3. 在 `store.py:remember()` 内对 origin=compost 加 `root_insight_id + chunk_index` 精确 pre-check（补充 FTS5 的不足，让 application-layer 在 sqlite unique 约束前先捞到 existing id 并返回）

---

## Cross-critique

**攻击 (c): 接口契约变更代价被低估**

context.md 把 (c) 的主要缺点列为"需要 Engram 改 remember 返回值 schema"，但这只是冰山一角。

`writer.ts:48` 定义了 `EngramMcpClient` 接口:
```typescript
remember(args: RememberArgs): Promise<MCPCallResult<{ id: string }>>;
```

`MCPCallResult<{ id: string }>` 是 TypeScript 类型合约。改成 `MCPCallResult<{ id: string; status: "created" | "existing" }>` 需要:
1. 改 `EngramMcpClient` interface (`writer.ts:48`)
2. 改 `WriteInsightResult.outcomes` 的 `ChunkWriteOutcome` — `status: "written" | "pending"` 需要新增 `"existing"` 分支 (`writer.ts:64-70`)
3. 改 `store.py:remember()` 返回值 (`store.py:35-114`) — 现在返回 `MemoryObject`，要么加 `was_existing: bool` 字段，要么改返回 tuple，两者都破坏现有调用点
4. Engram MCP server 的 tool handler 要把 Python 侧新字段序列化到 JSON response 里

这四个改动分散在 TypeScript 和 Python 两个 package、一个 MCP 协议边界，每个都需要独立测试。而 (a) 的改动面是: 一条 SQL migration + `store.py:remember()` 内一个 5 行的 pre-check。这才是真正的"最小 blast radius"。

---

## TL;DR

1. 选 (a): Engram 侧加 partial UNIQUE INDEX on `(root_insight_id, chunk_index) WHERE origin='compost'`，Compost 不动，约束写在数据层。
2. 重复时 silent return existing id，与 `store.py:57-60` 已有语义一致，`PendingWritesQueue` 不需改。
3. 历史 4 行: migration 003 先 DELETE 后 2 行再建 index，trigger cascade 自动清 FK。
