# Claude (Opus) — Round 1 (independent opening, pre-other-advisors)

## Stance: **(a) minimal**, conditioned on BM25-fallback carve-out + audit/event deferred

其他三方 (gemini/codex/sonnet) round 尚未就位。此为独立开场判断，不含 cross-critique。等三方发言后于 `synthesis.md` 做综合（或 round 2 revision）。

## 读 context 后的核心判断

**(a) 是唯一不破坏语义抽象的选择。** gap tracking 是 "brain 答不出" 的记账，不是 "agent 问的方式" 的特性。把它挂在 MCP transport wrapper 里 = 把 brain 语义泄漏到 transport 层 = Phase 6 P0 的遗留债，不是 feature。

但 context 列的 (a) 现在**不能按字面落地**，有两处必须先定（Q2/Q3），否则会把 Phase 7 搞更糊。

## 答 Q1-Q4

### Q1 threshold 归属 → **core 常数 + per-caller override**

套 digest 的 `CONFIDENCE_FLOORS` 范式 (`packages/compost-core/src/cognitive/digest.ts`)。具体：

```typescript
// packages/compost-core/src/query/ask.ts
export const DEFAULT_GAP_THRESHOLD = 0.4;

export interface AskOptions {
  // ... existing fields
  /** 置 null 显式 disable gap logging (测试 / L5 internal ask 必需). */
  gapThreshold?: number | null;
}
```

理由: (i) Phase 7 L5 会要调这个阈值做 reasoning-boundary tuning，藏在 transport 层 L5 够不到；(ii) 022 已证明 core-default + CLI-override 范式对 digest 工作良好，复用零认知成本；(iii) mcp-server 里的 `0.4` 是**未被任何测试断言的魔数** (grep `GAP_CONFIDENCE_THRESHOLD` 仅两处都是使用点，无 assertion)，搬到 core 的同时必须加一个 assertion test (见 022 Round B 对称教训 — default 变动要测)。

### Q2 BM25 fallback 语义 → **skip gap logging**

**这是 (a) 能否单行落地的决定性边界**。`ask.ts:215` 的 LLM-free fallback 路径返回的是 "BM25 最高分 hit 的 confidence"，而 normal 路径的 `hits[0].confidence` 是 **经 LLM answer synthesis 后标注的 confidence**。两者**量纲不同** — fallback confidence 是检索分数 (BM25/RRF merge 后的归一化值)，normal confidence 是模型对自己合成答案的 self-report。

把两者当一个阈值比 → 噪声。实际后果：LLM breaker 一 open，所有 fallback 答复统统被标 gap（因为 BM25 分数通常低于 0.4 的绝对值），L4 信号瞬间爆量假阳性，Curiosity clusters 被噪声覆盖。

实现: `ask()` 内部用一个 flag 标记 "answer 是否经 LLM 合成"，只有 LLM-synthesized 路径才调 logGap。等价伪码:

```typescript
const answer = await synthesize(...); // 可能触发 breaker fallback
const gapLoggable = answer.synthesized_via_llm;  // 或等价 flag
if (gapLoggable && opts.gapThreshold !== null) {
  if (hits.length === 0 || hits[0].confidence < (opts.gapThreshold ?? DEFAULT_GAP_THRESHOLD)) {
    logGap(db, question, { confidence: hits[0]?.confidence ?? 0 });
  }
}
```

**注意 fallback-silent 有 trade-off**: breaker long-open 期间 L4 会完全静默。但这是对的 — 此时用户应该看到的是 breaker 健康告警 (triage table)，不是 fake gaps。

### Q3 audit coupling → **解耦，不捆绑**

**反对把 "ask 写 decision_audit" 塞进 debate 023**。理由三条:

1. `decision_audit` 是 **P0-2 "不可逆决策" 的审计** (see audit.ts)。现有 kind 只有 wiki_rebuild — 一个真实的持久化副作用决策。ask 是**读操作**，哪怕失败也没 side-effect。往 audit 里塞 ask 是语义越位。
2. Ledger 爆表风险实在。每次 MCP ask 都写一行 audit，本地 heavy user 一个月轻松 10k+ 行。存储成本不可忽视。
3. Replay/反演价值目前**虚的**。(d) historical replay 在 context 里已被我否掉（没数据可 replay）。前向 instrument 完全可以**只写 gaps 表**（gaps 已经有 question / confidence / timestamp），等未来真需要 audit 路径再加。YAGNI。

如果 Phase 7 L5 真要 "ask trace replay"，那是 L5 自己的 instrumentation 需求，应该在 L5 scope debate 里讨论，不是在 L4 signal sourcing 这里搂一起做。

