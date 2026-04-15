**Q1**: Accept
- 理由: `reflect` 现在是按置信度/时间戳排序的实例级裁决，`confidence_floor` 只是审计写入下限，不该把启发式抬成内核真理。

**Q2**: Accept
- 理由: `wiki_rebuild` 是多事实合成而非单源裁定，0.85 更贴合“可信但需追溯输入”的生成性质。

**Q3**: Accept
- 理由: `fact_excretion` 是同一类写路径，`reason` 已可判别；拆成两个 kind 只会放大 migration、CHECK 与查询分支。

**Q4**: Accept
- 理由: 保持 `loser_ids[]`、每 cluster 1 行更贴合 `reflect` 的聚类事务边界，也避免按 loser 爆行。

**Q5**: Modify
- 理由: 只存 `input_observe_ids[]` 让审 wiki 必须再跳一层 join，直接核对采用 facts 不直观。
- 替代 (仅 Modify): 存 `input_fact_ids[]` + `input_observe_ids[]`，前者保审计可读性，后者保来源追溯。

**Q6**: Accept
- 理由: `archive_reason` 描述事实为何归档，`fact_excretion.reason` 描述批处理类别；强行共用 enum 会引入永不合法的值。

### 最终 preferred 答案 (一览)
- Q1: Accept
- Q2: Accept
- Q3: Accept
- Q4: Accept
- Q5: Modify
- Q6: Accept

### 一句话告诫 (≤ 100 字)
别让审计 schema 需要“解释”才能消费；多一层猜测，测试和排障都会更脆。
