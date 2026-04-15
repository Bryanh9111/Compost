# Debate 008 — Synthesis: 6 Tier/Shape Self-Check Questions

> 🐙 Opus · 2026-04-15 · R1 only (focused, single issue per Q)
> Participants: 🔴 Codex / 🟡 Gemini / 🟠 Sonnet / 🐙 Opus

---

## 投票汇总

| Q | Opus | Sonnet | Codex | Gemini | **Final** |
|---|------|--------|-------|--------|-----------|
| Q1 contradiction_arbitration = instance (0.85) | ✅ | ✅ | ✅ | ✅ | **Accept 4/4** |
| Q2 wiki_rebuild = instance (0.85) | ✅ | ✅ | ✅ | ✅ | **Accept 4/4** |
| Q3 fact_excretion 1 kind 2 tiers | ✅ | ✅ | ✅ | Modify (split) | **Accept 3/4** (keep; migration cost > benefit) |
| Q4 loser_ids[] plural per cluster | ✅ | ✅ | ✅ | ✅ | **Accept 4/4** |
| Q5 wiki_rebuild stores observe_ids only | Modify → fact_ids only | ✅ (observe_ids) | Modify → both | Modify → fact_ids only | **Modify 3/4**: **fact_ids[] only** |
| Q6 fact_excretion.reason 3 values only | ✅ | ✅ | ✅ | ✅ | **Accept 4/4** |

---

## 裁决: Q5 是唯一需要修改的项

**修改**: `decision_audit.evidence_refs_json` 的 `wiki_rebuild` shape 从:
```
{ page_path, input_observe_ids[], input_fact_count }
```
改为:
```
{ page_path, input_fact_ids[], input_fact_count }
```

**3/4 votes 支持 fact_ids** (Opus + Gemini + Codex). Sonnet 原投 Accept (observe_ids only) 但理由是"wiki.ts 现写 observe_id" — 实施层面不反对存 fact_id, 只是 observe_id 已有通道. **minority → fact_ids wins**.

**Codex 提议存 both** — 拒绝, 因为 facts 已有 `observe_id` FK, 需要时 JOIN 即可获得 provenance, 冗余存储无额外价值.

---

## 已一致的 5 项锁定

- **Q1/Q2**: `contradiction_arbitration` + `wiki_rebuild` 都是 **instance (0.85)**. Tier semantic = "decision class", not "LLM self-confidence threshold". 这点 Opus 在 R1 告诫里明确.
- **Q3**: `fact_excretion` 保持 1 kind 2 tiers (by reason). Gemini 建议拆 kind 被 3 票否决 — migration + CHECK 修改 + 5 kinds 认知负担 > parse 一个 tier 字段的简化.
- **Q4**: `loser_ids[]` plural, per cluster 1 行 audit. 对齐 reflect.ts 的 `conflict_group` 聚合.
- **Q6**: `fact_excretion.reason` 3 值 (duplicate / low_access / manual). `stale` 不写 audit, `contradicted` 走别的 kind — 不可混.

---

## 元教训

1. **4/4 consensus 集中在"遵守已锁合约"** — Q1/Q2/Q4/Q6 都是已锁项的自检, 再投一次仍 Accept. 说明 debate 007 Lock 过程正确.
2. **1-2 票的分歧在实施细节** — Q3 拆不拆 kind (schema 成本判断), Q5 存 observe_id 还是 fact_id (provenance 层次选择). 纯设计口味, 没对错, 多数决.
3. **Gemini 最爱"洁癖分解"** — 逢模糊就提议拆 kind / 加字段. 实用 KISS 路线 (Codex + Sonnet + Opus) 票多.

---

## 下一步 Action

1. 改 `audit.ts` `EvidenceRefs` 的 `wiki_rebuild` 变体: 去掉 `input_observe_ids`, 改 `input_fact_ids`
2. 改 `docs/ARCHITECTURE.md` Table 2 对应行
3. Commit 作为 Week 3 plan-lock 补丁
