# Debate 012 — `correctedText` 抽取 Week 4 vs Week 5

## 问题

单一裁决: `correction-detector.ts:65` 的 `correctedText: null` TODO — 本周 (Week 4 Day 5) 做朴素实现, 还是整项推 Week 5?

## 上下文 (已落实)

- P0-5 surface-only 契约已 land: `correction_events` + `health_signals.correction_candidate` 走 4 步事务 (debate 006 Pre-Week-2 Fix 5). 不 mutate `facts.confidence`.
- 当前 `retractedText` 存完整 turn (≤ MAX_RETRACTED_TEXT_CHARS), `correctedText` 永远 `null`.
- 一个 P0-1 triage scanner (`scanCorrectionCandidate`) 在 Week 4 Day 3 只是**聚合** `correction_events` 行数, 不需要 `correctedText` 非空.

## 三方立场

- **Codex R1 (011)**: Day 3 与 correction-detector 一起实装, 但没说做到什么精度
- **Sonnet R1 (011)**: Day 5 做 "朴素 substring(end, end+200)" + 注释 "TODO Week 5+: 语义抽取"
- **Opus R1 (011)**: 整项推 Week 5 (Phase 5+ LLM-aided 工作, 本周已载)

## R1 任务 (≤ 400 字)

1. **Week 4 朴素 substring(end+200) 的真实价值**: 对谁有用? 下游 consumer 是谁? (`findRelatedFacts`? triage CLI? 未来 LLM 再 correct?)
2. **本周执行成本**: 多少 LoC? 多少新测试? 多少可能 regression?
3. **推 Week 5 的反对理由**: "什么都不做" 是不是让 correction_events 永远残缺?
4. **裁决**: `week4-naive` / `week5-full` / `week5-with-week4-stub-removal` 三选一 + 一句话理由.

## 硬约束
- ≤ 400 字
- 必须具体 (file:line + 测试 case 描述)
- 不推翻 debate 006 已裁决的 P0-5 surface-only 契约

## 输出
`debates/012-correctedtext-scoping/rounds/r001_<名字>.md`, 末尾 `DONE_R1_012`.
