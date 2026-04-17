# Debate 017: v3.3 Execution Checklist Final Consensus

**Date**: 2026-04-16
**Scope**: 限定在执行清单顺序/粒度/LoC，不展开架构
**Participants**: Opus (maintenance), Codex (SQLite/FTS5), Sonnet (UX risk)
**Rounds**: 1 (精简)

## 当前执行清单

从 debate 016 synthesis + 后续对话出来的 v3.3 执行清单：

```
0. Audit: 统计现有 500 条记忆里
   - origin='compiled' 的 count
   - length(content) > 2000 的 count
   - pinned 中违反将要加的 CHECK 的 count
   - 用来决定迁移策略（truncate / 降级到 compost_cache / fail-fast）

1. unpin() API (5 LoC + 1 test)
   - MemoryStore.unpin(id) 方法
   - engram unpin <id> CLI
   - mcp__engram__unpin MCP tool
   - 用途: migration 前 unpin 污染的 compiled origin 旧记忆
   - 前置: 无

2. DDL migration SQL (~150 LoC)
   - 新表 memories_v2: scope 枚举 + origin CHECK + length CHECK
   - recall_miss_log 表
   - compost_cache 表 (DDL 先建空, 数据层 v3.5 再做)
   - INSERT INTO memories_v2 SELECT ... with scope 推断规则
   - rollback SQL
   - 前置: step 0/1

3. Invariant tests 脚手架 (~100 LoC)
   - tests/test_architecture_invariants.py
   - AST 扫描: 禁 import anthropic/openai/google-genai, 禁 import compost_*
   - Schema introspection: scope 字段存在, origin CHECK, length CHECK
   - 耦合度: Engram 到 Compost 的 import 数 = 0
   - 前置: step 2 (schema 要定型)

后续:
4. WAL/FTS5 审计 (PRAGMA busy_timeout=250, cache_size=-8000)
5. 冷缓存 p99 基准测试
6. Repository 抽象层 (~20 LoC)
7. kind-lint 分级 + global/meta scope 不走 TTL
8. recall_miss 本地日志写入 (engram stats --misses)
```

**总预算**: ~250 LoC (debate 016 synthesis 确认)

## 5 个质疑问题

### Q1: Step 0 Audit 是否冗余？
替代方案：直接跑 `CREATE TABLE memories_v2 + INSERT SELECT`，让违反 CHECK 的行自然失败，然后分类处理。
辩论: audit 独立 step 是 overkill 还是必要？

### Q2: Step 1 unpin API 是否真的 block Step 2？
替代方案：迁移脚本里直接写 `UPDATE memories SET pinned=0 WHERE origin='compiled' AND pinned=1`，一次性 SQL 搞定，不加永久 API。
辩论: unpin 应该是临时迁移工具还是永久 API？

### Q3: Step 2 vs Step 3 顺序（TDD 原则）
TDD 说 test 先。但 invariant test 需要 schema 定型（断言 scope 字段存在等）。
辩论: 应该先写 invariant test（用 expected schema DSL 声明）再跑 DDL 让 test 通过？还是 DDL 先？

### Q4: v3.3 LoC 预算 ~250 是否现实？
包含：DDL + migration SQL + rollback + 新 API + MCP tool + CLI + invariant tests + PRAGMA audit + 基准测试 + Repository 抽象 + kind-lint 改造 + recall_miss 日志。
辩论: 250 LoC 是否严重低估？漏算什么？

### Q5: 前置条件（synthesis 列的 6 条）满足 ≥4 才能实施，是否过严？
原 6 条: README 改叙事 / DDL 设计 / invariant test 脚手架 / WAL 基准 / Repository 抽象 / CONTRIBUTING 更新
辩论: 全是实现阶段的产物自己，自我引用。是否应该改为"step 0 完成后才能进 step 2"这种硬依赖？

## 输出契约

每方对 5 Q 给 SUPPORT / REJECT / MODIFY + 一句话理由 + 若 REJECT/MODIFY 给替代方案。
我（Opus 主会话）做最终 synthesis，产出 **定稿执行清单** 写入 `execution-checklist.md`。
