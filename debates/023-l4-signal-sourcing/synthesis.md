# Final Synthesis: L4 signal sourcing (Phase 7 前置)

**Debate**: 023-l4-signal-sourcing
**Style**: quick / 1 round / cross-critique
**Participants**: 🟡 Gemini, 🔴 Codex, 🟠 Sonnet, 🐙 Claude (Opus)
**Date**: 2026-04-18

## 投票结果

| Advisor | 立场 | 核心主张 |
|---------|------|----------|
| 🐙 Claude (Opus) | **(a)-minimal + CLI ask** | logGap 下沉 core；BM25 fallback skip（量纲不同）；audit defer；L5 internal 传 gapThreshold:null。**实现用 `AskResult.synthesized_via_llm` 新字段**。|
| 🟡 Gemini | **(a) + `kind='ask_gap'` audit** | logGap 下沉 core；**BM25 fallback 必须 log (confidence=0 sentinel)** — breaker open 时是信号最强时刻，skip 等于 dead zone；**selective audit 只记 gap 事件**（非每个 ask）。|
| 🟠 Sonnet | **(a) minimal + 字符串 sentinel** | logGap 下沉 core；BM25 fallback skip；audit 不写（`target_id` 没 stable ID）；L5 null + 延后 `gapSource` tag。**实现用 `answer.startsWith("[LLM unavailable")` 已有测试合约**，不加新字段。|
| 🔴 Codex | **(a) provenance-gated** | logGap 下沉 core；BM25 fallback skip（**Opus 的量纲论证错 — 代码层 confidence 同源**，真理由是 provenance）；audit **坚决拒绝**（`AuditKind` TS union + migration 0010 SQL CHECK 硬约束，扩 kind 非轻量改）；L5 null。**实现用 `let synthesizedViaLlm = false` local boolean**。|

## 共识区 (4/4 或 3/4)

1. **(a) 4/4 全票通过**。没人主张 (b) CLI 复制 logGap / (c) event-based / (d) historical replay。gap tracking 是 brain 语义不是 transport 语义 — Phase 6 P0 位置是错的。
2. **Q1 threshold 归属 4/4 一致**: core 常数 `DEFAULT_GAP_THRESHOLD = 0.4` + `AskOptions.gapThreshold?: number | null` per-caller override，套 digest `CONFIDENCE_FLOORS` 范式。
3. **Q4 L5 internal 4/4 一致**: L5 cross-fact reasoning 的内部 ask 必须传 `gapThreshold: null` 防自污染；不 fork L5-only ask API（debate 022 `compost_fact_ids` 合约教训同理）。
4. **Q3 audit 3/4 拒绝**（Gemini 独排）: 不给本 slice 加 `decision_audit` 写入。Codex 的决定性反驳 — `audit.ts:15-19` TS union 加 `0010_phase4_myco_integration.sql:43-58` SQL CHECK 把 kind 列表硬锁死（`contradiction_arbitration | wiki_rebuild | fact_excretion | profile_switch`），加 `ask_gap` 是 schema + type-union 双扩，不属于本 slice 最小改动范围。
5. **Q2 fallback 3/4 skip**（Gemini 独排）: BM25 fallback 不触发 logGap。但 **Opus 的论证理由被驳倒** — 真正的理由是 provenance 语义（LLM 没合成 = 不是 brain 承认 gap），不是量纲差异。

## 分歧区

### 分歧 A: Q2 Opus 的 "confidence 量纲不同" 论证 — 被 Codex 证伪

**Codex 代码层驳倒** (cross-critique r001_codex.md:2456): `AskResult.hits` always come from `queryResult.hits` (`ask.ts:229-235`)，而 `QueryHit.confidence` populated from `facts.confidence` (`search.ts:220,277-285`)。两条路径（LLM 合成 / BM25 fallback）**返回的 hits[0].confidence 同源、同量纲**，都是事实自身 confidence。没有 "LLM self-report confidence" 存在。

**Synthesis 裁定**: Opus r001_claude.md 的 Q2 技术论证错。Gemini 据此指出的 "消音 = dead zone" 在量纲层面是对的。**但最终仍 skip**，改用 Codex + Sonnet 的 provenance 理由：LLM 没合成答案，就不是 "brain answered and fell short"，没有语义上的 gap。

