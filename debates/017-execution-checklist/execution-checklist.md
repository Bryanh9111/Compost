# v3.3 执行清单（定稿）

**Debate 017 三方共识产物**
**Date**: 2026-04-16
**No LoC budget — 改功能验收**

---

## Slice A: Schema Migration（先做）

### Step 0 — Preflight Audit
**目标**: 知道要迁移什么，不摸黑改 schema

```sql
SELECT
  SUM(CASE WHEN origin='compiled' THEN 1 ELSE 0 END) AS compiled_count,
  SUM(CASE WHEN length(content) > 2000 THEN 1 ELSE 0 END) AS long_count,
  SUM(CASE WHEN origin='compiled' AND pinned=1 THEN 1 ELSE 0 END) AS compiled_pinned_count,
  COUNT(*) AS total
FROM memories;
```

**产出**: 一个数字清单 + 写定违规行处理策略
- compiled 行策略：`pinned=0` + 保留 (临时) / 移到 compost_cache / DELETE
- length>2000 行策略：truncate / 移到 compost_cache / DELETE

### Step 1 — Migration（单事务，原子）

```sql
BEGIN IMMEDIATE;

-- 1. 清理 compiled pinned 污染（不加 unpin API）
UPDATE memories SET pinned=0 WHERE origin='compiled' AND pinned=1;

-- 2. 新表带所有 CHECK
CREATE TABLE memories_v2 (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL CHECK(length(content) <= 2000),
  summary TEXT,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('human','agent')),
  project TEXT,
  path_scope TEXT,
  tags TEXT,
  confidence REAL NOT NULL,
  evidence_link TEXT,
  status TEXT NOT NULL,
  strength REAL NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('project','global','meta')),
  created_at TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  last_verified TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  CHECK(
    (scope = 'project' AND project IS NOT NULL)
    OR (scope IN ('global','meta') AND project IS NULL)
  )
);

-- 3. 迁移数据，scope 推断规则：
--    project IS NULL → scope='meta'（用户级全局偏好）
--    project IS NOT NULL → scope='project'
--    origin='compiled' 的行按策略处理（见 Step 0）
INSERT INTO memories_v2
SELECT
  id, content, summary, kind, origin, project, path_scope, tags,
  confidence, evidence_link, status, strength, pinned,
  CASE
    WHEN project IS NULL THEN 'meta'
    ELSE 'project'
  END AS scope,
  created_at, accessed_at, last_verified, access_count
FROM memories
WHERE origin IN ('human','agent')
  AND length(content) <= 2000;

-- 4. 替换
DROP TABLE memories;
ALTER TABLE memories_v2 RENAME TO memories;

-- 5. FTS5 重建（必须显式，否则假 miss）
INSERT INTO memories_fts(memories_fts) VALUES('rebuild');

-- 6. 新增 recall_miss_log 表
CREATE TABLE IF NOT EXISTS recall_miss_log (
  query_norm TEXT NOT NULL,
  project TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  hits INTEGER NOT NULL DEFAULT 1,
  sample_query TEXT NOT NULL,
  PRIMARY KEY (query_norm, project)
);

-- 7. 新增 compost_cache 表（DDL only，数据层 v3.5 再做）
CREATE TABLE IF NOT EXISTS compost_cache (
  cache_id TEXT PRIMARY KEY,
  project TEXT,
  prompt_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ttl_expires_at TEXT NOT NULL,
  invalidated_at TEXT,
  origin TEXT NOT NULL DEFAULT 'compiled' CHECK(origin='compiled'),
  UNIQUE(project, prompt_hash)
);

COMMIT;
```

### Step 2 — Invariant Tests 脚手架
位置: `tests/test_architecture_invariants.py`

覆盖：
- AST 扫描: 核心模块（`store.py`, `db.py`, `model.py`, `proactive.py`）禁 `import (anthropic|openai|google-genai|google.generativeai)`
- AST 扫描: 禁 `import compost_*`
- Schema introspection（读真实 DB）:
  - `memories.scope` 列存在 + CHECK 值集合正确
  - `memories.origin` CHECK IN ('human','agent')
  - `memories.content` CHECK length ≤ 2000
  - `recall_miss_log` 表存在
  - `compost_cache` 表存在 + `origin='compiled'` CHECK
- 耦合度: `grep -r 'from compost' src/engram/` 结果为空

---

## Slice A 硬入口条件（migration 前必须 4 条全满足）

- [ ] Step 0 preflight 数据已记录（实际 compiled/long/compiled_pinned 数量）
- [ ] 违规行处理策略已书面选定（写在 `docs/v3.3-migration-plan.md`）
- [ ] Migration SQL 已 review（单事务 + FTS rebuild 已验证）
- [ ] 现有 113 tests baseline 全绿

---

## Slice A 功能验收清单（migration 后）

- [ ] Migration 能跑，能 rollback（有 `--dry-run` + `--backup` + `--rollback` CLI）
- [ ] 迁移后 113 tests 仍全绿（无 regression）
- [ ] FTS5 recall 所有数据可搜（`SELECT COUNT(*) FROM memories_fts` = 记忆总数）
- [ ] `test_architecture_invariants.py` 全绿
- [ ] 无 `origin='compiled'` 在 memories 主表
- [ ] 无 `length(content)>2000` 在 memories 主表
- [ ] 所有记忆有有效 `scope` 字段
- [ ] 迁移失败时产生人类可读 diff 报告（哪些行被拒，原因）

---

## Slice B: Hardening（Slice A 完成后）

- PRAGMA 审计: `busy_timeout=250`, `cache_size=-8000`, wal_autocheckpoint 策略
- 冷缓存 p99 基准（目标 <200ms 降级信号）
- Warm p95 <50ms 基准
- Repository 抽象层（~20 LoC，保留换后端可能）
- kind-lint 分级改造（global/meta scope 不走 TTL）

**独立预算，Slice A 不动这些**。

---

## Slice C: Miss Log Active（Slice B 完成后）

- `MemoryStore.recall()` 空结果时写入 `recall_miss_log`
- `engram stats --misses` CLI 显示 top N
- `engram export-misses --since 7d` NDJSON 输出
- **无跨库，无 outbox，无 Compost 通知**

---

## 已砍 / 延后

- ❌ `unpin()` API（2:1 反对，改迁移事务内一次性 SQL）
- ❌ v3.4 Engram→Compost suggest_ingest（debate 016 砍掉）
- ⏸ v3.5 Compost→Engram 写回实际数据（DDL 已建空表，数据层等 Compost 侧准备好）
- ⏸ embedding/语义搜索（永久观察指标，recall_miss rate >15% 触发重评）

---

## 进入实施的指令

1. 跑 Step 0 preflight audit
2. 写 `docs/v3.3-migration-plan.md` 记录策略
3. Implement Slice A Step 1 migration + tests
4. 跑 hard 入口条件 4 条
5. 满足后 apply migration（带 `--dry-run` 先）
6. 验收清单全勾后才能宣称 Slice A 完成
