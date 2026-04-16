# R1 — Opus (verdict: week5-full)

## 1. 真实价值 (Week 4 朴素 substring)

Grep 全仓库: `correctedText` 除 ① `correction-detector.ts:65` 赋 null, ②
`storeCorrectionEvent` INSERT 到 `correction_events.corrected_text`
(`.ts:108-113`), ③ test 断言 column 存在 (`test/correction-detector.test.ts:38`)
外**零消费者**. 无 `findRelatedFacts` 用它, 无 triage 聚合读它, 无 CLI 打印它.

朴素 `turnText.slice(endIdx, endIdx+200)` 填进去 = 污染 column 给后续
"这个字段是什么格式" 的 reader 增负担. 未来真要做语义抽取时, 还要判
"这是旧朴素 substring 还是新语义结果". 这是**字段语义 drift**.

## 2. Week 4 执行成本

LoC ≈ 10 (正则 match.index + endIdx + slice). 测试 ≥ 3 (无 corrected
片段 / 短片段 / 长片段截断). 回归风险低 — 函数纯, 表 already 存 TEXT.
总 ~30 min. 成本不是阻塞理由.

## 3. "Week 5 推" 的反对检视

"NULL 永远残缺" 不成立: P0-5 surface-only 契约 (debate 006) 明确
`corrected_text` 是 optional, 可能在**后续 turn** 出现. 当前 null 是
**正确的 under-report**, 不是 bug. triage scan Day 3 按**事件数**聚合,
不看 corrected_text 内容.

真反对理由: "Week 5 如果也不做, 这字段永远空". 这是 Week 5 规划问题,
不是 Week 4 的义务.

## 4. 裁决: **week5-full**

理由: 当前零 consumer + 字段语义 drift 风险 + Week 4 scope guard > 30
min 朴素版的价值. Week 5 做时走完整设计: 上下文窗口 + 语义边界 + retracted
前后 N turn 覆盖. 同时删 `:65` TODO 里的 "Week 2 or later" 过时痕迹,
改为 "Week 5+ 见 debate 012".

Day 5 sweep 只做一个动作: `correction-detector.ts:65` 注释改为
`// correctedText extraction deferred to Week 5 (debate 012); surface-only
contract permits null`.

DONE_R1_012