### 分歧 B: Q2 实现 — Sonnet 字符串 sentinel vs Codex local boolean

- 🟠 Sonnet: `answer.startsWith("[LLM unavailable")` — 复用 `cross-p0-integration.test.ts:210,269,342` 已测试合约
- 🔴 Codex: `let synthesizedViaLlm = false; ... after answerLLM.generate succeeds: synthesizedViaLlm = true` local boolean

**Synthesis 裁定: Codex 的 local boolean 方案**。理由:
1. **Compiler-checked**: TS 编译期抓 flag 未设置；字符串前缀变动（i18n / rewording）无编译期保护
2. **Decoupled from human-facing string**: 字符串是用户可见错误消息，未来产品迭代可能改措辞；local boolean 是私有 control-flow state
3. **Test contract 可选保留**: 保留 `[LLM unavailable` 前缀作为 user-facing 错误消息（不改现有测试），同时内部用 boolean 做 gap 判定 — 两者解耦

Sonnet 的方案简洁性优势真实，但 "battle-tested string contract" 是 accidental stability，不是 designed invariant。

### 分歧 C: Gemini 的 `kind='ask_gap'` audit 被否

Gemini 架构直觉（"selective audit 只在 gap 触发时写"，非 every ask）本身是合理的范式改进，但放这个 slice 成本太高:
- 要改 `audit.ts:15-19` TS union 加 `ask_gap`
- 要加 migration 0018 扩 SQL CHECK 约束
- `target_id` 要定义 stable key（question_hash? problem_id 但 gap 创建前没 ID？）

Codex 正确指出这不是小改动。**本 slice 拒绝，Phase 7 L5 scope 可以重新评估**（L5 若做 "ask trace replay" 这是自然引入点）。

## 最终推荐: **(a)-provenance-gated + `compost ask` CLI**

### Tiebreak rationale

