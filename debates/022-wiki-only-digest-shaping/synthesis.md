# Final Synthesis: wiki-only digest 的 insight 塑形

**Debate**: 022-wiki-only-digest-shaping
**Style**: quick / 1 round / cross-critique
**Participants**: 🟡 Gemini, 🔴 Codex, 🟠 Sonnet, 🐙 Claude (Opus)

## 投票结果

| Advisor | 立场 | 核心主张 |
|---------|------|----------|
| 🟡 Gemini | (d) meta-fact | 把 digest 事件本身 insert 一行到 `facts` 表，用该 fact_id 作 source_trace |
| 🔴 Codex | **(a)** | default floor 0.85 → 0.75 (exploration)，双位置改 (digest.ts + CLI)，保留 --confidence-floor override，help 文案区分 digest vs arbitration 语义。指出 Sonnet 的 (d) 路径错（`wiki_page_observe` 只给 observe_id），真正的 (d) 是走 `decision_audit.evidence_refs_json` 里已有的 `input_fact_ids` |
| 🟠 Sonnet | (d) JOIN | `wiki_page_observe → observations → facts(observe_id)` 三跳 JOIN，45-60 min；有 schema 前提（facts.observe_id 存在——实际存在于 0001_init.sql:97） |
| 🐙 Claude | **(a) + 延后 (d)-via-audit** | Codex 方向正确，补充：(b) 的 synthetic fact_id 破坏 UUIDv5 幂等性 + invalidate 路径；(d) 真正干净的版本是 Codex 指出的 decision_audit JOIN，但该留给 slice 3 |

## 共识区

1. **(b) 全员拒绝**。4/4 一致。`compost_fact_ids` 是契约字段，不是形式字段。破坏它 = R3 从守卫变谎言。
2. **(c) 单独走不行**。wiki-active user 永远看不到 push 生效，Round B dogfood 闭环断。
3. **Engram 合约不可豁免**。`compost_fact_ids` 必须是 facts 表真实行——idempotency、invalidate、trace 都依赖这个语义。

## 分歧区

**(a) vs (d)** —— 1 票 (Codex) vs 2 票 (Gemini, Sonnet) 表面是 (d) 赢，但：

- Gemini 的 (d) 和 Sonnet 的 (d) 是**不同方案**。Gemini = 向 facts 表插新行（schema 含义变）；Sonnet = 三跳 JOIN（纯查询无 schema 变）。两者不等价，不能合票。
- Codex 指出 Sonnet 的 JOIN 路径绕远（`wiki_page_observe` 给的是 observe_id，不是 fact_id 直达）；更直接的路径是 `wiki_pages ⋈ decision_audit WHERE kind='wiki_rebuild'`，因为 wiki.ts:190 已经把 `input_fact_ids` 写进了 `evidence_refs_json`。**这个发现让所有 (d) 变体都变成 "slice 3 的事"**：已经有持久化的 wiki→fact 链路，不需要 (a) 的阈值调整来绕开。
- Gemini 的 meta-fact (d) 额外引入 "digest-as-fact" 的本体冲突，scope creep。

## 最终推荐：**(a) 现在做，(d)-via-decision_audit 延到 slice 3**

### Tiebreak rationale

用户硬约束 #4：**"S6-2 MCP write transport 第一次活体 dogfood — 故障归因越简单越好"**。这条规则下：

- (a) 改一个常数，push 路径字节不变 → 故障归因最干净
- (d)-任何变体都新增代码路径 → dogfood 阶段稀释诊断信号

架构上 (d)-via-decision_audit 最终是对的，但它可以 **post-dogfood** 加入，不必为它延误 Round B。

### Round B 具体落地

```
packages/compost-core/src/cognitive/digest.ts
  - default confidenceFloor: CONFIDENCE_FLOORS.instance -> .exploration (0.75)

packages/compost-cli/src/commands/digest.ts:42
  - CLI --confidence-floor default: 0.85 -> 0.75
  - help 文案: "Digest uses confidence as a noteworthiness filter, not
    the arbitration trust floor. Default exploration=0.75 matches typical
    personal-KB ingest; raise to instance=0.85 only if you want
    arbitration-grade gating."

新测试: assert default floor = 0.75 (+1 test case)
然后: 加 --push flag 接 EngramWriter.writeInsight()
```

Dogfood 验证：再跑 `compost digest --since-days 7` 应出现 11 条 fact (来自 0.5-0.85 区间)。若仍是 wiki-only，`digestInsightInput() === null`，`--push` 打印 "no insight-worthy content" 并 exit 0。这是正确行为，不是 bug——slice 3 加 (d)-via-audit 后才解锁。

### Slice 3 (post-dogfood 验证)

```
selectWikiRebuilds 扩展:
  JOIN decision_audit ON target_id=path AND kind='wiki_rebuild'
  读取 JSON.parse(evidence_refs_json).input_fact_ids
  返回 contributing_fact_ids[] 给 DigestItem

digestInsightInput 合并 wiki contributing_fact_ids 进 factIds Set
-> wiki-only digest 也有真实 provenance，不再依赖 floor 调整
```

## Next Steps

1. 用户确认：接受 (a) 立即做 + (d)-via-audit 延后？
2. 若同意：Round A' 小 patch (~15 min) → 重跑 dogfood → Round B 接 push (~30 min)
3. Slice 3 排期：等 Round B dogfood 至少跑过一次且 transport 验证稳定后
