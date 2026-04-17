# 🐙 Claude (Opus) — Round 1 Analysis

## Pick: **E — stream-puller + ingest-adapter, mock MCP client (~300 LoC)**

与 Sonnet 一致. Gemini 选 F 的"架构纪律"直觉对了一半, 但忽略了两条 Sonnet 点出的硬障碍. 我补两个他们都没碰到的点, 并给出 Gemini F 理念能保留的 E-shape 折衷.

## 我的三条理由 (非重复 Sonnet)

### 1. F 的"架构纪律"是伪约束 — outbox + extract 从来不是 Compost 的 Substrate 统一入口

Gemini 说 "万物皆走 Outbox" 是纪律. **但 Compost 从未承诺这条**. 看 a861db4 的 Migration 0014 和 origin_hash 设计: `origin_hash = SHA-256(adapter|source_uri|idempotency_key)` — 每个 source 都有独立 adapter 身份, outbox 是 **claude-code hook / local-file / web-URL 三种 capture 模式的汇流**, 不是 "所有数据源的唯一入口". Engram 是第 4 种 capture 模式 (event stream), 和前三种**形态不同**: 前三种是 "抓原始文本 → NLP 抽 facts", Engram 是 "已结构化 fact 流"). 把它塞进 outbox + extract pipeline 就像把 RSS feed 当成 HTML 抓取 — 协议对不齐.

Substrate 约束是 "所有 observations 最终进 observations 表 + facts/chunks 表", **不是** "所有 observations 经过 outbox + extract". E 进 facts 表, 符合 Substrate.

### 2. Sonnet 的 R2 (raw_bytes 缺失问题) 可以在 E 里 elegantly 解: observations 行直接带 content

E 的 ingest-adapter 路径应该:
- 对每个 Engram entry, 直接 INSERT 到 observations (raw_bytes = utf-8 encoded entry.content), 但**不 enqueue 到 ingest_queue**
- 改为直接 INSERT 到 facts (subject/predicate/object 已从 Engram kind 推断, 或 fallback 为 kind 作为 predicate), 直接 INSERT 到 chunks (content 就是 entry.content)
- 跳过 Python extractor 整条 subprocess

这样 `SELECT observe_id, source_uri, mime_type, raw_bytes, metadata` 的 observation row 存在 (满足 Sonnet R2), 但 ingest_queue 不 claim (避免 extractor 幻觉). 路径明晰, raw_bytes 仅作 archive, 真正的 fact 数据从 Engram metadata 映射.

### 3. Gemini 的 echo loop 风险已被 Engram 侧消除 — 不是 Compost 要防的

Gemini R2 "S4 push 的 insight 被 S5 puller 拉回来" — **但 Engram ARCHITECTURE.md §7.1 明文**: `stream_for_compost(include_compost=False)` 是默认, 已经排除 `origin=compost`. 这个 feedback loop 风险不在我们防线. Compost 的 puller 默认调用即安全, 除非显式传 `include_compost=true` (admin/audit 用途).

真正的 echo loop 隐患: Compost pull Engram → 写 observation → 合成 insight → push 回 Engram → 下次 pull 再次被排除. 闭环不回流, 没问题. 这个我们不用额外防.

## 两个主要风险 (互补 Sonnet)

### R1: ingest-adapter fact 映射 schema 的"假确定性"

Engram entries 有 `kind: event | note | reflection | preference | goal | habit | person | insight`. 我们要把它映射到 Compost 的 `facts(subject, predicate, object)` — 但 **Engram 的 kind 跟 Compost SPO 三元组不天然对应**. 例如:

- `kind=preference, content="I prefer Go over Python"` → subject=user? predicate=prefers? object="Go over Python"?
- `kind=event, content="Attended sprint planning on 2026-04-15"` → subject=user? predicate=attended? object=sprint planning + date metadata?

这个映射是**有损的**, 要么我们接受 "不完美映射, 后续 Phase 7 reasoning 再精细化", 要么 S5 就开始设计一张 mapping table. 建议前者 (S5 scope 保守), 但在 ingest-adapter 里加一行 comment: "SPO 映射是 best-effort, Phase 7 会覆写".

### R2: mock EngramStreamClient 的 since cursor 类型漂移 (放大 Sonnet R1)

Sonnet 点了 mock drift, 但具体到 `since` cursor: Engram 侧 `stream_for_compost(since: str | None)` 参数是 ISO-8601 string 类型 (per MCP schema). 如果 mock 给成 `Date` object 或 unix int, 真实调用会 400 error 但 mock 绿. **Mitigation**: E 里定义 `EngramStreamClient` 接口时, 把 `since: string | null` 严格 `as const` 标记, 并在 test 里用 真实 stream_for_compost 的 zod schema 校验 mock 返回值的 shape (就像 S4 在 writer.ts 用 sourceTraceSchema 做契约的 shape 校验一样).

## 5 个辩论焦点立场

- **B/C 违反 anchor v2**: 显然 no-go. Gemini "认知断裂" 表述准确 — Substrate 对 Engram 半盲, Phase 7 reasoning 会漏 Engram 侧用户直录的 preference/goal/habit.
- **F vs E**: **E 胜**. F 的 "outbox 纪律" 是 Gemini 的想象约束, 实际 outbox 从不是万物入口 (3 capture 模式汇流, 非 4+); Engram 结构化 JSON 走 extractor 二次 NLP 会产生幻觉 facts (Sonnet 点, 实锤).
- **EngramMcpClient 归属**: interface 在 adapter, concrete 在 daemon. S4 已建立范式, S5 对称 (Sonnet 立场, 我 +1).
- **Phase 6 Curiosity 解锁时机**: S5 physically 解锁 (数据路径通), logically 延到 S6 (Curiosity 策略). Gemini 这条我赞同.
- **280-400 LoC 纪律**: 300 LoC 是甜点, 符合历史 ~400 均值. F 的 ~280 看似更小, 但隐藏 Migration 0016 + scheduler 改造 + 合同测试更新, 实际 total effort > E. 不要被静态 LoC 骗了.
- **reconcile tool**: S6. Sonnet 点对了 — S5 cursor 单调递增, reconcile 需要双向稳定后再做 full-scan diff.

## 如果用户选别的

- **选 A (Full vertical)**: 第一个 bug 是 concrete MCP client 的 MCP transport 层没有 S4 这种 mock test 基线, 真跑起来 MCP tool 调用失败但 test 通过.
- **选 B/C**: 不只是半残 — Session 6 要把另一半再补, 需求叠加时你会想 "要不都吸收回 S5", 然后就是 A 了. 不推荐.
- **选 D**: MCP transport 是 daemon 的责任, 写在 adapter 里会让 adapter 依赖 daemon 包 (循环依赖 / 或者把 MCP 抽象成第三包 — S5 来不及).
- **选 F**: 最痛的 bug — 你会花 2 小时调 Migration 0016 松绑 CHECK, 再花 4 小时发现 Python extractor 把 "user prefers Go" 当文本抽出 "user"/"prefers"/"Go" 三个无用 facts 扔进 DB, dedupe 都抓不住, 得加 wipe 脚本.

## 对 Gemini 的反驳收束

Gemini F 的灵魂是 "架构纪律 = 所有数据统一 pipeline". **但 Compost 的纪律从来是 "所有数据最终进 facts 表", 不是 "所有数据经过同一条 extract 管道"**. 局部最优 (outbox 复用) 背离了全局设计 (source capture 模式多元). E 是符合 **Compost 实际架构** 的选择, F 是符合 **想象架构** 的选择.

Final: E.
