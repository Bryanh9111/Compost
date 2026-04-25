# Final Synthesis: Phase 7 L5 (Analytical reasoning) scope

**Debate**: 025-phase-7-l5-scope
**Style**: quick / 1 round / cross-critique
**Participants**: 🟡 Gemini, 🔴 Codex, 🟠 Sonnet, 🐙 Claude (Opus, moderator)
**Date**: 2026-04-24

## 投票结果

| Advisor | Q1 arch | Q2 slice | Q3 store | Q4 trigger | Q5 internal-ask |
|---------|---------|----------|----------|------------|-----------------|
| 🐙 Claude (Opus) | **(c)** parallel+RRF + derived_from write-back | (α) | (B) | (q) | (X) |
| 🟠 Sonnet | (b) embedding-first | (α) | (B) | (q) | (X) |
| 🟡 Gemini | (a) graph-first | (α) | (B) | (r) hybrid | (Z) ask_gap audit |
| 🔴 Codex | (c) parallel+RRF | (α) | (B) | (q) | (X) |

## 共识区

**4/4 全票通过**:

- **Q2 (α) Cross-fact reasoning** 是 MVP slice。理由汇聚：β pattern detection 是聚类不是推理（Sonnet+Opus）；γ hypothesis 需要 facts 表加 `kind` 列（`0001_init.sql:89-101` 当前没有，Codex 实证）；δ reflection 输出无 CI 断言；ε 是 L6 范围。α 是 fail-fast 唯一选择——若 LLM-over-retrieval 输出垃圾，1 个 slice 内就发现，零 schema rollback。
- **Q3 (B) `reasoning_chains` 新表**。Codex+Sonnet 用 `audit.ts:15-19` TS union + migration 0010 SQL CHECK 双锁证据 demolish (C) decision_audit reuse；Gemini 用 Conway 论证 demolish (A) 污染 facts 表 / (D) Engram-as-scratchpad；Sonnet 用 `digest.ts:101-135` confidence 过滤证据 demolish (A) 的 digest 中毒风险。

**3/4（Gemini 独排）**:

- **Q4 (q) On-demand only**。Sonnet+Codex+Opus 反 Gemini (r) 的论点统一：HC-6 单用户 LLM 成本敏感 + (r) 的"high-value chain auto-trigger"在没看到 chain quality 真实分布之前就是 premature optimization。Gemini 的 proactive 产品方向真，但放 entry gate 错。**升级路径明确**：dogfood 1-2 周后用 confirm 率 + N 高分 chain 作为开 (r) 的 GO 条件。
- **Q5 (X) `gapThreshold: null`**。debate 023 §Q4 已 4/4 立同选项；本轮只是 Gemini 试图重启 (Z) ask_gap audit kind。Codex+Sonnet+Opus 一致反驳：(Z) 要扩 `audit.ts:15-19` TS union + migration SQL CHECK = debate 023 已 4/4 reject 过的 schema 增量。**Opus 关键补充**：Q3 (B) 选中后 `reasoning_chains.retrieval_trace_json + answer_json` 已经是 reasoning 失败 paper trail——(Z) 跟 (B) 重复双写，不是新 telemetry 是 over-instrumentation。

## 分歧区

### 唯一真分歧 — Q1 三方各 1 票

每方理由都站得住，分歧是 product-vs-engineering 时间观:

- 🟡 **(a) graph-first** (Gemini): "L5 = brain 不是 smart search engine" 产品身份正确。但被 Codex 用代码证据 demolish 现状: `addLink` 全仓 production writer 唯一活跃点是 `reflect.ts:252-257`，只写 `contradicts`。`fact_links` 五个 kind (`0011_fact_links_and_health_fix.sql:18-24`) 中其他 4 种仅 test fixture 用过。production graph 几乎空——选 (a) 第一次 reason() 直接撞空，用户不再用，数据循环死掉，graph 永远不变密 → (a) 永远是错选 → self-fulfilling。
- 🟠 **(b) embedding-first** (Sonnet): bootstrap 期最简单，复用现成 ANN+rerank，零 graph 风险。但 **没有让 graph 变密的机制** = 选 (b) 等于产品层默认 Compost 永远是 retrieval+LLM-summary，不再是 brain。
- 🔴/🐙 **(c) parallel + RRF** (Codex+Opus): 唯一具备 graceful degradation 路径——graph 稀疏时 RRF 输出 ≈ 纯 ANN（自然 (b) 行为），随 derived_from 边增长自然加权图侧。Codex 补充：现成 RRF impl 在 `search.ts:55-85` private，提取 reusable helper 是干净 refactor，不是 fork retrieval。**Opus 关键补充（吸收 Gemini 的"sixth option" link populator）**：(c) 必须配 **强制 `derived_from` write-back side-effect**——每次 `reason()` 成功 chain 时通过 `addLink(seedFactId, derivedFactId, "derived_from")` 写边回 `fact_links`（`fact-links.ts:19-25` enum 已含此 kind，零 schema 改动）。L5 自己边产边消，graph 密度随产品使用单调增长。3 个月后回看 (c) 自然向 (a) 倾斜——这才是 Gemini brain identity 的真实 incremental pathway，不是 big-bang。

