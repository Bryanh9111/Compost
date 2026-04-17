# Final Synthesis — Debate 021

**Question**: Compost Phase 5 Session 5 应选 A/B/C/D/E/F 中哪个切片?

**Participants**: 🟡 Gemini (F), 🟠 Sonnet (E), 🐙 Opus (E). Codex 未参战 (S4 连败后未重试; 两方一致 + Opus 一致情况下裁决共识 > 70%).

**Verdict**: **Option E — stream-puller + ingest-adapter, mock MCP client (~300 LoC)**. 2-1 结果, 但关键是 F 方论点被 **具体代码行号反驳**, 非主观分歧.

## Summary of perspectives

### 🟡 Gemini — Pick F

**核心论点**: 复用 outbox + drain/extract pipeline 是 "架构纪律"; 强制 Engram 数据遵循与本地文件一致的归一化与提取标准, 避免 compost-ingest 特例. Phase 6 Curiosity 物理解锁但逻辑延后, 280 LoC 甜点, reconcile 独立 S6.

**反方质疑**: 把 outbox 当 "万物入口" 是过度泛化 — outbox 在 Compost 里只是 claude-code / local-file / web 三种 **capture** 模式的汇流表, 不是所有 observation 的必经之路.

### 🟠 Sonnet — Pick E (技术钉桩)

**两个决定性具体障碍 (对 F 有效, 对 E 无效)**:

1. **`packages/compost-core/src/schema/0005_merged_outbox.sql:14`** 的 CHECK 约束明文限制 `source_kind IN ('local-file','local-dir','web','claude-code','host-adapter','sensory')`. F 要么新 migration 松绑 (touch drain 合同), 要么伪装成 `host-adapter` (污染 source attribution). 不免费.

2. **`packages/compost-daemon/src/scheduler.ts:286`** 把 `raw_bytes.toString("utf-8")` pipe 到 Python extractor (line 295-322). Engram 条目是**已结构化 JSON** (Engram remember() 已解析好 subject/predicate/object 语义), 强行走 extractor 会二次 NLP 幻觉 facts 或压扁已有结构.

**E 的两个 2am 风险**:
- R1 mock drift: `EngramStreamClient` mock 接口与真实 `stream_for_compost` 漂移, since cursor 类型从 ISO string 变 unix int 类似. S6 concrete 落地时 runtime 沉默失败.
- R2 observations row 完整性: ingest-adapter 必须产出满足 `SELECT observe_id, source_uri, mime_type, raw_bytes` 的 row, 否则 claimOne 空跑 "observation not found".

### 🐙 Opus — Pick E (战略钉桩, 补 Sonnet 漏点)

**补充论点**:

1. **F "outbox 纪律" 是伪约束** — Compost 从未承诺 outbox 是万物入口. origin_hash 设计 (Migration 0014) 明示每 source 独立 adapter 身份. Engram 是第 4 种 capture 模式, 协议跟前 3 种不同, 不该强塞. Substrate 约束是 "所有 observations 最终进 facts/chunks 表", 不是 "所有 observations 经过 extract". E 进 facts 符合 Substrate 语义.

2. **Sonnet R2 的解法**: E 的 ingest-adapter 应该 INSERT observations (raw_bytes = entry.content utf-8 encoded) + **直接 INSERT facts + chunks** (跳过 ingest_queue 和 Python extractor). 这样 row 存在满足引用完整性, 但不会被 extractor 幻觉.

3. **Gemini echo loop 风险被 Engram 侧消除** — ARCHITECTURE.md §7.1 明文 `stream_for_compost(include_compost=False)` 默认排除 `origin=compost`. 这个防线不需要 Compost 加.

**Opus 新识别风险**:
- R3 fact SPO mapping 的"假确定性": Engram kind (preference/goal/habit/event) ↔ Compost facts(subject,predicate,object) 映射本质有损. 接受 "best-effort, Phase 7 reasoning 再精细化" + 加 comment 标记.

### 🔴 Codex — 未参战

Session 4 debate 020 起 23min 死锁未重试, 本轮直接跳过. 两方 (Gemini + Sonnet + Opus) 已足够共识. 缺席影响: 少一个独立训练族的 "second ground-truth" 视角, 但本轮争议是 具体代码行号级的技术判断, 不是主观偏好, 影响有限.

## Areas of agreement (3 respondents all converged)

1. **B/C 显见 no-go** — 违反 anchor v2 "双向核心非 opt-in" 硬约束. Gemini 叫 "认知断裂", Sonnet 叫 "half-shipped", Opus 叫 "Substrate 对 Engram 半盲". 三个表述同义.
2. **EngramMcpClient 接口 in adapter, concrete in daemon** — 与 S4 对称.
3. **Phase 6 Curiosity**: S5 physically 解锁 (数据路径通), logically 延到 S6 (Curiosity 策略).
4. **reconcile tool 独立 S6** — S5 cursor 单调递增, reconcile 需要双向稳定后做 full-scan diff.
5. **280-400 LoC 甜点**: E 的 300 LoC 合理, A 的 400 超纪律.

