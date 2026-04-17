# Round 1 — Opus（10 年维护视角）

### Q1 — SUPPORT
Audit 不是"万一失败的防御"，是"知道自己在改什么"。5 行 SQL 就跑完，省下的是"CREATE TABLE 失败后追查为什么"的时间。长期看每次 schema 改动都应该先 audit，变成习惯。

### Q2 — MODIFY
Sonnet 担忧的"批量滥用"是真的，但答案不是"一次性 SQL"——pin/unpin 是 lifecycle 对称操作，没有 unpin 是设计缺陷。API 加上防护：
- 单次只 unpin 一个 ID（参数不接 list）
- 操作写入 ops_log（可审计）
- CLI 需交互式 confirm（`--yes` 才能跳过）
- MCP tool description 明写 "use sparingly, prefer supersede via new memory"
- 不暴露 `unpin_all()` 类批量 API

### Q3 — MODIFY
TDD 原则该坚持，但 invariant test 不是单元测试，是架构约束。正确顺序：
1. 先写 **expected schema DSL**（Python dict 或 YAML 声明将要的表结构）
2. 写 invariant test 读 DSL 断言
3. test 先 fail
4. DDL 实现
5. test 通过

DSL 成为 single source of truth，DDL 只是实现。10 年后改 schema 只改 DSL，测试自动验证 drift。

### Q4 — REJECT
250 LoC 严重低估，且 LoC 是错误指标。漏算：
- migration CLI 包装（`--dry-run`, `--backup`, `--rollback`）
- 迁移失败的 diff 报告输出
- 所有新 API 的 docstrings
- CI 配置（加 test_architecture_invariants 到 pytest 必跑）
- MCP tool description 更新
- CLAUDE.md 更新 scope 使用规则
- README 更新叙事

真实估计 ~500-600 LoC。应该改为**功能验收清单**：
- [ ] migration 能跑，能 rollback
- [ ] unpin CLI/MCP 可用，ops_log 记录
- [ ] test_architecture_invariants.py 绿
- [ ] 冷缓存 p99 已基准
- [ ] 113 现有 tests 全绿

LoC 预算应删除，改用功能门禁。

### Q5 — MODIFY
6 条前置自我引用是设计缺陷。改为 **2 条外部硬依赖**：
1. 现有 113 tests 全绿（baseline 不被破坏）
2. Step 0 audit 数据已获（不摸黑改 schema）

其他 4 条（DDL 设计 / invariant 脚手架 / WAL 基准 / Repository 抽象）是实施产物本身，不该放在前置条件里。

## Opus 独家警告

1. **Migration 原子性**: 所有 schema 改动必须在一个事务里（BEGIN + CREATE + INSERT SELECT + DROP + RENAME + COMMIT），或者直接 COMMIT 失败。中途成功的"一半迁移"是 10 年后最大的 debug 噩梦。

2. **unpin 的语义含糊**: unpin 不等于 "允许 forget"——还要考虑 unpin 后是否仍保留 "human origin 权重加成"。如果 unpin 仅等于 pinned=0，那是对的；但不能暗含 "降级 origin"。语义必须单一。

3. **Schema DSL 未来扩展性**: 如果今天只写 memories_v2 的 DSL，明天加 compost_cache 就要扩展 DSL。建议 DSL 从 day 1 就支持多表声明，不要写死。
