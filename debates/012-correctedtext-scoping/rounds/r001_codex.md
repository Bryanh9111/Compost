1. `correction-detector.ts:174-195` 仍 `return []`，`triage.ts:55-72` 只计数；Week 4 朴素 `substring` 无 consumer。
2. 成本：`correction-detector.ts:55-66` 10 LoC；`correction-detector.test.ts` 测 2 例：尾句抽取、长文不越界。风险是写入 JSON 尾巴。
3. 推 Week 5 不残缺：debate 006 已由 `retracted_text`+signal 满足 surface-only。
4. 裁决：`week5-with-week4-stub-removal`；把 `correction-detector.ts:65` TODO 改为 Week 5 语义抽取。

DONE_R1_012
