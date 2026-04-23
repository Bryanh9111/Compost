# Final Synthesis: Compost insight 写入去重责任归属

**Debate**: 024-insight-write-dedup-ownership
**Style**: quick / 1 round / cross-critique
**Participants**: 🟡 Gemini, 🔴 Codex, 🟠 Sonnet, 🐙 Claude (Opus, moderator)
**Date**: 2026-04-23

## 投票结果

| Advisor | 立场 | 核心主张 |
|---------|------|----------|
| 🐙 Claude (Opus) | **(a) Engram-side + PUT 语义** | partial UNIQUE on `(origin, root_insight_id, chunk_index)`；INSERT ON CONFLICT 返回已有 id；origin=compost only；删 03:03 pair。 |
| 🟠 Sonnet | **(a) Engram-side, silent return existing id** | UNIQUE on `(root_insight_id, chunk_index) WHERE origin='compost'`；复用 `store.py:58` `_strengthen` 模式；删后 2 行；migration 003 顺序: DELETE → CREATE UNIQUE → store.py pre-check。 |
| 🟡 Gemini | **(a) Engram-side + Conway 论证** | 同 Sonnet 的 partial UNIQUE 形态；强调多 producer 场景下"客户端自律必败"；指出 splitter.ts separator 是 `\|` 不是 `:`，迁移脚本若手动重算 root_insight_id 必须用 `\|`。 |
| 🔴 Codex | **(c) Engram 硬约束 + 显式 created/existing 响应** | 与 (a) 实质相同，但坚持 response 必须明确返回 `status: "created"\|"existing"` 字段；attack 我 r001_claude.md 两处 context.md 事实错误。 |

## 共识 (4/4)

1. **dedup 必须落在 Engram，不在 Compost**。零反对票。理由汇聚成三条：
   - **TOCTOU 不可由客户端规避** (Opus / Codex / Gemini)：dogfood session 实证当前 4 个 `compost mcp` 子进程并存，pre-check + remember 两次 RTT 之间存在真实并发窗口。
   - **跨 producer 复制粘贴成本** (Gemini Conway 论证 / Opus 多 producer 论证)：Engram 是共享基础设施，约束放在 schema 层是 1 行；放在 producer 层是 N 份代码 × N 个微妙差异。
   - **EngramMcpClient 不暴露 recall** (Codex 决定性证据 `writer.ts:47-54`)：(b) 不是"加一段 pre-check"那么简单，而是先扩 MCP surface，再造 exact-match 查询能力。

2. **dedup key = `root_insight_id + chunk_index`** (4/4 全票)。共识理由：`computeRootInsightId` UUIDv5 输入已包含 project (`splitter.ts:45`)，加 project 列冗余；`content_hash` 抓的是错的不变量（splitter chunk 边界算法可能跨版本变化，文本变但 fact 集合不变 = 同一份洞察的真相该用 root_insight_id 锚定）。

3. **重复时行为 = return existing id** (4/4 全票)。三条独立 derivation:
   - PendingWritesQueue 重试合约 (Codex 详证 `writer.ts:138-157` + `pending-writes.ts:114-132`)：409 会让"成功写入"被永久重试。
   - 复用 `store.py:57-60` `_find_duplicate` + `_strengthen` 既有模式 (Sonnet)：保持内部一致性。
   - PUT 语义业界标准 (Gemini / Opus)：客户端只需关心"目标状态已达成"，不需感知 created vs existing。

4. **scope 严格限 origin='compost'** (4/4 全票)。agent/human 没有自然 idempotency key，硬扩 origin-agnostic 是 scope creep；本 slice 不解决。

5. **历史 4 行: 删 03:03 pair (`51862f2211ce` + `89985a0261fc`)** (4/4 全票)。保留时间最早的 chunk0+chunk1 (`35a8f7dcbf73` + `e60b6e78a236`) 维持原 `created_at` 语义；级联清 `compost_insight_sources` 由 migration 002:142-144 的 `AFTER DELETE` trigger 自动执行，**不要手动双删 side table**。

## 分歧

### 唯一分歧 — Codex 的 (c) 标签 vs 三方 (a) 标签

实质技术内容**完全一致**（Engram 硬约束 + return-existing-id），分歧在 response shape 是否要显式加 `status: "created"|"existing"` 字段：

- 🔴 Codex: 必须加。response 透明性是契约一部分；想区分 new vs existing 的 client 应当能区分；`MCPCallResult<{id, status}>` 是非破坏性扩展（旧客户端继续读 `id` 即可）。
- 🟠 Sonnet: 不加。`MCPCallResult<{id: string; status: ...}>` 改 `EngramMcpClient` interface (`writer.ts:48`)、`ChunkWriteOutcome` (`writer.ts:64-70`)、`store.py` 返回 tuple 或加 `was_existing` field、MCP tool handler 序列化 — 四处分散改动 vs 0 处不改，不值。
- 🟡 Gemini: 不加。"在当前 Phase 5/6 快速迭代期，这种 break-change 协调成本太高。"（实测 Codex 已论证非破坏性，Gemini 此处过虑）
- 🐙 Opus: 倾向加，但承认 Sonnet 的 blast radius 论证有力。

