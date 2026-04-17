# 🐙 Claude (Opus) — Round 1 Analysis

## Pick: **B — Write-path vertical (~350 LoC)**

与 Gemini / Sonnet 一致. 但推荐理由与他们略有差异, 下面补足他们没点到的角度.

## 三条技术理由 (非重复 Gemini/Sonnet)

### 1. `remember(origin='compost')` 是 Engram `_map_insight_sources` 的唯一触发点

Contract §Compost→Engram 明写: 不存在独立 `write_compost_insight` tool. Compost 的 writer.ts 不写 `remember`, 就没有任何客户端测得到 Engram 的 `compost_insight_sources` 反查表是否真的被正确填充. 这个表是 `invalidate_compost_fact` 的反查索引, 如果 writer 侧 source_trace.compost_fact_ids 格式与 Engram `_map_insight_sources` 解析不一致 (e.g. 字段名 drift), 后续 invalidate 会静默失败 — 测不到, 但会在用户发现 "insight 说废了却还在 recall" 时才暴露. **Session 4 不落 writer, 这个 drift 没有 fixture 能锁定.**

### 2. Option D (read-first) 的 dedup 路径比看起来脆弱

`idempotency_key = engram:<memory_id>` 看似 clean, 但 Compost 现有 observe pipeline 的 idempotency 是基于 `origin_hash` (Migration 0014 刚落). 引入 engram 源需要:
- 新 `source_kind=engram` 的 adapter
- `observations.source_metadata` JSON 扩展字段 (Engram `memory_id` + `updated_at` 存哪)
- origin_hash 计算函数需要判断 `source_kind=engram` 时用 Engram `memory_id` 而非 content hash (否则 Engram 的正常 content 重写会被误判为新 observation)

这些都是 **新 Migration + pipeline 改动**, 不是 "写个 stream-puller 就完" 的量级. D 表面 350 LoC, 实际更接近 500+, 且碰到 Migration 0014 的刚落地代码路径. 风险比 B 大.

### 3. Migration 0015 和 writer 的 schema 可解耦, 但 LoC 搭便车几乎零成本

`user_patterns` 三表与 adapter 写路径无直接 FK — adapter 先落, Migration 0015 后落完全可行. 但 Migration 0015 SQL 文件 ~80 LoC + migrator pickup 已有现成测试模板 (见 `packages/compost-core/src/schema/0014_origin_hash_and_method.sql` + `0014_` 相关 test), 复制粘贴 <30 分钟. Phase 7 等得起, 但既然搭便车成本是 session budget 的 15-20%, **先落比后落省一次 context switch**.

## 两个主要风险 (互补 Sonnet 的两点)

### 1. `source_trace` JSON schema 未冻结就写 writer

Contract 只列了字段名, 没给出 JSON Schema 校验器. 如果 writer.ts 直接手写 `{compost_fact_ids: [...], root_insight_id: ...}` 而不用 zod/ajv 校验, 一旦 Phase 7 reasoning 调 writer 时字段名敲错 (e.g. `compost_fact_id` 单数), Engram 接收后 `_map_insight_sources` 看不到任何 fact_ids, `compost_insight_sources` 反查表空. 错误 silent. **Mitigation**: writer.ts 第一个函数应该是 `validateSourceTrace(): SourceTrace` (zod schema), 非可选.

### 2. 离线队列的 `expires_at` drift (Sonnet 已指出) 有一个更深的变种

Sonnet 说队列入队时间 vs flush 时间导致 TTL 缩短. 更深: 如果 flush 时 Engram 已经超过 90 天 grace window + 30 天 physical delete grace, `remember` 成功写入但 Engram 立即 GC — writer 收到 success response, 但数据 0 秒后就没了. **Mitigation**: writer flush 前检查 `Date.now() - entry.synthesized_at < expires_at - now`, 否则丢弃并记 log. 不是 B 范围内必做, 但应文档化.

## 5 个辩论焦点

- **Write-first or read-first?** Write-first. 理由: `remember(origin='compost')` 是整个双向核心的主权验证点 — 这个通了, Engram 信 Compost 是合法 origin; read-side 只是一个普通轮询 adapter, 风险低, 但没有 write 先通, Compost 单纯消费 Engram 等于 Engram 的下游 client, 不是 Substrate.
- **Migration 0015 本 session 做?** 做. 成本低 (80 LoC + 20 LoC test), 解 Phase 7 阻塞, 且与 adapter 无耦合所以零 risk.
- **Splitter-only (E) 过度?** 过度. Sonnet 论点对: UUIDv5 namespace 常量漂移只有在 writer 消费时才暴露. 单独测 splitter 的确定性 without writer consumer = 信噪比低.
- **500-600 LoC 单 session 太激进?** 激进. 非 LoC 问题, 是 **每层浅** 问题 — 四模块各 100-150 LoC 不足以把 contract 的 invariants 真正锁住 (尤其 pending-writes 的 2-phase invalidate/rewrite log). 留给 session 5 的 stream-puller 反而能用上 B 落下来的 pending-writes 经验.
- **pending-writes.db 跟 writer 一起还是独立?** 一起. Sonnet 的理由准: queue serialization format 必须对 writer call signature 做 fixture, 独立设计 = 下次改 writer 签名就要动 queue schema = 你没有 migration 系统.

## 如果用户选了别的

- **选 A**: 最该警惕 Session 5-7 反而会堆积 "四模块同时做" 的压力, 本 session 节省的风险被下 session 放大.
- **选 C**: Sonnet 已点: stream-puller 的 origin=compost 过滤在浅实现里丢掉, 导致回环. 这是最严重的, 因为回环后 Compost 会对自己的 insight 再 synthesize, 数据爆炸.
- **选 D**: 我上面 ## 三.2 已展开: dedup 路径比看起来脆, 且撞 Migration 0014 刚落的 origin_hash 代码路径.
- **选 E**: 假锁 — splitter 单独绿, writer 上线后 UUIDv5 namespace/字段名 drift 一样会翻车.

## 我对 B 的细化建议

B 执行时, **先写 writer 的 zod source_trace schema + splitter 的 UUIDv5 namespace 常量 (单 constants.ts)** — 这两个是 Sonnet/我都点到的 drift 风险点, 放在两个模块之间的共享文件, 强制两侧 import 同一 source.
