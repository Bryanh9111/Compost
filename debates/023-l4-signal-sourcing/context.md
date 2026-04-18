# Debate 023: L4 信号源归属 (Phase 7 前置)

**Topic**: gap tracker 的写入入口该挂在哪一层
**Style**: quick / 1 round / cross-critique
**Advisors**: gemini, codex, sonnet + claude(opus) moderator
**Started**: 2026-04-18

## 背景

Phase 6 P0 完工，16-tool MCP surface 上线，606 tests pass，HEAD `8b29ec1`。L4 所有 primitive 都就位：gap tracker (migration 0016) / curiosity clusters (gap-hotspot) / fact→gap matches (active 建议层) / digest + push / wiki provenance JOIN / crawl queue / correction-detector Option A。

原计划 (handover `527fda1ca207`): Phase 7 走 L5 analytical partner — cross-fact reasoning over fact_links + wiki clusters, pattern detection, hypothesis generation。

## 启动 Phase 7 前 dogfood 审计 (procedure `d983850af8f3`)

本地 ledger 跑 L4 信号检查:

```
pnpm compost gaps stats      -> {open:0, resolved:0, dismissed:0, total_asks:0}
pnpm compost curiosity clusters  -> (no gaps in last 30d under status filter)
pnpm compost curiosity matches   -> (no open gaps in window)
sqlite3 ~/.compost/ledger.db "SELECT DISTINCT kind, COUNT(*) FROM decision_audit GROUP BY kind"
                              -> wiki_rebuild|11
```

L4 完全静默。L5 要消费的 gap clusters / fact-gap matches 全是空集。

## 根因 (grep 证实)

`logGap` 全仓**唯一写入点**: `packages/compost-daemon/src/mcp-server.ts:261-271`，包在 MCP `compost.ask` tool handler 的 catch-wrapped 尾部。

```typescript
// mcp-server.ts:41
const GAP_CONFIDENCE_THRESHOLD = 0.4;

// mcp-server.ts:250-271 (简化)
const result = await ask(db, input.question, llmRegistry, { ... });
try {
  const topConfidence = result.hits[0]?.confidence ?? 0;
  if (result.hits.length === 0 || topConfidence < GAP_CONFIDENCE_THRESHOLD) {
    logGap(db, input.question, { confidence: topConfidence });
  }
} catch (gapErr) { log.warn(...); }
```

两个架构事实：

1. **`ask()` 函数本体不写 gap**。`packages/compost-core/src/query/ask.ts:74` 返回 `AskResult { hits[], ... }`，不调 logGap。
2. **`query()` ≠ `ask()`**。CLI `compost query <text>` 调 `search.ts:137` 的 raw hybrid retrieval (BM25+ANN+RRF+rerank)，不过 LLM 合成。语义不同 — `query` 是检索，`ask` 才是 "brain answering"。
3. **decision_audit 零 ask 条目**。ask() 函数根本没往 audit 写，只有 wiki_rebuild 在写 (wiki.ts:190)。所以任何 "historical replay" 都不是 replay 已有数据，而是**先 instrument 再前向积累**。

结果：只有 Claude 通过 MCP 调用 `compost.ask` 才产生 L4 信号。本地 user 跑 CLI / 其他 front-end 集成的话，gap tracker 永远 total_asks=0。**Phase 7 L5 盲飞**。

## 三条路

### (a) `logGap` 下沉进 `ask()` 函数本体

把 gap 语义归属到 core：`ask.ts` 尾部判断 `result.hits.length===0 || topConfidence < threshold` → `logGap(db, question, {confidence})`。`GAP_CONFIDENCE_THRESHOLD` 从 mcp-server 搬进 core (例如 `packages/compost-core/src/query/ask.ts` export 一个 `DEFAULT_GAP_THRESHOLD=0.4`，可被 `AskOptions.gapThreshold?: number` 覆盖)。MCP handler 瘦身成纯 transport。

- Pro: 任何 `ask()` 调用（CLI、MCP、未来 HTTP API、test）都自动喂 gap。语义正确 — gap 是 "brain 答不出" 不是 "agent 问法"。threshold 进 core 可被 Phase 7 L5 统一调。
- Con: 改 core public 函数副作用语义。所有 ask.test.ts 要加 "not logging gap" 断言避免测试污染 ledger (需要 `{gapThreshold: null}` 或类似禁用开关)。破坏 core 的纯函数性质 (ask 现在有 DB 副作用但只读 — 下沉后变读写)。

### (b) CLI 加 `compost ask` 子命令，`logGap` 继续留在 MCP 层复制一份