### Synthesis 裁定: **(c) + 强制 derived_from write-back**

Tiebreak rationale:
1. **graceful degradation > big-bang**：(c) 在 bootstrap 期表现 = (b)，在 graph 密度上来后表现 = (a)。无需切换架构。
2. **(c) 自带 graph 增密机制**：write-back 是 closed loop，解决 (a) 永久 sparse 自我应验问题，又解决 (b) 永远 retrieval-only 产品死结。
3. **现成代码复用**：`search.ts:55-85` RRF + `lancedb.ts:76-95` ANN + `fact-links.ts:182-247` recursive CTE 都已就位，主要工作是 extract 成 reusable helper + 编排，不是从零造。
4. **测试可断言**：sparse graph 时 RRF output 等于 ANN-only（确定性可断言）；dense graph 时 graph contribution 非零（fixture 可注入）。

## 落地 patch（~6-9 小时实施估）

### Step 1: Migration 0018 — `reasoning_chains` 表

`packages/compost-core/src/schema/0018_reasoning_chains.sql`（注意：路径是 `src/schema/`，**不是** `src/schema/migrations/`——Codex 指出 context.md 路径错）

```sql
BEGIN IMMEDIATE;

CREATE TABLE reasoning_chains (
  chain_id TEXT PRIMARY KEY,                     -- uuidv5(seed_kind || seed_id || policy_version || sorted candidate_ids)
  seed_kind TEXT NOT NULL CHECK(seed_kind IN ('fact','question','gap','curiosity_cluster')),
  seed_id TEXT NOT NULL,                         -- fact_id / question_hash / problem_id / cluster_repr_id
  policy_version TEXT NOT NULL,                  -- pin for replay; first version: "l5-v1"
  candidate_fact_ids_json TEXT NOT NULL,         -- JSON array
  edge_refs_json TEXT,                           -- JSON: which fact_links rows were traversed
  retrieval_trace_json TEXT NOT NULL,            -- {ann_top_k, fts_top_k, graph_hops, rrf_weights, ann_count, graph_count}
  answer_json TEXT NOT NULL,                     -- {chain: string|null, confidence, llm_meta, failure_reason?}
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','stale','superseded','user_rejected')),
  engram_insight_id TEXT,                        -- nullable; if pushed to Engram, the returned memory_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX idx_reasoning_chains_seed
  ON reasoning_chains(seed_kind, seed_id, status);

CREATE INDEX idx_reasoning_chains_engram
  ON reasoning_chains(engram_insight_id)
  WHERE engram_insight_id IS NOT NULL;

COMMIT;
```

### Step 2: `packages/compost-core/src/cognitive/reasoning.ts` (NEW, ~250 LoC)

API surface:
```typescript
export const POLICY_VERSION = "l5-v1";

export interface ReasoningOptions {
  topK?: number;           // candidate set size, default 10
  graphHops?: number;      // recursive CTE depth, default 2
  llm?: LlmRegistry;       // injectable for tests
  noLinkWriteback?: boolean; // for tests / dry-run
  policyVersion?: string;  // default POLICY_VERSION
}

export interface ReasoningChain {
  chain_id: string;
  seed_kind: SeedKind;
  seed_id: string;
  candidates: QueryHit[];
  chain: string | null;
  confidence: number;
  retrieval_trace: RetrievalTrace;
  failure_reason?: string;
}

export function computeChainId(...): string;            // uuidv5; deterministic
export async function runReasoning(db, seed, opts): Promise<ReasoningChain>;
export function persistDerivedLinks(db, chain): void;   // idempotent via INSERT OR IGNORE on fact_links
export function getChainsBySeed(db, seedKind, seedId): ReasoningChain[];
```

Internal flow:
1. Resolve seed → fact_ids set (one for `fact`, query for others)
2. Parallel: ANN k-NN over LanceDB + graph recursive CTE k-hop
3. RRF merge using extracted `rrfMerge(...)` helper from `search.ts`
4. Compute `chain_id` from sorted candidate_ids
5. Check if chain_id already exists (idempotency, debate 024 范式) → return existing if status=active
6. Call `answerLLM.generate` with `{gapThreshold: null}` (HC-1, debate 023)
7. Persist row to `reasoning_chains`
8. If `!noLinkWriteback`: `persistDerivedLinks` writes `addLink(seedFactId, candidateFactId, "derived_from")` for each candidate (INSERT OR IGNORE on fact_links composite key)

### Step 3: 提取 `rrfMerge` from `search.ts`

`packages/compost-core/src/query/rrf.ts` (NEW): pure function `rrfMerge(rankedLists: Array<{ids: string[], weight?: number}>, opts: {k?: number}): string[]`. `search.ts:55-85` 改为调用这个 helper。零行为变化，纯重构。

### Step 4: CLI

