# Round 1 — Claude (Opus, moderator) — Debate 024

## 选择: (a) Engram 侧加约束

理由短链：
1. **Schema-as-truth**: Engram 已经在 schema 002 上把 origin=compost 的"必须 source_trace"和"必须 expires_at"做成 CHECK 约束（`002_slice_b_compost_integration.sql:60-64`）。Idempotency 是同一类语义约束（"compost insight 必须可寻址且唯一"），归到同一层最一致。
2. **TOCTOU 在 (b) 不是边角案例，是常态**: 当前进程列表显示 4 个 `compost mcp` 子进程同时跑（dogfood session 实证）。Compost 侧 pre-check + remember 两次 RTT 之间有真实并发窗口。(a) 在 DB 层用 UNIQUE 一锤定音。
3. **Debate 022 §Q5 教训的自然延伸**: 我们已经把 `root_insight_id` 设计成 UUIDv5 deterministic seed (`splitter.ts:36-46`)，目的就是"两次相同输入产出相同 ID"。把这个不变量从"客户端约定"升级成"DB 强制"是纯收益；当时 022 拒绝合成 fact_id 选项 (b) 也是同一原则——idempotency seed 不能由各 producer 自由定义。

## Q1 dedup key shape: `(origin, root_insight_id, chunk_index)` — 三元组，不要 content_hash

- `root_insight_id` 已经把 (project, sorted fact_ids) 编码进 UUIDv5（`splitter.ts:42-46`），加 `project` 列冗余。
- 加 `origin` 列是必须的——partial UNIQUE 的 WHERE 子句要 `WHERE origin='compost'` (避免影响 agent/human 路径)，但索引列上显式带 origin 让查询计划器更容易命中。
- 加 `chunk_index` 是必须的——一个 root_insight_id 可对应多 chunk（4 行重复案例 = 2 推 × 2 chunk），key 必须把 chunk 维度算进去。
- 不用 `content_hash`: 抓的是错的不变量。如果 splitter 跨版本调整 chunk 边界（未来 split_strategy 从 sentence 改 paragraph），content_hash 会变但 root_insight_id 不变；后者才是"同一份洞察"的真相。

具体 SQL：

```sql
-- migration 003_compost_insight_idempotency.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_compost_insight_idempotency
ON memories(
  origin,
  json_extract(source_trace, '$.root_insight_id'),
  json_extract(source_trace, '$.chunk_index')
)
WHERE origin = 'compost';
```

## Q2 重复时行为: return-existing-id (PUT 语义)

三选项里 **silent return-existing-id 唯一与 PendingWritesQueue 至少一次重试合得拢**：

- silent skip (无 id 返回): client 拿不到 id 没法链 `compost_insight_sources` FK，破坏 Compost 侧 invalidation 路径
- 409 / 报错: PendingWritesQueue 在 `writer.ts:147-156` 把"任何 remember 失败"塞进重试队列，409 会被错误地视为 transient，永远卡死
- return-existing-id: 客户端拿到 id（无论是新建还是已存在），FK 写入照常，queue retry 幂等

实现层：Engram `remember()` 在 INSERT ... ON CONFLICT 时返回已存在 row 的 id，response 加可选字段 `created: bool`（compost 客户端可忽略；想区分 new vs existing 的 client 可读）。这是非破坏性扩展，不动现有 client 契约。

## Q3 约束 scope: 只对 origin=compost — 不要顺手扩 origin-agnostic

- 范式扩到 agent/human 听起来 DRY，但 agent/human 没有自然 idempotency key。`content_hash` 就是错的（同一段话两次"发现"是真重复还是不同 context 下的真两次写入？语义模糊）。
- agent 重复也不是同一类问题：agent 写入 `kind='procedure'` 同一段话两次，第二次的存在本身可能就是信号（"这事我又遇到了，加强 strength"）。Compost insight 不一样，它的"重复"严格意味着同输入。
- Scope creep 的钱花得不对。本 slice 只解决 compost 重复推送症状。

## Q4 历史 4 行处理: 删 02:13 pair，因为 chunk1 是 partial — 但这步要先验证

context.md §背景里 `substr(content,1,40)` 看到的两 chunk0 是同一份摘要开头，两 chunk1 是同一份继续段。**理论上 4 行内容应当 100% 重复**（同 root_insight_id + 同 chunk_index → splitter 是确定性的，应产相同 chunk）。

落地步骤：

```sql
-- 1. 验证全等
SELECT json_extract(source_trace,'$.root_insight_id'), json_extract(source_trace,'$.chunk_index'),
       COUNT(*), COUNT(DISTINCT content_hash)  -- content_hash 列假设存在；否则用 length+md5
FROM memories WHERE origin='compost' GROUP BY 1,2;
-- 期望: 每行 COUNT=2, COUNT(DISTINCT)=1

-- 2. 删 51862 / 89985 (后写)
DELETE FROM compost_insight_sources WHERE memory_id IN ('51862f2211ce', '89985a0261fc');
DELETE FROM memories WHERE id IN ('51862f2211ce', '89985a0261fc');

-- 3. 然后再加 UNIQUE INDEX (步骤 1 不删干净的话这一步会爆)
```

为什么留 02:13 pair: 时间最早，root_insight_id 一致，access_log 之类下游表（如果有）按时间序锚定到第一条更稳。

## Cross-critique: 攻击 (b) Compost-side pre-check

(b) 表面优势"不动 Engram"是假的便宜。三个真问题：

**1. TOCTOU 不是理论**: dogfood session 实证当前 4 个 `compost mcp` 子进程并存（PID 45060, 19598, 17029, 16800）。任意两个 process 同时跑 `compost digest --push`（或 scheduler 触发）会先后做 `recall(root_insight_id)`、各自得到 "不存在"、各自 remember——pre-check 0% 防护。`writer.ts:111` 的 async writeInsight 没有进程间锁。要补就得加 advisory lock 或文件锁，又是新依赖。

**2. 跨 producer 复制粘贴**: context.md §硬约束 R3 提到 "Engram 是多客户端共享系统"，未来如果 zyloapp 或 athena 也写 origin=compost insight（cross-project synthesizer），它们各自要再实现一遍 pre-check。约束放在 schema 层是 1 行 SQL；放在 producer 层是 N 份代码，且 N 个 producer 容易实现得有微妙差异（chunk_index 比较错位、recall filter 写错、超时处理不同）。

**3. 概念错位**: idempotency 是 storage layer 的不变量（"我不会让两个相同 key 的行存在"），不是 producer layer 的礼貌（"我尽量不重复发"）。如果 storage 不强制，再多 producer 自律都防不住 bug、并发、和未来 contributor。Engram 已经强制了"必须 source_trace + expires_at"，再加一条"必须不重复"是同类增量。

唯一站得住脚的 (b) 论证是"先用 Compost pre-check 验证 hypothesis，确认确实是 push 重跑而不是其他 root cause"。但这是 throwaway diagnostic，不是 long-term solution。本 debate 是后者。

## TL;DR

1. (a) Engram 加 partial UNIQUE INDEX `WHERE origin='compost'`，key = `(origin, root_insight_id, chunk_index)`。
2. 行为 = INSERT ON CONFLICT 返回已存在 id（PUT 语义），non-breaking，与 PendingWritesQueue 至少一次重试天然兼容。
3. 历史 4 行：先 DELETE 02:13 之后写的 2 行（51862/89985）+ cascade FK，再创建 UNIQUE INDEX；同步加 reproduction test 防回归。
