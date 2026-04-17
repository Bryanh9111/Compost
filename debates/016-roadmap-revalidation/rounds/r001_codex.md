### Q1 — MODIFY

**Codex position**: 这不是“大小分层”，而是“同步热路径 vs 异步冷路径”分层；继续拿字数讲边界，会把实现做歪。

**Implementation reasoning**: SQLite/FTS5 不关心“200 字”还是“5 句”，它关心的是索引页命中率、查询频率、以及 WAL 下单写锁争用。Engram 要守 `<50ms p95`，靠的是小库 + 高频热页；冷缓存首查和 auto-checkpoint 抖动本来就会把 p99 拉高，边界一旦改成“也可装深层 fact”，只会进一步放大尾延迟。更糟的是 Engram 当前 `recall()` 不是纯读：会更新 `accessed_at/access_count` 并写 `ops_log`，所以每次召回都在抢 writer slot；这和 Compost 的 drain/reflect/wiki worker 负载模型根本不是一回事。

**Boundary enforcement check**: schema 层锁不住“浅/深”这种语义，只能锁长度、来源、scope 这类离散字段。真正可靠的边界只能是 `CHECK` + tool contract + 性能 CI 三件套，缺一件都会漂。

**If REJECT/MODIFY, concrete alternative**:
把边界改写成 SLO/来源边界，而不是字数边界：

```sql
ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'working'
  CHECK(scope IN ('working','meta'));
-- 新库直接建；老库迁移建议重建表并加上以下约束：
-- CHECK(length(content) <= 800)
-- CHECK(origin IN ('human','agent'))
```

配套要求：
- Engram 只接 `working/meta` 的同步召回数据；默认拒绝 `compiled`。
- Compost 只接带 lineage 的 fact/wiki，不拿“短句”作为定义。
- v3.3 审计必须至少测 `PRAGMA cache_size=-8000`、`PRAGMA busy_timeout=250`、冷缓存 p99、checkpoint 抖动，不然 `<50ms` 只是 warm-cache 幻觉。

### Q2 — REJECT

**Codex position**: v3.5 把 Compost 编译产物回写进 Engram 主表，会直接击穿 Engram 的 zero-LLM 信任边界。

**Implementation reasoning**: Engram 当前只有 `origin` 列，没有数据库级 `CHECK`；`recall()` 也不会过滤 `origin`，FTS5 排序会把 human/agent/compiled 混在同一个 `memories_fts` 里。这样一来，用户看到的是“同一套 deterministic recall”，实际上结果已经混入 LLM 合成物，信号被 FTS 排序掩盖了。再加上 `recall()` 会对命中行做 `_touch()` 和 `ops_log` 写入，compiled 行一旦进主表，既污染信任，又真实参与热路径写锁竞争。

**Boundary enforcement check**: `origin=compiled` 作为软标签完全不够，UI 提示也不够。只有数据库级硬拒绝，或者物理分表，才能真正锁死这条边界。

**If REJECT/MODIFY, concrete alternative**:
不要写回 `memories`；单独建缓存表，单独工具暴露，不参加默认 recall：

```sql
CREATE TABLE IF NOT EXISTS compost_cache (
  cache_id TEXT PRIMARY KEY,
  project TEXT,
  prompt_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ttl_expires_at TEXT NOT NULL,
  invalidated_at TEXT,
  origin TEXT NOT NULL DEFAULT 'compiled' CHECK(origin = 'compiled'),
  UNIQUE(project, prompt_hash)
);

CREATE INDEX IF NOT EXISTS idx_compost_cache_live
  ON compost_cache(project, ttl_expires_at)
  WHERE invalidated_at IS NULL;
```

实现约束：
- 不建 `compost_cache_fts`，更不 join 到 `memories_fts`。
- 独立 MCP/CLI：`recall_compost_cache` 或输出单独 section。
- worker 只做 `INSERT ... ON CONFLICT(project, prompt_hash) DO UPDATE`。
- 失效规则用 `source_hash` 比较；TTL GC 单独跑 `DELETE FROM compost_cache WHERE ttl_expires_at < datetime('now')`。

### Q3 — MODIFY

**Codex position**: 跨项目护城河不是假的，但“自动把 A 项目经验迁到 B 项目”这个说法被夸大了；能成立的只有显式标记过的 meta/global 子集。

**Implementation reasoning**: FTS5 只会匹配词，不会理解“这条 guardrail 对当前项目是否适用”；当前实现里跨项目本质上只是把 `project = ?` 过滤拿掉，得到的是更大的候选集和更差的排序噪声。500 条/项目的量级下，性能不是第一问题，正确性才是；误召回一次项目特定约束，比漏召回一次通用 procedure 更伤。想做“自动复用”，至少得有 schema 级显式 scope，不然只是把 ranking 噪声包装成 moat。

