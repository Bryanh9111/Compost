# Debate 016 Synthesis — Roadmap Revalidation

**Date**: 2026-04-16
**Participants**: Opus (10-year lens), Sonnet (user mental model), Codex (SQLite/FTS5/WAL), Gemini-flash (ecosystem)
**Rounds**: 1 (Round 2 skipped — quota exhausted + clear consensus)

---

## 票数汇总

| Q | Opus | Sonnet | Codex | Gemini | 共识 |
|---|------|--------|-------|--------|------|
| Q1 定位分界（字数 vs SLO）| MODIFY | MODIFY | MODIFY | REJECT | **4/4 质疑** |
| Q2 compiled 写回 Engram | REJECT | REJECT | REJECT | MODIFY | **4/4 质疑** |
| Q3 跨项目护城河真实性 | MODIFY | REJECT | MODIFY | REJECT | **4/4 质疑** |
| Q4 v3.4 suggest_ingest | REJECT | REJECT | REJECT | SUPPORT | **3/4 质疑** |
| Q5 双栈代价 | SUPPORT | MODIFY | SUPPORT | SUPPORT | **3/4 支持** |

**裁决**: 4/5 Q 被质疑（阈值 ≥3），必须产出 revised roadmap v2。Q5 双栈通过。

---

## 跨方共识（≥3 方同意的硬点）

### C1 边界从"字数"改为"SLO + 来源"（Opus + Codex + Sonnet）
- Engram 的真正不变量是"LLM call 前置注入预算 <50ms p95"，不是"单条 <200 字"
- Compost 的真正不变量是"fact 必须带 source_fact_ids"，不是"1-5 句"
- schema 层用 `CHECK(length(content) <= 2000)` + `CHECK(origin IN ('human','agent'))` 锁死，字符数只是 SLO 的副作用

### C2 compiled origin 绝不能进 Engram 主表（Opus + Sonnet + Codex 三方 REJECT）
- `origin=compiled` 作为软标签抵御不了 10 年的熵 —— 3-5 年内会从 5% 涨到 40%
- FTS5 排序会把 human/agent/compiled 混在同一套 recall 结果里，信任信号被掩盖
- Engram 的"zero-LLM"是**唯一**相对 mem0/Letta/ChromaDB-mem 的技术护城河
- 方案：**独立 `compost_cache` 表** + 独立 MCP tool + 不进 default recall + 不进 memories_fts

### C3 跨项目护城河需 schema 级显式 scope（Opus + Codex 一致提出 DDL）
- `project=None` 默认推断过弱，会被误伤/滥用
- 新增 `scope` 枚举: `project` / `global` / `meta`
- `CHECK((scope='project' AND project IS NOT NULL) OR (scope IN ('global','meta') AND project IS NULL))`
- 默认 recall `WHERE project=? OR scope='meta'`，`global` 需显式请求

### C4 v3.4 先做本地日志，不做跨库 outbox（Opus + Sonnet + Codex 一致）
- recall_miss 信号稀疏（90% 可能是噪声），无源内容难以让 Compost 反向找
- 跨库 eventual consistency + outbox GC + 幂等 + 重试远超 50 LoC
- 方案：本地 `recall_miss_log` 表 + `engram stats --misses` CLI，3-6 月数据驱动决定

### C5 双栈保留，但用**架构不变量测试**硬锁边界（Opus + Codex）
- 2 DBs/MCPs/CLIs 的维护成本 < 合并单栈的锁争用/SLO 冲突成本
- 关键：显式声明"kill Compost 成本 < 50 行 Engram 改动"的 10 年 invariant
- CI 加规则: Engram 核心代码不得 `import compost_*`

### C6 Gemini 独家警告（未被 C1-C5 覆盖）
- **永久无 embedding 是长期风险**: 纯 FTS5 在 500+ 条后 miss rate 线性上升
- 但这与 zero-LLM 承诺不冲突：embedding 是"外部预计算"，不是运行时 LLM 调用
- **判决**: 不因此恢复 v6，但留作 v3.5 后的观察指标（recall_miss rate >15% 时重新评估）

---

## Opus 独家长期风险（3 条都接受）

R1. **架构不变量测试必须可执行** —— `tests/test_architecture_invariants.py` 用 AST + schema introspection 把"不得调 LLM / 耦合点 ≤1 / 跨系统接口 via MCP"变成可执行断言

