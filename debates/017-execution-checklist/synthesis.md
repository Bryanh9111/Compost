# Debate 017 Synthesis — v3.3 Execution Checklist

**Date**: 2026-04-16
**Participants**: Opus, Codex, Sonnet (Gemini 配额耗尽跳过)
**Rounds**: 1

## 票数

| Q | Opus | Codex | Sonnet | 共识 |
|---|------|-------|--------|------|
| Q1 Audit 冗余 | SUPPORT | MODIFY (preflight) | SUPPORT | **保留但做成 preflight** |
| Q2 unpin 永久 API | MODIFY (防护版) | REJECT (一次性 SQL) | REJECT | **2:1 反对 Opus，不做永久 API** |
| Q3 Test vs DDL | MODIFY (DSL 先) | SUPPORT (DDL 先) | MODIFY (CI gate) | **DDL 先 + test 紧随 + CI gate** |
| Q4 250 LoC | REJECT | REJECT | REJECT | **3/3 删除 LoC 预算，改功能清单** |
| Q5 前置条件 ≥4 | MODIFY | MODIFY | REJECT | **3/3 改硬入口条件** |

## 关键修正（3 方共识）

### M1: unpin 不做永久 API（Opus 被 2:1 驳回）
原方案：`MemoryStore.unpin()` + CLI + MCP tool = 永久 lifecycle 操作
修正方案：**迁移事务内一次性 SQL**，不暴露 API

理由：
- 目前只为清理 migration 期 compiled 污染
- YAGNI：未来真需要，再单独决策
- Linus: 不为假设需求加 API

### M2: Migration 必须单事务 + FTS rebuild（Codex 硬规则）
```sql
BEGIN IMMEDIATE;
  UPDATE memories SET pinned=0 WHERE origin='compiled' AND pinned=1;
  CREATE TABLE memories_v2 (...);
  INSERT INTO memories_v2 SELECT ... FROM memories;
  DROP TABLE memories;
  ALTER TABLE memories_v2 RENAME TO memories;
  INSERT INTO memories_fts(memories_fts) VALUES('rebuild');  -- 必须显式
COMMIT;
```

三条铁律：
- 任何 CHECK 违反 → 整个事务回滚
- FTS5 external-content 不重建 → 所有记忆"在表里但搜不到"
- WAL checkpoint 绝不在 migration 中间做（crash 风险）

### M3: 删除 LoC 预算，改功能验收清单
原方案："v3.3 ~250 LoC"
修正方案：分切片 + 功能门禁

**Slice A（migration）**: 300-450 LoC
**Slice B（WAL/Repo/kind-lint）**: 独立切片，独立预算
**Slice C（recall_miss log + 冷缓存基准）**: 独立切片

### M4: 硬入口条件精简为 4 条外部可验证
原方案：6 条自我引用产物
修正方案：
1. Step 0 preflight 数据已记录（`SELECT SUM(origin='compiled'), SUM(length>2000), SUM(compiled_pinned)`）
2. 违规行处理策略已书面选定（truncate / drop / downgrade compost_cache）
3. Migration SQL 已 review（单事务 + FTS rebuild 已验证）
4. 现有 113 tests baseline 全绿

## 独家警告收录

**Codex W1-W3**（全接受）:
- FTS5 rebuild 必须显式 `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`
- Migration 必须 `BEGIN IMMEDIATE...COMMIT` 单事务
- WAL checkpoint 不在 migration 中间做

**Sonnet 独家风险**（全接受）:
- 中断后两表共存静默降级 → migration 必须事务化解决（已纳入 M2）
- unpin MCP 批量滥用 → 已取消 API（M1 解决）
- 迁移失败无人类可读 diff → 增补"failure diff report"到功能清单

**Opus 独家警告**（部分接受）:
- Migration 原子性 → 已纳入 M2
- unpin 语义 → 不适用（API 取消）
- Schema DSL → Codex 反对 DSL-first，DDL introspection 更实用
