# Debate 025: Phase 7 L5 (Analytical reasoning) scope

**Topic**: 锁 L5 reasoning architecture + MVP slice + storage shape，让 Phase 7 第一行代码有方向
**Style**: quick / 1 round / cross-critique
**Advisors**: gemini, codex, sonnet + claude(opus) moderator
**Started**: 2026-04-24

## 背景

Phase 6 P0 + Phase 7 前置（debate 023 信号源 + debate 024 写入幂等）全部 ship。Compost 当前 L4 ✅，L5/L6 是 Phase 7 范围。停在 entry gate 上，要决"做什么 + 怎么做"才能动第一行 L5 代码。

ROADMAP §Phase 7 列了 5 个 L5 子能力，没有架构 / 优先级 / API：

- Cross-fact reasoning engine — graph traversal over `fact_links` + semantic similarity
- Pattern detection — cluster facts by theme / time / source
- Hypothesis generation — propose plausible unknowns (tagged hypothesis)
- User model update loop (实际 L6) — observed decisions → `user_patterns`
- Reflection prompts — generate questions for user

Phase 5 user-model design (`docs/phase-5-user-model-design.md`) 已锁 schema：`user_patterns` + `user_pattern_observations` + `user_pattern_events`（migration 0015 shipped），populator 待 L5 写。

## 已就位的 primitive (L5 可消费)

- `fact_links` table + recursive CTE traversal API（migration 0011, P0-3 ship）
- LanceDB ANN（Phase 1）+ FTS5（Phase 2）+ rerank（Phase 2）
- `ask()` core 含 LLM 合成 + breaker fallback + 现已下沉的 `logGap`
- Engram bidirectional：`stream_for_compost` 读（exclude origin=compost），`writeInsight` 写（hard idempotency since debate 024）
- `user_patterns` schema (migration 0015) — 等 populator
- `decision_audit` table — `wiki_rebuild` / `contradiction_arbitration` / `fact_excretion` / `profile_switch` 4 kind 已用

## 五个核心架构问题

### Q1 (Reasoning architecture)：graph / embedding / hybrid?

ROADMAP 说"graph traversal + semantic similarity"，hybrid 是默认。但具体怎么 hybrid？

- **(a) Graph-first**：从 seed fact 起跑 recursive CTE 沿 `fact_links` 走 N 跳，把候选集喂给 ANN/FTS rerank。Pro: 用上现成 link metadata；Con: `fact_links` 当前主要是 contradiction/superseded 链路，"主题相关" link 密度低
- **(b) Embedding-first**：从 seed embedding 跑 ANN k-NN，再用 graph 做 explanation/provenance trace。Pro: 召回不依赖 link 完整度；Con: 重复 query 路径，可能跟现有 `query()` 重叠太多
- **(c) Parallel + RRF**：graph k-hop 候选集 + ANN k-NN 候选集 → RRF merge → rerank。Pro: 复用 Phase 2 RRF 范式；Con: 双倍 retrieval 成本

### Q2 (MVP slice)：5 个子能力先做哪个？

每个对应不同的"能 prove L5 架构对"信号：

- **(α) Cross-fact reasoning** — 最基础，其他 4 个的底座；纯 retrieval + reasoning，无新存储 schema；输出"相关 fact 集 + 推理 chain"
- **(β) Pattern detection** — 写 `user_patterns`（schema ready），有清晰 user-visible 产物 (`compost user-model list`)；但本质是聚类不是 reasoning
- **(γ) Hypothesis generation** — 最产品化（"brain 提出未知"），LLM-heavy；需要新 storage/schema (新 fact kind？新 hypothesis table？)
- **(δ) Reflection prompts** — 最 user-distinctive ("brain 问我让我深思")；输出是问题不是断言，对错难评估
- **(ε) User model update loop** — 实际 L6 范围，依赖 (β)；slice 太大

### Q3 (Storage / output shape)：L5 产物存哪？

- 选项 A：现有 `facts` table + 新 `kind='hypothesis'` + 低 confidence (< 0.5)
- 选项 B：新 `reasoning_chains` 表（chain_id, seed_fact_id, derived_facts JSON, llm_trace, confidence, kind）
- 选项 C：直接复用 `decision_audit`（kind='reasoning_chain' / 'hypothesis'）+ evidence_refs_json
- 选项 D：写到 Engram 作为 `kind=insight`（origin=compost），让 idempotency 兜底重复推理

