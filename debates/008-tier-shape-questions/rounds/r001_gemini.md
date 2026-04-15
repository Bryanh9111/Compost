# Compost Debate 008 Round 1 - 🟡 Gemini

作为 Phase 4 Debate 008 R1 参赛者，我从长期演化安全与审计一致性视角，对 6 个设计决策投票如下：

### Q1: contradiction_arbitration = instance (0.85) 合理?
**Accept**
- 理由: 冲突仲裁基于预设的 confidence 与 recency 启发式逻辑，本质上是系统内部状态的自洽调整而非绝对真理的判定。

### Q2: wiki_rebuild = instance (0.85) 合理?
**Accept**
- 理由: Wiki 合成是多事实的非唯一解汇总，属于展示层的逻辑实例，不应与内核级的结构性变更混淆。

### Q3: fact_excretion 分 heuristic (0.75) vs manual (0.90) 合理?
**Modify**
- 理由: 同一 kind 承载不同 tier 会导致 `TIER_FOR_KIND` 映射失效，增加下游审计工具的解析心智负担。
- 替代: 将 `fact_excretion` 拆分为 `fact_excretion_auto` (exploration) 与 `fact_excretion_manual` (kernel)。

### Q4: contradiction_arbitration.loser_ids[] (plural) 合理?
**Accept**
- 理由: 逻辑上一次仲裁是针对整个（主语，谓语）冲突簇的统一决策， plural 形式能准确记录决策的原子性并节省存储。

### Q5: wiki_rebuild 存 input_observe_ids[] only 合理?
**Modify**
- 理由: 仅存储观察 ID 存在间接性，无法在事实被部分归档后准确回溯合成该版本 Wiki 时的具体知识切片。
- 替代: 存储 `input_fact_ids[]` 以实现精确到 L2 层的证据溯源。

### Q6: fact_excretion.reason 不含 stale/contradicted 合理?
**Accept**
- 理由: `stale` 属于无审计的大规模清理，`contradicted` 已由专用 kind 覆盖，强行统一枚举会混淆“排泄”与“修正”的语义边界。

### 最终 preferred 答案 (一览)
- Q1: Accept
- Q2: Accept
- Q3: Modify (Split Kind)
- Q4: Accept
- Q5: Modify (Add Fact IDs)
- Q6: Accept

### 一句话告诫
必须严防由于审计层级划分不清导致的“循环验证”陷阱，确保系统生成的知识展现永远不能在未经人工确认的情况下提升至内核级信任权重。

DONE_R1_008