R2. **MCP 协议锁定风险** —— 核心 API 与 FastMCP 解耦，server.py 只做 adapter，核心必须能被 HTTP/gRPC/直接 import 调用

R3. **SQLite "够用陷阱"** —— 检索路径走薄 repository 抽象层（不是提前优化，是保留未来替换可能性，~20 LoC）

---

## Codex 独家实现陷阱（3 条都接受）

I1. **Engram `recall()` 实际是写路径** —— 更新 access_count + ops_log 会抢 writer slot；异步回写/GC/checkpoint 同时进来时尾延迟恶化

I2. **FTS5 external-content 迁移陷阱** —— 改 schema 必须显式 `INSERT INTO ...('rebuild')`，否则"数据在表里，FTS 查不到"的假 miss

I3. **现有 `<50ms p95` 是 warm-cache 幻觉** —— 缺 `PRAGMA busy_timeout/cache_size/checkpoint` 审计，v3.3 必须测冷缓存 p99

---

## Sonnet 独家心智陷阱（3 条都接受）

M1. **跨系统异步通道静默失败不可感知** —— 任何跨系统通道必须有可见失败日志（至少写到 `engram stats`）

M2. **compiled 条目半衰期不可见** —— 如果真要做 compost cache，必须显示 `cached_at` 和 TTL 倒计时

M3. **双栈 proactive 在 session_start 的 token 预算冲突** —— 两套 proactive 不能无协调叠加，需预算分配规则

---

# Revised Roadmap v2

## v3.3 — Foundation Audit + Invariants (expanded: ~250 LoC, 原 100)

### 新增 schema 约束（DDL migration）
```sql
ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'
  CHECK(scope IN ('project','global','meta'));

-- 迁移时重建表加硬约束:
-- CHECK(length(content) <= 2000)
-- CHECK(origin IN ('human','agent'))  -- compiled 禁入主表
-- CHECK((scope='project' AND project IS NOT NULL)
--    OR (scope IN ('global','meta') AND project IS NULL))

CREATE TABLE recall_miss_log (
  query_norm TEXT NOT NULL,
  project TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  hits INTEGER NOT NULL DEFAULT 1,
  sample_query TEXT NOT NULL,
  PRIMARY KEY (query_norm, project)
);
```

### WAL/FTS5 审计（必测）
- `PRAGMA busy_timeout=250`
- `PRAGMA cache_size=-8000`（8MB）
- `PRAGMA wal_autocheckpoint` 策略
- 冷缓存 p99 基准（目标 <200ms，降级信号）
- Warm-cache p95 <50ms（当前宣称）

### 架构不变量测试（`tests/test_architecture_invariants.py`）
- AST 扫描：核心模块禁 import LLM SDK（anthropic/openai/gemini）
- Schema 断言：origin 值集合、scope 约束、content length
- 耦合度断言：Engram → Compost 的 import 数 = 0
- MCP 协议解耦断言：`store.py` 不 import FastMCP

### Repository 抽象层（~20 LoC）
- 所有检索路径走 `MemoryRepository` 接口
- 保留未来替换 SQLite 可能性

### kind-specific 分级 lint
- 保持原有 7d/30d/90d TTL
- 新增: global/meta scope 不走 TTL（跨项目记忆不应过期）

### 本地 recall_miss 日志
- `engram stats --misses` 显示 top N miss queries
- `engram export-misses --since 7d` 输出 NDJSON
- **不跨库，不 outbox，不通知 Compost**

---

## v3.4 — KILLED / DEFERRED

原计划的 Engram→Compost suggest_ingest **砍掉**。理由：
- 信号稀疏无源内容
- 跨库 eventual consistency 成本远超 50 LoC
- 边际价值 0（Compost 已有 3 条入口）

**替代动作**: v3.3 的本地 miss log 积累 3-6 月数据后，用 `compost import-miss-hints` 走**离线导出导入**，不做 live outbox。

**触发条件**（重新评估 v3.4 是否做）:
- 本地 miss log 中 ≥30% 查询有明确源内容可指向
- 用户手动触发 compost ingest 的频率 >2 次/周
- 异步通道失败可观测性方案已成熟

---

## v3.5 — Compost Cache（redesigned, ~120 LoC）