`packages/compost-cli/src/commands/reason.ts` (NEW, ~50 LoC):
```
compost reason <seed> [--seed-kind fact|question|gap|cluster] [--top-k 10] [--graph-hops 2] [--no-link-writeback] [--json] [--push-engram]
```
`--push-engram` 调 `EngramWriter.writeInsight({ project: 'compost', compostFactIds: [seed], content: chain.chain, ... })`，依赖 debate 024 idempotency。

### Step 5: MCP tool surface

`packages/compost-daemon/src/mcp-server.ts` 新增 `compost.reason`。**默认 expose**——它产持久化 chain，agent 可以在分析任务里直接调；不像 `digest.push` 是 sibling-system mutation。

### Step 6: Tests (`packages/compost-core/test/reasoning.test.ts`, ~150 LoC, +15 tests)

- `computeChainId` determinism: same (seed, candidates, policy) → same id
- RRF sparse graph: graph 候选集为空 → output == ANN-only
- RRF dense graph: graph 候选集非空 → graph contribution > 0
- Idempotency: 同 seed 跑两次 reason() → 同 chain_id, 第二次返回 existing
- `persistDerivedLinks` INSERT OR IGNORE: 重复调用不产 fact_links 重复行
- `--no-link-writeback` flag: 不写 fact_links 边
- `seed_kind=question` 路径: 解析为 fact_ids 走相同 retrieval
- Status lifecycle: chain status='active' 默认，可标 stale
- LLM failure 路径: `answerLLM.generate` throw → answer_json 含 `{chain: null, failure_reason: "..."}`, status 仍 active（recoverable）
- gapThreshold: null 验证: ask() 路径不 logGap (跨验 debate 023)
- Integration: 写 fixture facts → reason() → 断言 reasoning_chains row + derived_from 边

### Step 7: Docs

- `docs/L5-reasoning-spec.md` (NEW): API + storage + bootstrap dynamics 解释
- `docs/ROADMAP.md`: Phase 7 开第一个 ✅ 行（debate 025 实施 + 测试数 + commit hash）
- `docs/CONCEPTS.md`: 新增 §Reasoning chains 段

### Step 8: 一周 dogfood 后开 (r) hybrid trigger 评估

不在本 slice。Q4 §升级路径定义的 GO 条件:
- ≥ 10 个 reasoning_chains 行积累
- confirm 率 > 50% (需先加 user verdict 字段或独立 `compost reason confirm <chain_id>` CLI)
- ≥ 3 个 confidence > 0.7 的 chain 用户确认有用

满足后开 debate 026: hybrid trigger 形态 + scheduler 集成。

## 显式不做（推到 P1 / 后续 phase）

- **β pattern detection populator** — Phase 7 L6 子 slice，需在 α 跑通后启
- **γ hypothesis generation** — 需 facts 表 schema 改（加 kind 列）或新表，独立大 slice
- **δ reflection prompts** — LLM 成本模型 + UX 设计未做，YAGNI
- **ε user model loop populator** — L6 范围，依赖 β 先 ship
- **Q5 (Z) `kind='ask_gap'` decision_audit** — debate 023+025 双 reject；reasoning_chains.retrieval_trace_json 已覆盖
- **Q4 (r) hybrid scheduler** — Step 8 数据驱动决策
- **`reasoning_chains.user_verdict` 列** — 等真有 chain 输出再加 (P1 schema 增量)
- **Engram-side 收 chain 后的 cross-project 玩法** — 不在 L5 entry gate scope

## Opus 需要撤回的 context.md 事实错（Codex 抓出）

合入 commit message 时 concede:

1. **§Q1 (a) Pro/Con: "fact_links 当前主要是 contradiction/superseded"** — 错。`0011_fact_links_and_health_fix.sql:18-24` 五个 kind 是 `supports/contradicts/elaborates/derived_from/same_subject`，**没有 `superseded`**。supersession 是 `facts.superseded_by` 列（`0001_init.sql:99`）+ archive 列（`0010_*:91-102`），不是 graph 边。正确措辞应是"production 写入密度上 contradicts 占绝大多数（仅 reflect.ts:252-257 一个 prod writer），其他 4 个 kind 仅 test fixture 用过"。
2. **§Reference 末尾: `packages/compost-core/src/schema/migrations/0011_*.sql`** — 路径错。实际是 `packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql`，没有 `migrations/` 子目录。

## Next Steps

1. **用户确认** 是否接受 (c)+α+B+q+X 包 + 强制 derived_from write-back + Step 1-7 实施次序。
2. 若同意：按 Step 1 → 7 落地。Step 1-3 是核心（migration + reasoning module + RRF refactor），Step 4-7 可并行。估总工时 6-9 小时。
3. 跑 `bun test` 期望 621 → 636+ (新增 reasoning.test.ts ~15 测试 + RRF refactor 不影响 search.test.ts)。
4. Dogfood: `compost reason <某个高 ask_count gap representative>` 至少 10 次混不同 seed_kind，看 chain quality 分布。
5. 一周后回看 Step 8 的 (r) hybrid trigger GO 条件是否满足。
6. 本 slice ship commit message 必须 concede §Opus 撤回的两个 context.md 事实错（透明度 > 面子，debate 023/024 范式同款）。