### Q4 Phase 7 L5 外溢 → **L5 internal ask 必须显式 `gapThreshold: null`**

L5 的 cross-fact reasoning 本质是 "故意在低置信度空间 hypothesize"。如果 L5 internal ask 触发 logGap，信号会自污染：L5 跑一轮 → gaps 表涨 20 条 "L5 hypothesizing 过程中" 的 low-confidence queries → Curiosity 下一次 cluster 把这些当 hotspot → 用户被推送 "L5 刚在自己 reason 的内部查询"，荒谬。

Q1 里 `gapThreshold: null` 显式 disable 的 API 就是为此准备。Phase 7 L5 引入时, **所有 internal ask 路径必须传 `gapThreshold: null`**。建议 (a) patch 落地时在 `ask.ts` 的 JSDoc 里就写清楚这条契约，免得 L5 作者忘。

不需要 "L5 专属 ask 入口" — ask() 已经是正确的抽象，加一个 option flag 就够。增加第二个 ask-like 函数是 duplication，debate 022 对 "compost_fact_ids contract" 的教训同样适用：API shape 不要 fork。

## 路径比较 (vs b, c)

- **(b) 拒绝**: logGap 逻辑和 threshold 常数至少复制到 CLI，未来 HTTP 再来一份。`GAP_CONFIDENCE_THRESHOLD` 漂移 (0.4 vs 0.35) 会悄无声息发生。这是把 Phase 6 P0 的错误在 CLI 维度重复一遍。
- **(c) 延后**: event-based 的解耦价值真实存在，但 context 列的 con 是对的 — 当前只有一个订阅者 (gap-tracker)。YAGNI。等 Curiosity / digest 有 "ask-triggered pre-warm" 真实需求时再提。届时的 event shape 也会更清楚 (pre-computed signals 跟 gap-logging 可能要不同 event)。

## Recommendation: **(a)-minimal + compost ask CLI**，其余 defer

### 本次 slice 落地 (~60 min)

```
packages/compost-core/src/query/ask.ts
  - export const DEFAULT_GAP_THRESHOLD = 0.4
  - AskOptions 加 gapThreshold?: number | null
  - ask() 尾部: if (synthesized_via_llm && opts.gapThreshold !== null) { logGap(...) }
  - import logGap from "../cognitive/gap-tracker"

packages/compost-daemon/src/mcp-server.ts
  - 删除 GAP_CONFIDENCE_THRESHOLD 常数
  - 删除 mcp-server.ts:261-271 logGap block
  - compost.ask handler 瘦身为纯 transport

packages/compost-cli/src/commands/ask.ts  (NEW)
  - 新建 compost ask <question> 子命令
  - 调 ask() 默认开启 gap logging

tests
  - ask.test.ts: 新测 "gap logged when hits empty / low conf"
  - ask.test.ts: 新测 "BM25 fallback path does NOT log gap"
  - ask.test.ts: 新测 "gapThreshold: null disables logging"
  - ask.test.ts: 新测 "default threshold = 0.4"
```

### 显式不做

- audit kind='ask' 写入 (Q3) → 独立讨论
- event-based (c) → YAGNI
- historical replay (context 里 (d)) → 没数据
- `query()` 触发 logGap → 语义错 (context Phase 6 constraint #5)

### Phase 7 前置 unblock 条件

本 slice 落地后:
1. 本地跑 `compost ask "xxx"` 至少 5 次（混合高/低置信度问题）
2. `gaps stats` 应显示 total_asks > 0, open > 0
3. `curiosity clusters` 应非空（token-Jaccard clustering 需要 ≥2 gaps 同 token 才出 cluster，所以至少 3-5 个 low-conf asks）
4. `curiosity matches` 应能把新 facts 匹到 open gaps

满足后 Phase 7 L5 debate 才有意义。否则 L5 继续盲飞。

## 对 3 方 advisor 的提问 (welcome pushback)

- 💬 **Codex**: Q2 的 BM25 fallback 判定 "synthesized_via_llm" flag 的最简实现路径是什么？ask.ts 现在有没有现成的区分 (例如 llmOrRegistry 的 breaker state)，还是需要新字段？
- 💬 **Gemini**: Q3 "audit ask = 读操作越位" 这个判定是否全对？你之前在 022 主张过 "digest-as-fact" 让写入路径更丰富 — 同样的思路 "ask-as-audit" 你会不会推荐？如果会，说服我。
- 💬 **Sonnet**: Q4 的 "L5 internal ask 必须 disable gap" 如果 L5 reasoning 恰好依赖"我问过什么低置信问题"作为 meta-signal，怎么办？是否需要 L5 自己的 ledger 维度分离 (而不是 disable)？