**Boundary enforcement check**: schema 可以强制“哪些记录允许脱离 project”，但 schema 无法证明“这条经验真的跨项目有效”。适用性最终还是要靠显式标注和 CI 约束，不可能靠 SQLite 自动推断。

**If REJECT/MODIFY, concrete alternative**:
把跨项目缩成显式小集合，而不是默认能力：

```sql
ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'
  CHECK(scope IN ('project','global','meta'));

-- 迁移时重建表并加硬约束：
-- CHECK((scope = 'project' AND project IS NOT NULL)
--    OR (scope IN ('global','meta') AND project IS NULL))
```

配套规则：
- 默认 recall：`WHERE project = ? OR scope = 'meta'`。
- `scope='global'` 只允许 `guardrail/procedure`；这条用 CI/lint 检，不靠文档。
- 跨项目复用走“手动提升”为主，不走静默 auto-apply。

### Q4 — REJECT

**Codex position**: `recall_miss -> Compost suggest_ingest` 这条异步链的边际价值太低，真实实现成本也绝不是 50 LoC。

**Implementation reasoning**: miss 信号只带“没搜到什么词”，不带源内容；要让它可用，你至少要做 query 归一化、去重、聚合、重试/隔离、可观测性、TTL/GC。Compost 自己现成 outbox 已经证明了真实成本长什么样：表 DDL、唯一键、drain worker、quarantine、reflect prune、crash-recovery 测试，一个都少不了。再往上叠一个 Engram→Compost outbox，就是两个 SQLite 文件之间的 eventual consistency；SQLite 只能保证单库原子，绝不可能给你跨库“写 Engram 成功 = Compost 一定收到”。

**Boundary enforcement check**: schema 只能保证“本库里一条 hint 不重复”，不能保证“另一进程/另一数据库恰好消费一次”。跨进程一致性只能设计成可重放、可丢弃、可审计，不能假装同步成功。

**If REJECT/MODIFY, concrete alternative**:
先把 miss 做成本地证据，不做跨库 outbox：

```sql
CREATE TABLE IF NOT EXISTS recall_miss_log (
  query_norm TEXT NOT NULL,
  project TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  hits INTEGER NOT NULL DEFAULT 1,
  sample_query TEXT NOT NULL,
  PRIMARY KEY (query_norm, project)
);
```

写入策略：
- miss 时执行 `INSERT ... ON CONFLICT(query_norm, project) DO UPDATE SET hits = hits + 1, last_seen = datetime('now')`。
- 先做 `engram stats --misses` / `engram export-misses --since 7d`。
- 真要联动，也走离线导出导入：NDJSON/CSV/SQLite dump 给 `compost import-miss-hints`，不要搞双库 live outbox。

### Q5 — SUPPORT

**Codex position**: 双栈值得保留；把 Engram 工作记忆并进 Compost 的单栈，会把 SQLite/WAL 的单写锁问题直接推到每次 LLM 调用前。

**Implementation reasoning**: SQLite WAL 的基本事实没变：多 reader，单 writer。Engram 当前召回路径会写 `access_count` 和 `ops_log`，Compost 后台又有 outbox drain、ingest、reflect、backup/VACUUM 这类长短不一的写事务；统一到一个 DB，checkpoint 抖动和 writer contention 会直接落在热路径上。两套 DB 的维护成本远小于“一套 DB 扛两种时延目标再加一堆锁编排”的复杂度，尤其当 Compost 还有 LanceDB/LLM side effects 时，更不可能跟 Engram 做真原子统一。

**Boundary enforcement check**: schema 层锁不住“不要互相 import”“不要共享主库”这种架构边界。能锁住它的只有进程隔离、独立二进制、以及 CI 上的静态禁令。

## 最担心的实现陷阱（Codex 独立观察）

1. **Engram 的“读”其实是写**：`recall()` 会 `_touch()` + 写 `ops_log`。这意味着任何“每 turn 都查一次”的路径，在 SQLite 物理层都是 writer；一旦旁边再挂异步回写、GC、checkpoint，尾延迟会立刻恶化。

2. **FTS5 迁移/重建很容易被低估**：`content='memories'` / `content='facts'` 这种 external-content FTS5，给老表补 trigger 不会自动补历史索引。以后不管是拆 `compiled` 分表还是改 schema，迁移里都必须显式做 `INSERT INTO ...('rebuild')` 或全量回填，否则线上会出现“数据在表里，FTS 查不到”的假 miss。

3. **现在谈 `<50ms p95` 还缺最关键的 PRAGMA/测量**：Engram 目前只有 `journal_mode=WAL`，没有 `busy_timeout`、没有 checkpoint 策略、没有 `cache_size` 审计。没有这些，所谓性能预算只是在 warm-cache、无竞争、短 WAL 条件下成立，根本不配指导 roadmap。