## Areas of disagreement → resolved

**F vs E** — Gemini 的 F 被 **两条具体代码行号反驳** (schema CHECK + extractor subprocess 不适配结构化 JSON). Gemini 的灵魂是 "统一 pipeline", Opus 指出 "Compost 实际从未统一在 extractor 上". 共识收束到 E.

## Risk consensus (去重合并)

| # | 风险 | 来自 | Mitigation |
|---|---|---|---|
| R1 | Mock drift vs 真实 stream_for_compost (since 类型 / 分页) | Sonnet + Opus | EngramStreamClient 接口用严格类型 + zod schema 校验 mock 返回 shape (对齐 S4 sourceTraceSchema 模式) |
| R2 | observations row 完整性 — raw_bytes 缺失 → claimOne 空跑 | Sonnet | ingest-adapter INSERT observations 时 raw_bytes = utf-8(entry.content); **不 enqueue 到 ingest_queue**, 直接 INSERT facts + chunks (Opus 解法) |
| R3 | Engram kind → Compost SPO 映射有损 | Opus | Best-effort 映射, comment 标记 "Phase 7 reasoning 覆写"; 不阻 S5 |
| R4 | (已被 Engram 侧消除, 不需要 Compost 额外防) feedback loop | Gemini 提, Opus 驳 | Engram ARCHITECTURE §7.1: stream_for_compost(include_compost=False) 默认排除 origin=compost |
| R5 (from S4) | 写路径盲写无反向验证 | 至本 debate 已部分解 | S5 E 方案 stream 拉到本地 = 可从 Engram 查自己写的 insight (虽默认排除, 但可 include_compost=true 调试) |

## Recommended path forward — Session 5 execution plan

**Scope (~300 LoC)**:

1. **`packages/compost-engram-adapter/src/stream-puller.ts`** (~120 LoC)
   - `EngramStreamClient` 接口 (since: string | null, kinds?, project?, limit=1000, include_compost=false)
   - `StreamPuller` class: cursor 持久化在 `~/.compost/engram-cursor.json` (单文件 ISO-8601 since + last_memory_id)
   - `pullBatch()` → 调 client → 返回 entries 列表; `advance(cursor)` 更新 cursor
   - 每轮 entries 遍历 emit 给 ingest-adapter
   - 测试: mock client + 空批次 + 分页 + cursor 持久化往返

2. **`packages/compost-engram-adapter/src/ingest-adapter.ts`** (~130 LoC)
   - `mapEngramToFact(entry): {observation, facts[], chunks[]}` — kind → SPO 映射, best-effort + comment
   - `ingestEntry(db, entry)` — 直接 INSERT observations (source_kind='engram' 仅在 source 表; **不走 outbox**) + INSERT facts + INSERT chunks; 使用 idempotency_key=`engram:<memory_id>` dedupe
   - 测试: kind=preference/goal/habit/event 各一个映射 smoke test + dedupe 测试 + source table 种子

3. **Source table engram 种子** (~20 LoC, 可能小 Migration 0016 或 seed)
   - source.id = 'engram-stream', kind = 'sensory' (复用已有 kind, 因为 Engram 是 event stream; **不新增 enum**, 避免 CHECK 改动)
   - source_uri = `engram://memory/<memory_id>`
   - 或者考虑 Migration 0016 加 `source.kind='engram'` (若 'sensory' 语义错位太严重)

4. **合同测试** (~30 LoC)
   - zod schema 校验 mock EngramStreamClient 返回的 entries 满足 ARCHITECTURE §7.1 9-key contract shape

**Deferred to Session 6**:
- Concrete `EngramStreamClient` MCP transport 实现 (daemon 侧)
- Concrete `EngramMcpClient` 实现 (S4 遗留)
- `compost doctor --reconcile-engram` 对账工具
- Phase 6 Curiosity agent 策略层

**Predicted LoC**: 280-320.
**Predicted tests**: +15-20 (splitter 套路).
**Test suite**: 416 → ~435.

## Next steps (concrete)

1. **用户确认 E** → 我开 session 5 execution (按上面 4 模块顺序)
2. **或** session 5 加 /plan-eng-review 一层 (L1 gstack) 把 `source.kind='engram'` vs 复用 'sensory' 决定死先
3. **或** 跑 round 2 debate 只辩 R3 (SPO 映射 schema)

---

**Debate folder**: `debates/021-phase-5-session-5-slicing/`
**Cost**: Gemini + Sonnet + Opus tokens. Codex 未参战 = 0 tokens.