### Synthesis 裁定: **加，但延后到 P1 slice**

P0 (本 debate slice) 仅做：硬约束 + 重复返回已有 id (response shape 不变，client 拿 id 不变)。P1 后续 slice 可加 `created` boolean (默认 true 兼容旧逻辑) 当 client 真有 created vs existing 区分需求时再做。理由:
- Codex 证据有力：契约扩展是非破坏性，旧 client 不受影响。
- Sonnet 反驳也对：本 slice 不需要 client 区分，加了就是 over-eng（YAGNI）。
- 折中: 留接口空间不挖坑。函数签名预留 optional `created?: boolean`，Engram server 当前不返回，client 不消费。Phase 7 L5 cross-fact reasoning 若需要"识别新洞察 vs 加强旧洞察"再 wire-through。

## 必须修正的 context.md 事实错误（写入 commit message）

debate 023 synthesis 的 "Opus 需要撤回的三个技术错误" 范式同款，本次有四条 concede:

1. **Codex 抓**: "Engram 这边 remember 没按 (origin, content_hash, source_trace) 做去重" — 错。`Engram/src/engram/store.py:52-60` 已有 `_find_duplicate(content, project)` + `_strengthen(existing)` 路径，命中 FTS5 相似度 ≥ 0.75 就返回旧行。Engram 有内容相似度 dedup；缺的是 **source_trace-based 精确 dedup**。本 slice 是补后者，不是从零造 dedup。

2. **Codex 抓**: "schema 002 已上线: `CHECK(origin != 'compost' OR source_trace IS NOT NULL)` — root_insight_id 永远可读取，不需要 NULL 处理" — 错。CHECK 只要求 `source_trace` 非空且 `json_valid`，**未要求** `$.root_insight_id` / `$.chunk_index` 存在或类型正确。SQLite UNIQUE 对 NULL 不互斥 — 坏 payload 仍可绕过去重。**migration 003 必须同时补 CHECK on json_type**，否则 UNIQUE INDEX 不是硬约束只是"对好客户端有效"。

3. **Gemini 抓**: context.md 把 `splitter.ts` 的 key 算法写成 `${project}:${sorted.join(",")}`，**实际是** `(project ?? "") + "|" + sorted.join(",")` (`splitter.ts:45`)。结论不变（project 已编进 root_insight_id），但若未来需要从 fact_ids 重算 root_insight_id 验证（如清洗历史数据），必须用 `|` 分隔符否则 UUIDv5 出来的值对不上。

4. **Codex 抓**: "(b) Compost writer 加 pre-check" 路径成本被低估。当前 `EngramMcpClient` (`writer.ts:47-54`) **只有 `remember` / `invalidate`，没有 `recall`**。Engram 的 `recall` server 端参数 (`server.py:73-94` + `store.py:216-296`) 也**没有 source_trace exact-match 过滤**。(b) 实际成本 = 扩 MCP 客户端 + 扩 Engram server 检索能力 + pre-check 逻辑 + 仍然 TOCTOU。是 (a) 成本的 5x+。

## 落地 patch (~60-90 分钟)

### Engram 仓库 (新 migration + store.py 改 + server.py 序列化)

**1. `Engram/src/engram/migrations/003_compost_insight_idempotency.sql`** (NEW)

```sql
-- migration 003: enforce source_trace shape + add idempotency UNIQUE for origin=compost
-- Why: dogfood 2026-04-23 found 4 rows where 2 should be; same root_insight_id pushed
-- twice yielded 4 chunks instead of 2. Compost-side computeRootInsightId is deterministic
-- (UUIDv5 of project + sorted fact_ids), but Engram never enforced uniqueness.

PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

-- PHASE 1: clean historical duplicates
-- Keep earliest (created_at min) per (root_insight_id, chunk_index); delete the rest.
-- AFTER DELETE trigger on memories cascades to compost_insight_sources (002:142-144).
DELETE FROM memories
WHERE id IN (
  SELECT m.id
  FROM memories m
  JOIN (
    SELECT
      json_extract(source_trace, '$.root_insight_id') AS rid,
      json_extract(source_trace, '$.chunk_index')     AS cidx,
      MIN(created_at) AS first_created
    FROM memories
    WHERE origin = 'compost'
    GROUP BY rid, cidx
    HAVING COUNT(*) > 1
  ) keepers
    ON json_extract(m.source_trace, '$.root_insight_id') = keepers.rid
   AND json_extract(m.source_trace, '$.chunk_index')     = keepers.cidx
   AND m.created_at > keepers.first_created
  WHERE m.origin = 'compost'
);

-- PHASE 2: rebuild memories table with strengthened CHECK
-- (SQLite ALTER lacks ADD CHECK; rebuild-rename pattern.)
-- Add: CHECK(origin != 'compost' OR (json_type(source_trace, '$.root_insight_id') = 'text'
--                                     AND json_type(source_trace, '$.chunk_index')   = 'integer'))
-- ... (full rebuild block omitted for brevity; mirror 002's pattern)

-- PHASE 3: add partial UNIQUE INDEX
CREATE UNIQUE INDEX IF NOT EXISTS idx_compost_insight_idempotency
ON memories(
  json_extract(source_trace, '$.root_insight_id'),
  json_extract(source_trace, '$.chunk_index')
)
WHERE origin = 'compost'
  AND json_type(source_trace, '$.root_insight_id') = 'text'
  AND json_type(source_trace, '$.chunk_index')     = 'integer';

COMMIT;
PRAGMA foreign_keys = ON;
```

