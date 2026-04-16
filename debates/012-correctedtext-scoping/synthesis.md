# Debate 012 — Synthesis

## 裁决: Week 5 (不做 Week 4 朴素版)

3/3 一致反对 Week 4 朴素 substring. Sonnet 主动**撤回** 011 的 "Day 5 朴素" 立场.

## 共识事实

- **Consumer: zero**. grep 全仓库, `corrected_text` / `correctedText` 只有:
  - write path: `correction-detector.ts:65` (null 赋值) + `:113` (INSERT) + `:263` (pick-from-hit)
  - schema: `0010_phase4_myco_integration.sql:118` (TEXT column)
  - test: `test/correction-detector.test.ts:38,95,135` (仅验证 column 存在 / 值为 null)
  - 无 `findRelatedFacts` / triage / CLI / ask / reflect 读取
- **P0-5 surface-only 契约 (debate 006) 不残缺**: `retracted_text` + `health_signals.correction_candidate` 已充分表达 "发生了一次 correction". `corrected_text` 是 optional by design (`:118` 注释 "may be on later turn").
- **Week 4 朴素成本**: 5-10 LoC, 2 tests. 成本不是阻塞理由.
- **真实风险**: 字段语义 drift (Sonnet: "locks shape W5 may reject"). 朴素 substring 与未来语义抽取会争 "这个字段是哪种格式".

## 分歧 (细节)

| 立场 | 主张 |
|---|---|
| Opus: `week5-full` | 留 column 留 field, 更新 `:65` TODO 指向 debate 012 + Week 5 |
| Codex: `week5-with-week4-stub-removal` | 更新 TODO 措辞; 不动 schema |
| Sonnet: `week5-with-week4-stub-removal` (激进) | 甚至从 schema + interface 删 `corrected_text`, Week 5 真实装时重加 |

Sonnet 的激进版**收益更大** (彻底消除字段语义 drift + 0 migration 成本
因为尚无数据). 代价**零** (无人读取). 但动 schema 要 migration (0014);
虽然下游零消费, 测试 assert column 存在 (`:38`) 也要改.

## 最终决定 (综合)

**选 Codex/Opus 中间路径**: 保留 column + interface 不动; Week 4 Day 5
只做**注释更新** (不是代码变更):

`correction-detector.ts:65` 从:
```ts
correctedText: null, // TODO(P0-5 Week 2 or later): extract corrected span via context window
```
改为:
```ts
correctedText: null, // Deferred to Week 5 per debate 012 (zero consumers today; surface-only contract permits null). See docs/ROADMAP.md Week 5+ backlog.
```

理由: 保留 column 给 Week 5 真实装时少做一次 migration; 但把 TODO 措辞
改准. Sonnet 的 "drop field" 方案留待**Week 5 真实装时** reconsider —
如果那时设计发现需要改 shape, 再一次 migration 同步搞定.

## 对 Week 4 计划的影响

debate 011 synthesis 里的 Day 5 卫生 sweep 项:
- ❌ 旧: "`correction-detector.ts:65` `correctedText` 朴素版: `content.slice(end, end+200)` + 注释"
- ✅ 新: "`correction-detector.ts:65` 注释更新, 不动代码. Week 5 backlog 加一项 '`correctedText` 语义抽取 (debate 012)'"

估时从 15 min → 2 min, Day 5 腾出时间吸收任何 Day 4 溢出.

## 写入 ROADMAP

Week 5+ backlog (ROADMAP.md 尾部) 新增一项:
- `correctedText` semantic extraction in `correction-detector.ts` — 需要
  context window + 语义边界算法. 现有 `corrected_text` TEXT column (schema
  0010) 保留, 字段语义设计 debate 012 已冻结 "no naive substring".

DONE_012