涉及的下游：`compost ask` 是否消费 hypothesis？digest 是否选 hypothesis？invalidate 链路如何处理？

### Q4 (Triggering)：scheduled vs on-demand?

- **(p) Scheduled** — 跟 reflect daemon 同步，新增 `startReasoningScheduler`，每 N 小时扫一次。Pro: 用户开 `compost ask` 时已有 cached chain；Con: LLM 持续 spend (单用户成本敏感)
- **(q) On-demand only** — `compost reason <seed>` / `compost hypothesis [topic]` 用户触发；MCP 暴露 `compost.reason`. Pro: 零 background cost；Con: 第一次调用慢，无 proactive 价值
- **(r) Hybrid** — 高价值 chain 缓存（如近期高 ask_count gap 自动 reason），其他 on-demand

### Q5 (L5 internal ask 信号语义) — debate 023/024 deferred

L5 reasoning 内部调 `ask()` 拉相关 fact，gap 信号怎么处理？

- 选项 X：`gapThreshold: null` 完全静音（debate 023 默认）— 简单但丢"L5 找不到东西"信号
- 选项 Y：加 `gapSource: "user" | "l5-internal" | "l5-hypothesis"` 标签到 logGap，curiosity / digest 可分流（Sonnet Q4 deferred）— 需 schema 变更（gaps 表加列 / 新 enum）
- 选项 Z：新增 `kind='ask_gap'` 写 `decision_audit`（Gemini Q3 deferred），target_id=question_hash，evidence_refs=hits.fact_ids — 需 migration 0018 扩 `AuditKind` SQL CHECK

## 硬约束

1. **debate 023 logGap 契约不破**：`AskOptions.gapThreshold?: number | null` 已是 public API
2. **debate 024 Engram idempotency 不破**：L5 写到 Engram 必须经 `EngramWriter.writeInsight`，依赖 `(root_insight_id, chunk_index)` 结构性 key
3. **HC-2 Engram zero-LLM**：L5 LLM 调用必须在 Compost 一侧；Engram 只读 / 写已合成 insight
4. **decision_audit kind freeze**：当前 4 kind 是 SQL CHECK 锁死的（`audit.ts:15-19` TS union + migration 0010），扩 kind 是 schema migration（不是 zero-cost）
5. **测试可验**：L5 输出主观，但必须有可 CI 的断言（snapshot 黄金答案 / 行为契约 / determinism guarantee 三选一）
6. **Single-user LLM 成本敏感**：Compost dogfood 是单用户作者本人，scheduled background LLM ≠ free
7. **L4 不破**：`gap-tracker` / `curiosity` / `digest` 模块不能因 L5 改动 schema
8. **Phase 5 user-model design 不重谈**：`user_patterns` schema 锁定，L5 只能 populate 不能 reschema

## 期望输出

四方结构化发言 + 最终 synthesis（debate 023/024 范式）。每位 advisor 必须：

1. 选 Q1 architecture 一个（a/b/c）
2. 选 Q2 MVP slice 一个（α/β/γ/δ；ε 默认 out of scope）
3. 选 Q3 storage shape 一个（A/B/C/D）
4. 选 Q4 trigger 模式一个（p/q/r）
5. 选 Q5 内部 ask 语义一个（X/Y/Z）
6. Cross-critique 至少一个其他 advisor 的方案（带 file:line 证据，验 context.md 准确性）
7. TL;DR 3 行

Synthesis 落 `debates/025-phase-7-l5-scope/synthesis.md`，带可执行 patch 顺序（哪个文件 / 哪个 schema / 哪个 test fixture 先动）。

## Reference

- ROADMAP §Phase 7 lines 610-617 / Self-evolution levels lines 264-273
- `docs/phase-5-user-model-design.md` — L6 schema 已就位 (migration 0015)
- debate 023 synthesis — gapThreshold null 默认 + 三个 deferred 项 (audit / gapSource / event-based)
- debate 024 synthesis — Engram idempotency 契约
- `packages/compost-core/src/query/ask.ts` — L5 内部 ask 入口候选
- `packages/compost-core/src/cognitive/{gap-tracker,curiosity,digest}.ts` — L4 模块（L5 可消费 gap clusters / curiosity matches）
- `packages/compost-core/src/schema/migrations/0011_*.sql` — `fact_links` recursive CTE 起点
