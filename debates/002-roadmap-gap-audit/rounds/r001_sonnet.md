# R1 — Sonnet 4.6 (🟠 务实工程 / KISS / 范围控制)
> Debate 002: Phase 4-6 路线图 Gap 审计
> 2026-04-14

---

## 1. Top 5 盲点 (严重度降序)

### B1. migration 无回滚路径 [严重]

**描述**: `migrator.ts` 只做 forward-apply, 无任何 down migration 或 rollback 机制. 每次 `db.exec("BEGIN IMMEDIATE")` 失败后 ROLLBACK, 但已成功的前序 migration 无法撤销.

**触发条件**: 0010 migration 的 `ALTER TABLE facts ADD COLUMN archive_reason` 成功落地后, 发现 `archive_reason` 的 CHECK constraint 遗漏了一个枚举值 (如 `low_volume`). 无法只撤销这一列, 只能全库重建或新 migration workaround.

**影响**: 生产 SQLite 文件损坏或 schema 语义错误, 用户唯一选择是删除 `~/.compost/db.sqlite` 并重建, 丢失所有知识.

**最小修复**: 在 `_compost_migrations` 表加 `down_sql TEXT NULL` 列; `applyMigrations` 同时写入; 提供 `compost migrate rollback <name>` CLI. Phase 4 Batch D 前完成.

**Phase**: 应在 Phase 4 Batch D 之前 (现在是 P0 前置条件).

---

### B2. LLM 单点故障无降级策略 [严重]

**描述**: `ask.ts` 的整个 LLM synthesis 路径只有 Ollama 适配器, `scheduler.ts` 中的 ingest worker 依赖 `OllamaEmbeddingService`. 路线图完全没提 LLM 故障处理.

**触发条件**: 用户在无网络的飞机上使用 `compost ask`, Ollama daemon 未启动. 此时 `ask()` 抛异常, 但 `ARCHITECTURE.md` 声称 "BM25 works without LanceDB" — 这只是检索降级, 没有 ask 降级. 更严重: ingest worker 在 Ollama 不可用时会持续重试失败, 导致队列堆积.

**影响**: Phase 4 引入更多 LLM 调用路径 (triage 信号生成, decision_audit rationale), 每新增一条路径都加重这个单点.

**最小修复**: `LLMService.generate()` 调用加 timeout + fallback (直接返回 top-N facts 拼接, 标注 `[LLM unavailable]`). `EmbeddingService` 失败时 ingest worker 标记 `embedded_at=NULL` 跳过而非死循环. Phase 4 P0 前.

**Phase**: Phase 4 (应与 triage 同批).

---

### B3. `v_graph_health` stub 暴露给 scheduler 但 fact_links 表不存在 [高]

**描述**: 0010 migration 中 `v_graph_health` view 的 `orphan_facts / density / cluster_count` 全部返回 NULL. `graph_health_snapshot` 表的 `orphan_facts` / `density` / `cluster_count` 是 `NOT NULL`. 如果有代码向 `graph_health_snapshot` INSERT 一行 (来自 scheduler 或 triage), 因为这些列是 NOT NULL 且无 DEFAULT, 会触发约束错误.

**触发条件**: Phase 4 P0-3 的 triage 模块尝试做 daily snapshot INSERT, 直接取 `v_graph_health` 当前值 (全 NULL) 写入 `graph_health_snapshot`.

**影响**: 每次 snapshot 任务失败并写入 health_signals error, 产生噪音循环.

**最小修复**: `graph_health_snapshot` 的 `orphan_facts / density / cluster_count` 加 `DEFAULT 0` 或改为 `NULLABLE`; 或 snapshot 代码在 fact_links 不存在时跳过. 一行 SQL 修复, 在 migration 0010 或 0011 中.

**Phase**: Phase 4 Batch D (P0-3 实施前必须修).

---

### B4. Phase 5 多机同步无冲突模型 [中]

**描述**: ROADMAP.md Phase 5 写 "Cross-machine sync protocol (explicit export/import)" 和 "Multi-host concurrency coordination", 但没有定义冲突解决语义. Compost 的 fact_id 是 `sha256(adapter + source_id + content)`, 两台机器独立观测同一 URL 会产生相同 fact_id. 但如果 fact 被 tombstone 的状态不同 (机器 A 归档, 机器 B 未归档), import 时覆盖谁?