用户项目章程三条硬规则:
- Phase 6 P0 shipped — 不动 schema 0016 (gaps)，logGap 签名稳定 (4/4 共识)
- 最小变更优先 (022 "故障归因越简单越好" 教训)
- Phase 7 L5 消费 API 冻结 (constraint #4)

三条规则下:
- Codex 的 **local boolean** 方案: 零 schema 改、零公共接口改、零字符串合约依赖、TS 编译保护
- 优于 Opus 的 `synthesized_via_llm` field (Opus 承认 over-eng)
- 优于 Sonnet 的字符串 sentinel (string contract 不是 designed invariant)
- 优于 Gemini 的 full-log + audit 方案 (需 migration 扩 kind)

Opus 的 Q2 量纲论证错误是真实的认知漏洞，但结论（skip fallback）被 Codex + Sonnet 用正确的 provenance 理由独立 rederive。最终方案仍然 skip，理由换成 provenance。

### 落地 patch (~45-60 分钟)

**1. `packages/compost-core/src/query/ask.ts`** (core 改动)

```typescript
import { logGap } from "../cognitive/gap-tracker";

export const DEFAULT_GAP_THRESHOLD = 0.4;

export interface AskOptions extends QueryOptions {
  maxAnswerTokens?: number;
  expandQueries?: boolean;
  /** null = disable gap logging entirely (L5 internal asks / tests). */
  gapThreshold?: number | null;
}

// 在 ask() 函数内部:
//   declare `let synthesizedViaLlm = false;` 在 `await answerLLM.generate(...)` 前
//   generate 成功返回后置 true
//   catch 路径留 false (line 215+)
// 在 return queryResult 前追加 gap-logging 尾部块:
if (opts.gapThreshold !== null) {
  const thresh = opts.gapThreshold ?? DEFAULT_GAP_THRESHOLD;
  const topConf = queryResult.hits[0]?.confidence ?? 0;
  const noEvidenceCase =
    queryResult.hits.length === 0 && wikiPages.length === 0;
  if (noEvidenceCase || (synthesizedViaLlm && topConf < thresh)) {
    try {
      logGap(db, question, { confidence: topConf });
    } catch (err) {
      // non-fatal: don't let gap-tracker bugs break the answer path
      console.warn(`ask.logGap failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

**Gap 触发条件**:
- `noEvidenceCase` (hits 空 + wiki 空): **总是触发** — 这是最高价值 gap，跟合成路径无关
- `synthesizedViaLlm && topConf < thresh`: 只有 LLM 真合成了且 confidence 低才触发
- BM25 fallback (synthesizedViaLlm=false 且有 hits): **跳过**

**2. `packages/compost-daemon/src/mcp-server.ts`** (transport 瘦身)

- 删除 line 41 `GAP_CONFIDENCE_THRESHOLD = 0.4` 常数
- 删除 line 261-271 的 `try { logGap... } catch` block
- compost.ask handler 瘦身成纯 transport

**3. `packages/compost-cli/src/commands/ask.ts`** (NEW, ~40 行)

- 新建 `compost ask <question> [--budget N] [--no-track-gap]` 子命令
- 默认 gapThreshold 不传（使用 core default）
- `--no-track-gap` → 传 `gapThreshold: null`
- 在 `packages/compost-cli/src/main.ts` 注册

**4. `packages/compost-cli/src/main.ts`** (小改动)

- 加一行 import + register 调用

**5. 测试** (加在 Codex 指出的正确位置)

- `packages/compost-core/test/cross-p0-integration.test.ts` (Scenario B 扩): 断言 breaker-open fallback **不** 创建 gap；断言 no-evidence case 创建 gap；断言 LLM-synthesized + low-conf 创建 gap
- `packages/compost-core/test/gap-tracker.test.ts`: 新增 "gapThreshold: null disables"、"DEFAULT_GAP_THRESHOLD === 0.4"、"logGap non-fatal on error" 三条
- 注意: **不改 `ask.test.ts`** (如果存在) — Codex 指出 breaker invariants 权威位置是 cross-p0-integration

### 显式不做 (推到 Phase 7 L5 scope)

- `kind='ask_gap'` audit (Gemini Q3 方案) — 需要 migration 0018 + audit.ts TS union 扩
- `gapSource: "user" | "l5-internal"` tag (Sonnet Q4 扩展) — YAGNI，等 L5 真做时再评
- ask → decision_audit 全量写入 — 语义越位 (ask 是读)
- Event-based 解耦 (选项 c) — YAGNI，当前只一个订阅者

## Opus 需要撤回的三个技术错误

（合入落地 patch 时把这些 concede 进 commit message / 备注，以免后续 session 重蹈覆辙）

1. **r001_claude.md Q2 "BM25 fallback confidence 量纲不同"**: 错。`hits[0].confidence` 两路同源 `facts.confidence` (search.ts:220, 277-285)。正确理由是 **provenance 语义** (Codex/Sonnet 的 rederivation)。
2. **r001_claude.md Q3 "audit kind 只有 wiki_rebuild"**: 错。`contradiction_arbitration` 也在 `audit.ts:15-19` TS union 里，被 `audit.ts:103-105` 主动写入，`cross-p0-integration.test.ts:326-329` 断言。本地 ledger 没记录 ≠ union 不包含。
3. **r001_claude.md 提测试位置 `ask.test.ts`**: 错。breaker/fallback 不变量权威位置是 `packages/compost-core/test/cross-p0-integration.test.ts:148-229, 236-270`。改动 patch 要动这里。

## Next Steps

1. **用户确认** 是否接受 (a)-provenance-gated + CLI + 三个 Opus 撤回。
2. 若同意: 按落地 patch 顺序改 (ask.ts → mcp-server.ts → cli ask → tests)，跑 `bun test`，确认 606+ 通过（应变 610+ 因为新测）。
3. Dogfood 验证：改完跑 `compost ask "xxx"` ≥ 5 次混高低置信度 → 期望 `gaps stats` total_asks>0, open>0；`curiosity clusters` ≥ 1 cluster (需 ≥2 同 token gap)。
4. 满足后 **debate 024: Phase 7 L5 scope** — 真正讨论 cross-fact reasoning 形状、`gapSource` tag、`ask_gap` audit 再评估。
5. 本 slice ship 时 commit message 必须 concede 三个 Opus Q2/Q3 技术错误 (透明度 > 面子)。