保持 `ask()` 纯读。在 `packages/compost-cli/src/commands/ask.ts` 新建子命令，调 `ask()` 后在 CLI 层做同样 logGap 判断。

- Pro: core 函数签名不动。每个 caller 自主决定是否喂 gap。threshold 可以 per-caller 差异化。
- Con: logGap 逻辑**至少两份** (MCP + CLI)，未来第三个 caller 再抄一遍。`GAP_CONFIDENCE_THRESHOLD` 常数漂移风险。"gap tracking is brain 语义" 的抽象在代码里不存在，靠社区约定。

### (c) Event-based / middleware 解耦

`ask()` emit `AskCompleted { question, topConfidence, hitsLength }` event。gap-tracker 订阅该 event 自己决定是否 logGap。CLI/MCP/HTTP 各自触发 ask() 都天然触发 event。

- Pro: ask() 不知道 gap 存在 (严格单一职责)。未来加 L4 其他订阅者 (curiosity pre-warm / digest pre-compute) 零改动。
- Con: Bun/Node EventEmitter 跨进程不工作 (daemon & CLI 可能不同进程)。多订阅者时故障归因链变长 (Phase 6 slice 2B 那条 "dogfood 故障归因越简单越好" 还 fresh)。YAGNI: 当前只有一个订阅者 (gap-tracker)。

## 硬约束

1. **Phase 6 P0 shipped**。`gaps` 表 schema (migration 0016) 不动；`logGap` 函数签名 (gap-tracker.ts:60+) 有 MCP 路径依赖，破坏性改动要走新 migration/版本。
2. **`ask()` 是 BreakerRegistry 生产入口**。改动必须过 `packages/compost-core/test/ask.test.ts` 的 breaker fallback 测试 (debate 009 Fix 1)。
3. **LLM-free fallback 不能破**。`ask.ts:215` 的 "expand 失败 → BM25 fallback" 路径要保持。下沉 logGap 后，fallback 路径也要触发 logGap (BM25-only 答案算不算 gap？—— 见 Q3)。
4. **Phase 7 L5 消费 API freeze**。L5 依赖 `getOpenGaps() / curiosity.clusters() / curiosity.matches()` 的稳定签名。迁移不能变这三个函数的输出 shape。
5. **`query()` 不碰**。raw retrieval 不是 "brain answering"，挂 gap 会把语义扩成 "任何检索不到都是 gap"，错。所有 advisor 都应把 `query()` 视为 off-limits。

## 四个子问题

1. **Q1 (threshold 归属)**: `GAP_CONFIDENCE_THRESHOLD=0.4` 该是 core 常数 (所有 caller 统一) 还是 per-caller option (每个入口自决)? digest 的 `CONFIDENCE_FLOORS` 是 core-defined、caller-overridable — gap 是否套同样范式？

2. **Q2 (BM25 fallback 语义)**: `ask()` 当 LLM 合成路径破 (breaker open / expand 失败)，只返回 BM25 结果。此时 `topConfidence` 用的是 retrieval score，不是 LLM 置信度。在这个路径上触发 logGap 对不对？或者 fallback 路径应该 skip gap logging (因为 "没真答，只是给了检索结果")?

3. **Q3 (audit coupling)**: 顺便让 `ask()` 写 `decision_audit` (kind='ask', target_id=question_hash, evidence_refs=hits.fact_ids)? 这样未来 replay/反演成本低。但 decision_audit 是 P0-2 重决策审计，"每次 ask 都写" 可能让表爆炸。是否应该**只在 gap 被触发时** audit (ask-failed-to-answer 是决策事件，ask-succeeded 不是)?

4. **Q4 (Phase 7 L5 scope 影响)**: 如果 (a) 选中且 threshold 变 per-caller option，Phase 7 L5 要不要定义 "L5 自己的 ask 入口" (reasoning-time ask)？还是复用现有 `ask()`? L5 的 cross-fact reasoning 触发的内部 ask 该不该喂 gap (可能会 pollute — L5 明知信息不全才 reason)?

## 期望输出

四方结构化发言 + 最终推荐。带 split vote 照办 022 的 tiebreak 格式。重点关注：
- Q1 归属决策影响 Phase 7 threshold tuning 自由度
- Q2 BM25 fallback 路径的 gap 语义 (今晚决，否则 (a) 无法单行落地)
- Q3 audit 写入范围 (只写 gap 还是全写) 对存储 & replay 的 tradeoff
- Q4 L5 scope 有无外溢 (L5 "internal ask" vs "user ask" 语义区分)
