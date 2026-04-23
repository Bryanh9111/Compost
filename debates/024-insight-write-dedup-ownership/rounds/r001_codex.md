# Round 1 — Codex — Debate 024

## 选择 (c)

我选 **(c)**: **Engram 侧做硬约束，重复写返回 existing id；Compost 不做前置 recall**。

原因很直接。`writeInsight()` 现在是逐 chunk 直接 `remember()`，失败就入 `PendingWritesQueue`，没有任何“重复可视为成功”的分支；如果你把去重放在客户端 pre-check，既挡不住并发 TOCTOU，也挡不住未来别的 `origin=compost` producer。只有 Engram 端原子判重才能真正关窗。证据在 `packages/compost-engram-adapter/src/writer.ts:125-158`、`:190-219`。

但 `context.md` 有两处需要纠正。第一，所谓“Engram 没有应用层 dedup”是错的：`MemoryStore.remember()` 先跑 `_find_duplicate(content, project)`，命中就 `_strengthen(existing)` 并返回旧行，见 `Engram/src/engram/store.py:52-60`、`:147-182`、`:201-214`。第二，所谓 schema 002 已保证 “root_insight_id 永远可读取” 也不成立；当前 DDL 只要求 `source_trace` 非空且 `json_valid`，**并未要求** `$.root_insight_id` / `$.chunk_index` 存在或类型正确，见 `.../002_slice_b_compost_integration.sql:60-64`。Writer 侧 zod 会校验，但那只是 Compost adapter 自律，Engram server 并不校验，`server.py` 直接把 `source_trace` 传进 store，见 `Engram/src/engram/server.py:56-69`。所以如果要把约束挂在 Engram，必须把这个洞一起补上。

## Q1 dedup key shape

用 **`(root_insight_id, chunk_index)`**，不要 `content_hash`，也不要再加 `project`。

`computeRootInsightId()` 已经把 `project` 编进 key 了，实际代码是 `(project ?? "") + "|" + sorted.join(",")`，见 `packages/compost-engram-adapter/src/splitter.ts:40-46`。`context.md` 里写成 `project:${facts}` 只是表达近似，不是源码原样；但结论不变：**再加 `project` 纯属冗余**。

`content_hash` 不适合作为真幂等键。因为这里要防的不是“字面文本重复”，而是“同一组 fact 再推一次”。同一 fact 集合理论上可能因为 splitter 或 content formatting 变化而重新分 chunk；这时 `content_hash` 会变，但 `root_insight_id` 不该变。源码自己已经承认内容相似去重有副作用，所以才加了相邻 chunk Jaccard ceiling，避免被 Engram 的内容去重误吞，见 `splitter.ts:141-185`。这正好说明：**内容相似性是启发式，不是 ownership key**。

SQLite 边界条件也要说清：如果只建

`UNIQUE (json_extract(source_trace,'$.root_insight_id'), json_extract(source_trace,'$.chunk_index')) WHERE origin='compost'`

还不够。因为当前 schema 不保证这两个 JSON 字段存在；而 SQLite `UNIQUE` 对 `NULL` 不会互斥。也就是说，坏 payload 仍可绕过去重。实现上至少要补 compost 专属 `CHECK(json_type(...)=...)`，否则这个 UNIQUE 不是硬约束，只是“对好客户端有效”。

## Q2 重复时行为

选 **return-existing-id**。

`silent skip` 太弱，客户端连自己撞了去重都不知道。`409` 看起来严格，实际上会把当前 writer/queue 语义搞坏：`writeInsight()` 对任何 `remember` 非 `ok` 都 enqueue，见 `writer.ts:138-157`；`flushPending()` 会不断重试所有 `committed_at IS NULL` 的记录，失败只会 `attempts += 1`，不会出队，见 `writer.ts:190-219` 与 `pending-writes.ts:114-132`。所以如果 Engram 把 duplicate 当 error，**PendingWritesQueue 会永久重试这条“已成功”的写入**。

`return-existing-id` 才是这里的 PUT 语义：一次 RTT，无 TOCTOU，队列把它当成功提交。并且改动面没有 `context.md` 说得那么大。Engram MCP 现在本来就返回整条 memory dict，adapter client 只是把里面的 `id` 抽出来，见 `Engram/src/engram/server.py:17-34`、`:37-70`，以及 `packages/compost-engram-adapter/src/mcp-stdio-client.ts:53-74`。也就是说，往返回体里加一个 `status: "created" | "existing"` 是**向后兼容增强**；旧客户端继续拿 `id` 就行。

## Q3 约束 scope

选 **`origin='compost'` only**。

这次不要顺手搞 origin-agnostic 范式。human/agent 侧目前没有类似 `root_insight_id` 的自然幂等键；`source_trace` 对它们既非必填，也无固定 shape。反过来，Engram 已经有一个**全局内容相似去重**启发式，且它根本不看 `origin`/`kind`，只看 `(content, project)`，见 `store.py:57-60`、`:147-182`。那套东西已经够“软”，但它不是这次要加的“硬唯一性”。把两件事混成一个 debate，只会扩大 blast radius。

所以 scope 应该明确成：**只对 `origin='compost'` 的、且 `source_trace` 满足 Compost contract 的 insight 行，施加硬 idempotency**。

## Q4 历史 4 行处理

如果 `context.md` 里那 4 行 audit 结果属实，我会 **删后两行，保留最早那组 chunk0/chunk1**。

这里我只能从代码上确认“怎么删”，不能从源码确认那 4 个具体 id/date 一定存在；那些是运行时数据，不在这五个文件里。处理方式上，**只删 `memories` 主表即可**，不要手动双删 side table，因为 migration 已有 `AFTER DELETE` trigger 负责清理 `compost_insight_sources`，见 `002_slice_b_compost_integration.sql:141-144`。保留最早一组可以保住原始 `created_at` 语义；然后再上线硬约束，防止新增。

## Cross-critique

我主要反对 **(b)**。

先说可实现性：当前 Compost adapter 的 `EngramMcpClient` 只有 `remember` / `invalidate`，根本没有 `recall`，见 `packages/compost-engram-adapter/src/writer.ts:47-54`。再说精度：Engram 的 `recall` 公开参数只有 `query/project/kind/path_scope/limit/budget`，没有 `source_trace.root_insight_id` / `chunk_index` 精确过滤，见 `Engram/src/engram/server.py:73-94` 与 `store.py:216-296`。所以 `(b)` 不是“加一段 pre-check”那么简单，而是**先扩 MCP surface，再造一个 exact-match 查询能力**。即便做完，`recall` 和 `remember` 之间仍然是标准 TOCTOU race，对多 producer 共享系统没有兜底价值。

顺手再批一句 `(a)+409`：它和现有 queue 机制直接冲突，上面已经给了代码证据；不 special-case duplicate 的话，就是把成功写入变成永久 pending。

## TL;DR

选 **(c)**：Engram 端做 compost 专属硬唯一，重复返回 existing id，不做客户端 pre-check。  
幂等键用 **`root_insight_id + chunk_index`**；`content_hash` 是启发式，不是 ownership key，`+project` 冗余。  
`context.md` 有两点不准：`store.py` 已有内容相似 dedup；schema 002 并未保证 `root_insight_id` 一定存在。