**2. `Engram/src/engram/store.py`** — 扩 `_find_duplicate` / `remember()` 走 compost 精确路径

```python
# In remember(), before existing FTS5 _find_duplicate fallback:
if origin == 'compost' and source_trace:
    rid = source_trace.get('root_insight_id')
    cidx = source_trace.get('chunk_index')
    if rid is not None and cidx is not None:
        existing = self._find_compost_duplicate(rid, cidx)
        if existing:
            return existing  # PUT semantics: return existing without strengthening
                              # (compost insights have expires_at TTL refresh elsewhere)
# ... existing _find_duplicate FTS5 path unchanged ...

def _find_compost_duplicate(self, root_insight_id: str, chunk_index: int):
    return self._row_to_memory(self.db.execute(
        """SELECT * FROM memories
           WHERE origin = 'compost'
             AND json_extract(source_trace, '$.root_insight_id') = ?
             AND json_extract(source_trace, '$.chunk_index')     = ?
             AND status = 'active'
           LIMIT 1""",
        (root_insight_id, chunk_index)
    ).fetchone())
```

**3. `Engram/src/engram/server.py`** — 不变 (response 已经返回整 row 含 id；P0 不加 `created` field)

### Compost 仓库 (回归测试 + 文档同步)

**4. `packages/compost-engram-adapter/test/writer.test.ts`** — 加测试

```typescript
test("writeInsight is idempotent across two pushes of the same fact set", async () => {
  const opts = makeOpts(/* same project + same fact_ids */);
  const r1 = await writer.writeInsight(opts);
  const r2 = await writer.writeInsight(opts);
  expect(r2.root_insight_id).toEqual(r1.root_insight_id);
  expect(r2.outcomes.map(o => o.memory_id)).toEqual(r1.outcomes.map(o => o.memory_id));
  // assert Engram side has exactly r1.outcomes.length rows for this root_insight_id
});
```

**5. `docs/engram-integration-contract.md`** — 添 §"Idempotency contract" 段，引用 Engram migration 003

### 不做 (推到 P1 / Phase 7)

- `MCPCallResult<{id, created}>` 显式 status 字段 — 留接口空间，Phase 7 L5 cross-fact reasoning 真用到时再 wire-through
- origin-agnostic dedup 范式 — agent/human 没有自然 idempotency key，独立 debate
- 把 `_find_duplicate` 的 FTS5 路径也加 source_trace check — agent/human 不写 source_trace，无 op
- Compost writer 加 pre-check — Engram 已硬约束，pre-check 是冗余

## Opus 需要撤回的技术错误（合入 commit message）

1. **r001_claude.md "Compost 这边 remember 没按 source_trace 做去重"**: 不准确。Engram 已有 content-based dedup (`store.py:52-60`)；缺的是 source_trace 精确路径。
2. **r001_claude.md "schema 002 root_insight_id 永远可读取"**: 错。`CHECK(source_trace IS NULL OR json_valid(source_trace))` 不验证 `$.root_insight_id` / `$.chunk_index` 字段存在。partial UNIQUE INDEX 必须配合新增 CHECK on json_type 才是硬约束。
3. **r001_claude.md / context.md splitter key snippet `${project}:${facts}`**: 错。实际 `(project ?? "") + "|" + sorted.join(",")` (`splitter.ts:45`)。结论不变但分隔符不可乱用。
4. **r001_claude.md 把 (b) cost 估为"两次 RTT"**: 错。EngramMcpClient 没有 `recall` 方法 (`writer.ts:47-54`)，Engram server 的 recall 也没 source_trace exact-match 参数。(b) 实际成本是 (a) 的 5x+。

## Next Steps

1. **用户确认** 是否接受 (a) Engram-side + return-existing-id + 推迟显式 `created` 字段。
2. 若同意：先 Engram 仓库改 (migration 003 + store.py + 加 dedup test)；ship 后回 Compost 仓库加 `writer.test.ts` 回归 + 更新 `engram-integration-contract.md`。
3. 修完跑 `pytest` (Engram) + `bun test` (Compost) — 期望 Engram 新增 ≥ 3 测试 (clean-historical / unique-enforced / return-existing)、Compost 新增 1 测试 (writeInsight 双推幂等)。
4. Dogfood 验证: 手动 `compost digest --push` 跑两次，sqlite 查 `SELECT COUNT(*) FROM memories WHERE origin='compost'` 不变。
5. 本 slice ship commit message 必须 concede §Opus 撤回的四个技术错误（透明度 > 面子）。