**关键变更**: 不写回 memories 主表，独立 `compost_cache` 表

### DDL
```sql
CREATE TABLE compost_cache (
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

CREATE INDEX idx_compost_cache_live
  ON compost_cache(project, ttl_expires_at)
  WHERE invalidated_at IS NULL;
```

### 隔离规则
- 不建 `compost_cache_fts`，不 join 到 `memories_fts`
- 独立 MCP tool: `mcp__engram__recall_compost_cache`
- CLI 输出独立 section: `--- from compost cache ---`
- 默认 `recall()` 不含 compost cache
- 用户显式 opt-in: `recall(include_compost_cache=True)`

### 失效 + GC
- worker `INSERT ... ON CONFLICT(project, prompt_hash) DO UPDATE`
- source_hash 变化 → 自动 invalidate
- TTL GC daemon: `DELETE FROM compost_cache WHERE ttl_expires_at < datetime('now')`
- 可见 TTL: 所有 compost cache 条目显示 `cached_at` + `expires_in`

---

## v3.x 硬约束（expanded: ~80 LoC, 原 30）

### Schema 层
- `memories.embedding` 列禁止（CI 扫描 schema 文件）
- `memories.origin IN ('human','agent')` CHECK（compiled 禁入主表）
- `memories.scope` 非空枚举

### CI 规则
- Engram 核心代码不得 `import compost_*`
- 核心模块不得 `import (anthropic|openai|google-genai)`
- `tests/test_architecture_invariants.py` 必须 pass
- MCP server 代码不得 import 核心 store 以外的模块（除 server.py 自身）

### CONTRIBUTING.md 新增
- 每年架构 review: "如果明天砍 Compost，Engram 要改多少代码" ≤50 行
- 每年架构 review: "如果 MCP 协议淘汰，迁移成本" ≤200 行
- 任何新增 `origin` 枚举值需 ADR（Architecture Decision Record）
- 任何跨系统耦合点需 ADR

### 文档层
- README: 改"图书馆 vs 便条夹"为"**热路径 <50ms 确定性记忆** vs **冷路径 LLM 合成知识**"
- CLAUDE.md: 明确 scope 字段使用规则
- 不再宣传"跨项目经验自动迁移"，改为"显式 global scope 的工程原则库"

---

## 长期观察指标（trigger future re-evaluation）

| 指标 | 阈值 | 触发 |
|------|------|------|
| 本地 miss log 有源内容率 | ≥30% | 重新评估 v3.4 |
| 冷缓存 p99 | >200ms | v3.3 紧急优化 |
| FTS5 miss rate（用户报告） | >15% | 重新评估 embedding 方案（不走 v6 老路，走 sqlite-vec 外部索引） |
| Engram 总记忆数 | >2000 | 考虑 repository 层换后端 |
| compost_cache 条目数 | >500 | 考虑是否值得做，或回退到 Compost 端缓存 |

---

## 进入实现阶段的前置条件

1. ✅ 定位叙事从"粒度"改为"SLO + 来源"（写入 README + CLAUDE.md）
2. ⬜ v3.3 DDL migration 设计（包含 scope + CHECK constraints + recall_miss_log）
3. ⬜ `tests/test_architecture_invariants.py` 脚手架
4. ⬜ WAL/FTS5 审计基准测试（冷缓存 p99 + warm p95）
5. ⬜ Repository 抽象层设计
6. ⬜ CONTRIBUTING.md 更新（架构不变量 + 年度 review 规则）

满足 ≥4 条后可以开始 v3.3 实现。

---

## 最终结论

**debate 015 的方向正确但细节必须重设**。核心三个失误：

1. 用"字数"描述边界 → 10 年内会被侵蚀 → 改 SLO + schema CHECK
2. compiled 写回主表 → 信任模型崩塌 → 改独立表
3. recall_miss 跨库 outbox → 成本远超收益 → 先本地日志

**双栈架构本身通过验证**，但必须配架构不变量测试才能保住 10 年。

Compost 独立：compost 生态位清晰（LLM 合成 + source lineage），承担 Engram 的 LLM 缓存角色需要新 API（不是写回 Engram）。

进入 v3.3 实现阶段 **需要先更新 DDL 设计和不变量测试脚手架**，不能直接按 015 的 LoC 估算动工。
