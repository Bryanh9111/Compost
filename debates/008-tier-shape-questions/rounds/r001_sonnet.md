# Debate 008 R1 - Sonnet 4.6 (KISS / 范围视角)

日期: 2026-04-15
参赛者: Sonnet 4.6 (claude-sonnet-4-6)

---

## Q1: contradiction_arbitration = instance (0.85) 还是 kernel (0.90)?

**Accept** — instance (0.85)

理由: `audit.ts:72` 的 `TIER_FOR_KIND` 已锁定 `contradiction_arbitration: "instance"`，与 `ARCHITECTURE.md` 表格完全对齐，且语义正确——仲裁是对一组证据的局部判断，不是操作员级配置变更，不需要 kernel 的 0.90 门槛。

---

## Q2: wiki_rebuild = instance (0.85) 还是 kernel (0.90)?

**Accept** — instance (0.85)

理由: `audit.ts:72` 同样锁定 `wiki_rebuild: "instance"`；`wiki.ts` 中 `synthesizePage` 汇聚多个来源事实合成页面，输入的不确定性天然低于 kernel 级别的操作员配置，instance 0.85 是正确的保守下限。

---

## Q3: fact_excretion 分 heuristic/manual 两 tier OK？还是拆成两 kind？

**Accept** — 保留单 kind + 两 tier

理由: `audit.ts:71` 已将 `fact_excretion` 从 `TIER_FOR_KIND` 的类型签名中排除（`Exclude<AuditKind, "fact_excretion">`），调用方按 `evidenceRefs.reason` 显式传 tier，注释已说明原因——拆成两个 kind 会让 `AuditKind` 增宽、迁移 0010 的 CHECK 约束必须同步扩展，破坏已锁定的 schema，收益为零。

---

## Q4: contradiction_arbitration.loser_ids[] plural (per cluster 1 audit) vs single (per loser 1 audit)?

**Accept** — plural loser_ids[]，per cluster 1 audit row

理由: `EvidenceRefs` 中 `contradiction_arbitration` 已定义 `loser_ids: string[]`（`audit.ts:39`），`reflect.ts:237-245` 的 cluster 循环也天然是 per-cluster 操作；若改为 per-loser 写行，同一仲裁事件会膨胀成 N 行，`decision_audit` 的"one row per high-cost decision"契约（`ARCHITECTURE.md` line 164）直接被违反。

---

## Q5: wiki_rebuild 存 input_observe_ids[] only？还是 both observe_ids + fact_ids？

**Accept** — input_observe_ids[] only

理由: `EvidenceRefs` 中 `wiki_rebuild` 仅含 `input_observe_ids[]` + `input_fact_count`（`audit.ts:47-49`），`wiki.ts:130-141` 的实现也只遍历 observe_id 写入 `wiki_page_observe`；fact_ids 在 L0->L2 的 FK 链下可通过 observe_id 完整推导，额外存储 fact_ids 是冗余，且 `evidence_refs_json` 的形状已在 debate 007 Lock 1 冻结，不应扩展。

---

## Q6: fact_excretion.reason 不含 stale/contradicted OK？还是用 archive_reason 完整 enum？

**Accept** — reason 只含 duplicate / low_access / manual，不扩展

理由: `audit.ts:53` 的 `reason` union 与 `ARCHITECTURE.md` 的 `archive_reason` 表格对齐是刻意的——`stale` 无 audit 行（Lock 2 明文禁止），`contradicted` 由 `contradiction_arbitration` kind 覆盖，两者都不是 `fact_excretion` 的职责；合并枚举会破坏 audit kind 的职责边界，让消费方无法用 `kind` 字段直接路由。

---

## 最终一览

| Q | 决定 |
|---|------|
| Q1 contradiction_arbitration tier | Accept instance 0.85 |
| Q2 wiki_rebuild tier | Accept instance 0.85 |
| Q3 fact_excretion 单 kind + 两 tier | Accept |
| Q4 loser_ids[] per cluster | Accept |
| Q5 observe_ids only | Accept |
| Q6 reason 不扩展 stale/contradicted | Accept |

---

## 告诫

六个问题的答案都已写进代码和冻结文档里了——辩论的价值不在于翻案，而在于确认每一个"Accept"背后都有真实代码行佐证，而不是靠记忆投票。

---

DONE_R1_SONNET_008
