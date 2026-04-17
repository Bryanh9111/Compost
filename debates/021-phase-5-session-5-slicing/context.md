# Debate 021 — Phase 5 Session 5 切片决策

**Debate ID**: 021-phase-5-session-5-slicing
**Rounds**: 1 (quick)
**Mode**: cross-critique, anchor-v2 alignment focus
**Advisors**: gemini, sonnet, claude-opus (codex timed out last round, optional retry)
**Started**: 2026-04-17T21:38:07Z

## Question

Compost Phase 5 Session 5 (~150-400 LoC 单次可 ship) 应选 A/B/C/D/E/F 中哪个切片? 必须评估与 anchor v2 骨架的对齐度, 不只是技术局部最优.

## 关键骨架约束 (anchor v2 `565f184a2fb1`, pinned)

- L0 产品身份: 个人 AI 大脑, Substrate↔Effector **双向核心非 opt-in**
- Compost 是 Engram 的**数据源** (ingest event 流) + **推送目标** (insight 回写) — 必须两边都通
- Phase 6 Curiosity agent 依赖 **push 通道 + Engram 事件流 pull 驱动**; 只做 push 会让 Curiosity 无数据可"好奇"
- Phase 7 reasoning 依赖 user_patterns 数据源; 若只本地 observations 会漏 Engram 场景 (用户直接录 Engram 的 preference/goal/habit 无法被 Compost 感知)

## Session 4 已 shipped (commit 1e6837b)

- Migration 0015: user_patterns + user_pattern_observations + user_pattern_events (schema only)
- packages/compost-engram-adapter/ 4 模块: constants + splitter + pending-writes + writer (write path)
- 374 → 416 tests, typecheck clean
- 6 条风险已识别 mitigation (R1-R6, 见 debates/020-*/synthesis.md)
- EngramMcpClient 接口留空 — concrete 实现归 daemon 侧

## Session 5 scope

完整 S5 ~800 LoC 若全干:
- `stream-puller.ts` — poll mcp__engram__stream_for_compost(since, limit=1000) 游标分批
- `ingest-adapter.ts` — Engram entry → Compost observation with source_kind=engram, idempotency_key=engram:<memory_id>
- `EngramMcpClient` concrete 默认实现 (MCP transport glue)
- `compost doctor --reconcile-engram` 对账工具
- observations 表扩展容纳 source_kind=engram

Session 5 切一块, 剩下留 Session 6/7.

## Options

### A. Full vertical (~400 LoC)
stream-puller + ingest-adapter + default EngramMcpClient + cursor 持久化 + 完整 test.
- Pro: 端到端 loop 合上, Phase 6 解锁.
- Con: 量上限, 层浅风险; daemon 侧耦合进 adapter.

### B. stream-puller + cursor only (~180 LoC)
只做 stream-puller.ts + cursor 持久化, mock MCP client, ingest 延后.
- Pro: 最独立组件先锁死.
- Con: 拉下来的数据无处去, **违反 anchor v2 双向核心** — 半残.

### C. ingest-adapter only (~150 LoC)
只做 Engram entry → Compost observation 的映射 + source_kind 扩展.
- Pro: pipeline 对接验证.
- Con: **无 pull 驱动**, 手工喂数据测, 不真实; **违反 anchor v2**.

### D. EngramMcpClient concrete first (~300 LoC)
先写 concrete MCP client, 然后 stream-puller + ingest.
- Pro: 写路径也能用上这个 client.
- Con: MCP glue 本质 daemon 责任, 拉 daemon 进 adapter 边界糊.

### E. stream-puller + ingest, no concrete client (~300 LoC)
stream-puller + ingest-adapter 完整, mock MCP client, concrete client 留 Session 6.
- Pro: 模块化闭合, 边界清晰, 和 S4 对称; **符合 anchor v2 双向**.
- Con: 离"真跑起来"差一步 (Session 6 加 client).

### F. stream-puller + skeletal ingest-via-outbox injection (~280 LoC)
stream-puller 完整, ingest 只做 "Engram entry → observe_outbox row" 薄注入, 完整 fact extraction 走现有 drain/extract pipeline (复用 374-test 覆盖路径).
- Pro: 比 E 小, 利用现有链路回归风险低; **符合 anchor v2 双向**; 避免重写 ingest 路径.
- Con: observe_outbox schema 可能需要扩展支持 engram source; dedupe 路径需跨进程协调 (stream-puller 和现有 drain worker).

## 辩论焦点 (必答)

1. **Anchor v2 对齐**: 哪些选项明文违反"双向核心非 opt-in"? B 和 C 是否是显而易见的 no-go?
2. **F vs E**: 复用 outbox 走现有 drain vs 新写 ingest 路径 — 哪个对 Compost 纪律更好? 复用现有 pipeline 的回归风险 vs 新路径的独立性?
3. **EngramMcpClient 归属**: adapter 内 (A/D) vs daemon 侧 (E/F) — 边界应该在哪?
4. **Phase 6 Curiosity 解锁时机**: 是否 S5 就该让 Curiosity 可感知 Engram 事件流, 还是可以再等一个 session?
5. **LoC 纪律**: 280-400 LoC 哪个对 "~400 LoC/session 观察值" 合理?
6. **reconcile tool** (compost doctor --reconcile-engram): 该进 S5 还是独立 S6?

## 决策约束

- User guardrail: decision surface > execution speed, 每步 3+ options.
- Anchor v2: Substrate↔Effector 双向核心**非 opt-in**, 违反者严格劣选.
- 前 sessions 实际 LoC: a861db4 (~500), a494c6a (~400), Session 4 (~350 + ~100 test = 450).
- 不变量: append-only (Engram side), HC-1 独立性, 2000-char cap, expires_at mandatory.
