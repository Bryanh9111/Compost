# Round 1 — Claude (Opus, moderator) — Debate 025

**Perspective**: long-term architecture coherence + 023/024 lessons + bootstrap dynamics over end-state idealism.

## Q1 reasoning architecture: **(c) Parallel + RRF**, with explicit derived_from write-back

(a) Gemini-graph-first 是产品身份正确但工程现实错。Codex 用代码证据 demolish 我自己 context.md 里"fact_links 主要是 contradiction/superseded"的措辞——更糟：production 整个仓里 `addLink` 唯一活跃写入点是 `reflect.ts:252-257` 而且只写 `contradicts`。对几乎空的图做 N-hop recursive CTE 拿不到任何东西，必然要 fall back ANN，那 (a) 在 bootstrap 期等于 (b) 加一份做无用功的 graph 调用。

(b) Sonnet-embedding-first 当下最简，但有 graceful upgrade path 缺陷。如果 L5 永远不写边，graph 永远稀疏，永远不能转向 (a)；那 L5 的"分析"就退化成"加好看 prompt 的 retrieval"——回到 Codex 担心的"不是 L5 是更绕的 L4"。

(c) Codex-parallel+RRF 唯一具备 graceful degradation：图稀疏时 RRF 输出 ≈ 纯 ANN（自然 (b) 行为），图变密时 RRF 自然加权图侧。Codex 还指出 RRF 已是 private impl 在 `search.ts:55-85`，提取成 reusable helper 是干净 refactor 不是 fork retrieval。

**关键补充（基于 Gemini 的"sixth option" link populator）**：(c) 必须配一个 write-back side-effect。每个 `reason()` 成功返回 chain 时，把 `seed_fact_id → derived_fact_id` 用 `addLink(..., "derived_from")` 写回。`fact-links.ts:19-25` 的 `derived_from` enum 已存在，零 schema 改动。L5 自己边产边消，graph 密度随产品使用单调增长。3 个月后回看 (c) 自然向 (a) 倾斜。

落地路径: `extractRrfMerge(graphCandidates, annCandidates)` → `runReasoning(seed, opts)` → `persistDerivedLinks(chain.derived_facts, seedId)`. 三个独立函数，可独立测。

## Q2 MVP slice: **(α) Cross-fact reasoning** — 4/4 收敛

附议三方。α 是唯一不需要新 schema（除了 Q3 的 reasoning_chains）就能 prove L5 retrieval+reasoning 路径的 slice。Codex 论证最准: γ hypothesis 需要 facts 表加 kind 列（`0001_init.sql:89-101` 当前没有 kind 字段），是大改；β 是 populator 不是 reasoner，不验证 chain quality；δ reflection 输出是问题不是断言，CI 不可断言。

## Q3 storage shape: **(B) `reasoning_chains` 新表** — 4/4 收敛

附议三方。已有共识理由不重述。补一个 future-proof 维度: 表 schema 应当带 `engram_insight_id TEXT NULLABLE`——L5 可选地把 chain push 给 Engram 作为 `kind=insight`（origin=compost），idempotency 由 debate 024 兜底。这样 (D) Engram-as-storage 不是"storage shape 选择"而是"distribution shape 选择"，跟 (B) 不冲突可叠加。

具体 schema:

```sql
CREATE TABLE reasoning_chains (
  chain_id TEXT PRIMARY KEY,                -- uuidv5(seed_fact_id || policy_version || sorted candidate_ids)
  seed_kind TEXT NOT NULL CHECK(seed_kind IN ('fact','question','gap','curiosity_cluster')),
  seed_id TEXT NOT NULL,                    -- fact_id / question_hash / problem_id / cluster_repr_id
  policy_version TEXT NOT NULL,             -- which reasoning policy produced this; pin for replay
  candidate_fact_ids_json TEXT NOT NULL,    -- JSON array of fact_ids retrieved
  edge_refs_json TEXT,                      -- JSON: which fact_links were traversed
  retrieval_trace_json TEXT NOT NULL,       -- {ann_top_k, fts_top_k, graph_hops, rrf_weights}
  answer_json TEXT NOT NULL,                -- {chain: string, confidence: number, llm_meta: {...}}
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale','superseded','user_rejected')),
  engram_insight_id TEXT,                   -- nullable; if present, this chain was distributed to Engram
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX idx_reasoning_chains_seed ON reasoning_chains(seed_kind, seed_id, status);
CREATE INDEX idx_reasoning_chains_engram ON reasoning_chains(engram_insight_id) WHERE engram_insight_id IS NOT NULL;
```

`chain_id` 是 deterministic UUIDv5——同样 (seed, policy_version, candidates) 重跑产同 ID，跟 debate 024 在 Engram 侧学到的 idempotency 范式一致。

