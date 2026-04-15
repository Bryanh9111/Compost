# R1 — 🐙 Opus (主持 + 独立投票)

Read: ARCHITECTURE.md Pre-P0 contracts 段, audit.ts EvidenceRefs, reflect.ts step 3 (line 168-247), wiki.ts line 1-170, 0010 migration (decision_audit.kind CHECK 是 4 值闭集).

关键发现 (影响 Q3 投票): `decision_audit.kind` 是 SQL `CHECK IN (...)` 闭集 4 值. 拆 kind 需要 migration 0014 + CHECK 重写. 这不是零成本.

---

## 逐问投票

**Q1**: **Accept** (contradiction_arbitration = instance 0.85)
- 理由: confidence_floor 语义不是"LLM 必须报 ≥ 0.85", 是**该决策的语义分类**. contradiction arbitration 是 data-level assertion (一个 fact 相对另一个更对), 不是 schema 级变更. instance tier 定义就是"fact merge / wiki L3 rebuild / fact excretion"这一层. 合约内一致.
- 反方"不可逆 = kernel" 不成立: loser 仍保留 superseded_by, 理论上可 revive (清 archived_at). "不可逆"更指 schema 迁移, 不是数据修正.

**Q2**: **Accept** (wiki_rebuild = instance 0.85)
- 理由: wiki 是 multi-fact synthesis derived output, 非权威原始事实. instance 正好对应"multi-source 合成". kernel 留给"会让 schema / ranking weights / profile 改变"的决策.
- 反方"用户面向 → kernel"混淆了"决策严重度" 和"用户可见度". tier 衡量前者.

**Q3**: **Accept** (fact_excretion 1 kind 2 tiers by reason)
- 理由: 拆成 `fact_excretion_auto` / `fact_excretion_manual` 两 kind = migration 0014 改 CHECK + ARCHITECTURE.md 4 kinds → 5 kinds + listDecisions API 需要 union filter. **成本 > 收益**. 消费端查询模式是 `WHERE kind = 'fact_excretion'` + 可选 `JSON_EXTRACT(evidence_refs_json, '$.reason')` filter — 1 个 JSON_EXTRACT 不复杂.
- 关键事实: 0010 migration `decision_audit.kind CHECK IN (4 values)` — 是闭集, 改 kind 要 ALTER TABLE.

**Q4**: **Accept** (loser_ids[] plural, per cluster 1 audit)
- 理由: reflect.ts step 3 已按 `conflict_group` 聚合 (per cluster 1 groupId), per-cluster audit 自然对齐. 拆 per-loser 会让 5 个 loser 的 cluster 产生 5 行 audit, 同一 decision 事件分散. 查询 "fact X 是否 loser" 用 `JSON_EACH(evidence_refs_json->'$.loser_ids')` 可行, 不频繁故 perf 不担忧.
- Per-loser audit 的唯一优势是 target_id 精确指向 loser_id, 但 evidence_refs.loser_ids 第一个值可作"代表 id", 或用 target_id = cluster_group_id (cg-xxx) 保持 1:1 with conflict_group.

**Q5**: **Modify → `input_fact_ids[]` only** (drop observe_ids)
- 理由: wiki rebuild 的直接输入是**facts**, 不是 observations. observe_ids 是一层间接, audit 读者若要知道 "用了哪些 observation" 总能 `JOIN facts ON fact_id → observe_id`. 存 both 是 1.5× storage 冗余 (典型 wiki 页 20-50 facts).
- 替代: `{ page_path, input_fact_ids[], input_fact_count }`. 保留 count 因为 fact_ids 可能被截断 (超过合理上限时).
- Counter-argument: primary-source provenance for legal/trust 用. 回应: 这是 audit trail 不是 legal log, facts 已有 observe_id 列做 provenance.

**Q6**: **Accept** (fact_excretion.reason 3 values 不含 stale/contradicted)
- 理由: stale 和 contradicted 两个 archive_reason **根本不走 fact_excretion kind**:
  - `stale` → 合约定"no audit" (0 rows)
  - `contradicted` → 走 `contradiction_arbitration` kind
- 把 stale/contradicted 放进 `fact_excretion.reason` enum 会创造 **runtime-impossible states** (i.e. `kind='fact_excretion', reason='stale'` 永远不会被写, 但 TypeScript 允许构造). 违反"make illegal states unrepresentable".
- 用 `facts.archive_reason` 全 6 值 enum 会出现 mismatch: 一个 fact 的 archive_reason='contradicted' 对应 audit kind='contradiction_arbitration'. 两字段语义不同, 别强制对齐.

---

## 最终 preferred 答案 (一览)

- **Q1: Accept** (contradiction_arbitration = instance 0.85)
- **Q2: Accept** (wiki_rebuild = instance 0.85)
- **Q3: Accept** (fact_excretion 1 kind 2 tiers; 不拆)
- **Q4: Accept** (loser_ids[] plural, per cluster 1 audit)
- **Q5: Modify → input_fact_ids[] only** (drop input_observe_ids[])
- **Q6: Accept** (reason 3 values 不含 stale/contradicted)

---

## 一句话告诫

`confidence_floor` 不是"LLM 自评分的门槛", 是"决策类别标签". 把它理解成前者会把 tier 选成 kernel 过度保守, 把它理解成后者就是 instance/kernel/exploration 三类语义的对应 — 这个差异要在 ARCHITECTURE.md 写清楚, 否则 Week 3 实施者还会再问一遍.