**触发条件**: 用户在家用机和公司机各自运行 Compost 观测同一篇文档, 公司机 reflect 后 tombstone 了某 fact, 家用机导出 bundle 后 import 到公司机, 该 fact 复活.

**影响**: 矛盾仲裁结果被 import 覆盖, correction_events / decision_audit 链断裂.

**最小修复**: Phase 5 设计文档必须在动手前定义: (1) import 是幂等追加还是覆盖? (2) archived_at/superseded_by 的 "last-writer-wins" 还是 "local-wins"? 不需要代码, 只需要决策文档.

**Phase**: Phase 5 设计阶段 (现在就应该写下来, 避免到时重新辩论).

---

### B5. 无性能基线, 增长曲线未知 [中]

**描述**: 路线图没有任何关于 SQLite 规模边界的讨论. `reflect.ts` 的语义 tombstone 步骤在 Step 2 做 `SELECT * FROM facts WHERE archived_at IS NULL AND importance_pinned = FALSE` — 全表扫描, 在 TS 层计算 decay. 没有测量过 10K / 100K facts 时耗时.

**触发条件**: 用户持续使用 6 个月, facts 表达到 50K 行. 每次 6 小时 reflect 触发全量扫描, 同时 ingest worker 在运行, WAL 竞争导致 daemon 卡顿.

**影响**: Phase 6 引入 PDF / 代码仓库 / 视频转录, 单次 ingest 可轻松产生数千 facts. 届时没有基线, 无法判断是否需要重构.

**最小修复**: Phase 4 P1 阶段加一个 `compost bench` 子命令, 生成 N=1K/10K/100K 合成 facts 并测量 reflect / query / ask 耗时. 不需要优化, 只需要数据.

**Phase**: Phase 4 P1.

---

## 2. P0 顺序与依赖图

### 建议实施顺序

```
[fact_links 表] ──────────────────────────────────────────────────────────┐
                                                                           ▼
[P0-4 archive_reason] → [P0-2 decision_audit] → [P0-1 health_signals] → [P0-3 graph_health]
                                   ▲
                        [P0-5 correction_events]
```

具体顺序 (单 migration 0010 已 commit, 以下是 TS 实现顺序):

1. **P0-4 先实现** (`reflect.ts` 扩展): archive_reason 是 P0-2 decision_audit 的 rationale 来源. tombstone 时同步写 audit row, 必须 P0-4 先有字段.
2. **P0-5 并行** (`hook-shim` 扩展): 与其他 P0 无依赖, 独立实现 correction_events 捕获.
3. **P0-2 次之** (`audit.ts` 新模块): 依赖 P0-4 的 archive_reason 枚举语义已稳定.
4. **fact_links 表** (Phase 3 carried, 但 P0-3 的真实前置条件): 必须在 P0-3 TS 实现前落地.
5. **P0-3 最后** (`graph-health.ts`): 依赖 fact_links. 当前 v_graph_health stub 已在 DB, TS 层推迟实现完全没问题.
6. **P0-1 在 P0-2 / P0-4 之后**: triage 信号生成逻辑需要读 decision_audit 和 archive_reason 来判断严重度.

### 特别裁决: P0-3 是否应先做 fact_links?

**是的, fact_links 必须先于 P0-3 TS 实现落地.**

理由: `graph_health_snapshot` 的 `orphan_facts / density / cluster_count` 三列在 fact_links 不存在时无法填充真实值. 当前 0010 migration 的 stub view 返回 NULL, 这对 schema 是安全的, 但 P0-3 的 TS 实现如果在 fact_links 前写入 snapshot, 将产生全零/NULL 快照, 污染历史数据. 建议: fact_links 表 migration (0011) 先 merge, P0-3 TS 实现与 fact_links 功能捆绑同一 PR, 不单独发 P0-3.

---

## 3. 应该砍掉/降级的

### 3.1 `four-layer self-model dashboard` (P1 → P2 或 Reject)

**当前 tier**: P1 (Batch D P1 列表)
**建议 tier**: P2

**理由**: ROADMAP.md 说 "A 库存 + C 退化 only", 意味着只做 A 层 (facts 计数) 和 C 层 (decay 曲线). 这两个数据 `compost stats` 和 `compost triage` 已经覆盖. 单独做一个 "four-layer dashboard" 的 SQL view 在 P0-3 (graph_health) 和 P0-1 (triage) 落地之前价值为零, 因为它依赖 graph_health 数据. P1 做它等于在依赖未就绪时堆砌 CLI 命令.