## Q4 triggering: **(q) On-demand only**

附议 Sonnet/Codex 反 Gemini (r)。Gemini 的"analytical partner 必须 proactive"是真的产品方向，但**不能在 prove output 价值之前就开 LLM bg spend tap**。流程：
1. 现在 (q): `compost reason <seed>` + MCP `compost.reason`，dogfood 1-2 周积累 reasoning_chains 行
2. 看 chain quality 真实分布: 多少 confidence > 0.7 的 chain 用户 confirm, 多少被 dismiss
3. 用 confirm 率 > 50% + 至少 N 个高分 chain 作为开 (r) hybrid scheduler 的 GO 条件
4. (r) trigger: 高 ask_count gap 自动喂 reason()，缓存到 reasoning_chains，digest 顺路 surface

Gemini 的 proactive 价值 (r) 是 Phase 7 *后期*应该到达的形态，不是 entry gate。debate 023 §"现在做最小，后续按数据决"教训照搬。

## Q5 L5-internal ask: **(X) `gapThreshold: null`**

附议 Sonnet/Codex。Gemini Z 在 debate 023 已经 4/4 reject 过一次，理由没变：(Z) 要扩 `audit.ts:15-19` TS union + migration 扩 SQL CHECK，不是 zero-cost。Gemini "需要 reasoning 失败的 paper trail" 是真需求，但 **reasoning_chains.retrieval_trace_json + answer_json (Q3 B 选中) 已经是这个 paper trail**——`reason()` 失败时写 `status='active'` + answer_json 含 `{chain: null, reason: "ann_top_k empty"}`，零 schema 增量。

Gemini Z 跟 Q3 B 重复了：B 是 reasoning 的存储表，把 reasoning *失败*事件双写到 decision_audit 是 over-instrumented。

## Cross-critique

### 我的 context.md 两处事实错（接受 Codex 撤回）

1. **§Q1 (a) Pro/Con: "fact_links 当前主要是 contradiction/superseded link"** — 错。`0011_fact_links_and_health_fix.sql:18-24` 五个 kind 是 `supports/contradicts/elaborates/derived_from/same_subject`。**没有 `superseded`**——supersession 是 `facts.superseded_by` 列（`0001_init.sql:99`）+ archive 列（`0010_*:91-102`），不是 graph 边。正确措辞应是"production 写入密度上 contradicts 占绝大多数（仅 reflect.ts:252-257 一个 prod writer），其他 4 个 kind 仅 test fixture 用过"。
2. **§Reference 末尾: "`packages/compost-core/src/schema/migrations/0011_*.sql`"** — 路径错。实际是 `packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql`，没有 `migrations/` 子目录。

两条都按 Codex 接受 concede。

### 反驳 Gemini (a) graph-first

Gemini 的"L5 是 brain 不是 retrieval engine"product framing 我同意，但工程结论错。理由：
- 选 (a) 不会让 L5 自动变 brain。它会让 L5 第一次 invocation 直接撞 sparse graph 拿空结果，用户体验是"compost reason 输出空"，反推用户**不会再用** → 数据循环死掉，graph 永远不会变密 → (a) 永远是错的选择 → 自我应验。
- 选 (c) 配 derived_from write-back 才是真 brain bootstrap：第一次像 (b)，但每次产边，10 次后 graph 已经有"L5 自己产的语义边"，第 N 次 graph contribution 真有信号。这是 incremental pathway，不是 big-bang。

Gemini 的"link populator"作为 sixth option 我借用了——但它**不是替代 (a)/(b)/(c)，是 (c) 的隐藏子组件**。把它显式化是本 round 的贡献。

### 反驳 Gemini (Z) ask_gap audit

已上面 §Q5 处理。核心论点：Q3 B 选中后 reasoning_chains 表本身就是 paper trail，Z 是双写。

### 反驳 Sonnet (b) embedding-first

(b) 论证里"graph as post-hoc explanation/provenance trace"假设 graph 有 explanation 价值。若 graph 永远稀疏（无 write-back），fallback 到 graph 啥也没有。(b) 没有让 graph 变密的机制——选 (b) 等于在产品层放弃 graph 维度。**这是本辩论里 (b) 选项最大的隐藏代价**：选 (b) 就是默认 Compost 永远是 retrieval+LLM-summary，不是 brain。

## TL;DR

1. **(c) + 强制 derived_from write-back**：唯一兼容当前 graph 稀疏现实又不放弃 brain 路径的选择。
2. **(α/B/q/X) 全部附议三方收敛**: cross-fact slice 先做 + reasoning_chains 新表 + on-demand 触发 + L5-internal ask 静音。
3. **撤回 context.md 两处事实错**（fact_links 无 superseded kind / schema 路径无 migrations 子目录），按 Codex r001 接受。