**替代**: `compost triage` 输出已是 health dashboard 的实质. 待 Phase 5 有多机数据后, dashboard 的 B 层 (provenance) 和 D 层 (ecosystem) 才有意义, 届时升回 P1.

### 3.2 `semantic chunking / Savitzky-Golay` (P1 carried → Reject)

**当前 tier**: Phase 4 P1 carried from Phase 3
**建议 tier**: Reject (现阶段)

**理由**: Debate 9 四方一致同意 "heading-based adequate for markdown". Phase 3 deferred 的理由是 "evaluate on real corpus". 但 Phase 4 没有规划任何 corpus 评估基础设施 (无 A/B ranking 对比, 无 precision/recall 测量工具). 在无评估框架的情况下实现 Savitzky-Golay 是盲目优化.

**替代**: 先做 B5 建议的 `compost bench`, 建立 chunk quality 指标 (如 average fact count per chunk, retrieval hit rate per chunk type). 有数据后若 heading-based 明显不足再引入. 不做承诺的 "P1 carried" 比 Reject 更危险 — 它占据 Phase 4 的心智带宽.

---

## 4. 应该新增的

### 4.1 SQLite 文件备份机制

**路线图现状**: 完全没提. `compost doctor` 存在但只做诊断.

**具体需求**: SQLite WAL 模式下, 用户直接 `cp ~/.compost/db.sqlite` 可能得到不一致快照. 正确备份需要 `VACUUM INTO` 或 `sqlite3_backup_init` API.

**最小实现**: `compost backup [--out <path>]` 命令, 底层调用 `VACUUM INTO ?`, 原子生成一致性快照. 加入 daemon scheduler 每日自动备份到 `~/.compost/backups/db-YYYYMMDD.sqlite`, 保留最近 7 份. 涉及文件: `compost-daemon/src/scheduler.ts` + `compost-cli` 新子命令.

**Phase**: Phase 4 P1 (与 P0 同批次发布前完成, 否则 P0 的 migration 数据无法保护).

### 4.2 embedding 模型版本锁定与升级路径

**路线图现状**: 完全没提. 当前硬编码 `nomic-embed-text-v1.5, 768d` (ARCHITECTURE.md).

**具体需求**: LanceDB 的向量索引与 embedding 维度 / 模型绑定. 如果用户 `ollama pull nomic-embed-text-v2` (假设 1024d), 新 chunks 产生 1024d 向量, 旧 chunks 是 768d, 混入同一 LanceDB collection 后 ANN 搜索结果全部错误 (维度不匹配或相似度计算失效).

**触发条件**: Ollama 默认模型更新, 用户 `ollama pull nomic-embed-text` 拉到新版本, 重启 daemon 后 ingest 失败或检索质量静默下降 (无错误, 只是召回率崩溃).

**最小实现**: `source` 或新表 `embedding_config` 记录 `model_name TEXT, dim INTEGER, indexed_at TEXT`. Daemon 启动时校验当前 `EmbeddingService` 的 dim 与记录是否一致; 不一致时拒绝启动并提示 `compost doctor --rebuild L1`.

**Phase**: Phase 4 P1 (Phase 6 引入更多 source types 前必须解决, 不然届时重建成本极高).

---

## 5. 独特视角 (Sonnet / KISS / 务实工程)

Phase 4-6 最大的长期风险不是技术选型, 而是**测试覆盖的选择性盲区**. 当前 156 tests 通过, 但 reflect.ts 的语义 tombstone 和矛盾仲裁是纯 SQL + TS 逻辑, 没有针对 10K+ facts 的压力测试, 也没有回归测试验证 "正确的 fact 不被错误 tombstone". Phase 4 的 5 个 P0 都在写 cognitive 层 (triage / decision_audit / graph_health / correction), 每一个都在修改或读取 facts 表的核心字段. 12 个月后这个系统会有复杂的认知循环: triage 触发 correction 信号, correction 降低 confidence, confidence 影响 tombstone, tombstone 触发 archive_reason 写入 decision_audit. 这个循环的 regression 极难手动发现. **建议 Phase 4 P1 建立 cognitive loop 的 golden-set 测试**: 固定 seed facts + 固定 reflect 序列, 断言最终存活 facts 集合不变. 否则 Phase 6 生态扩展时每次引入新 source type, 开发者无法判断是 ingest 问题还是 cognitive 循环的回归.
