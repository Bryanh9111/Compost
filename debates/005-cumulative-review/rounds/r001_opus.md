# R1 — 🐙 Opus (Cumulative Architecture Review)

`git diff --stat main..HEAD`: 67 files, +6920 / −31. 我运行 grep 确认: **src/ 没有任何文件 import 新的 cognitive 模块** (audit / triage / graph-health / correction-detector / fact-links). 所有这些模块是孤岛, 只被自己的测试引用. 这改变了 debate 004 一些担忧的优先级 — stub throw 不会在 runtime 爆, 但文档-现实鸿沟比我想的更大.

---

## 1. Top 5 累积问题 (按严重度)

### Issue 1 (HIGH): fact_links 是空表, reflect 没写, 没人写
- **文件**: `reflect.ts:168-220` (contradiction resolution); `fact-links.ts` 全文 (API)
- **问题**: 0011 migration 创建了 `fact_links` 表, 1370ba6 landed TS API. 但 grep 整个 src/ 发现**没有任何调用路径写入 fact_links**. reflect.ts 的 contradiction step 自然是最合适的 caller (loser→winner 是 `contradicts` 边), 但 a4efbe2 只写 superseded_by + replaced_by_fact_id, 没调 `addLink`.
- **为什么 debate 004 漏**: debate 004 per-commit 视角看到的是 "1370ba6 landed API" 和 "a4efbe2 改了 reflect" — 两个 commit 彼此看似独立. 跨 commit 视角才发现: 其中一个是生产者但没生产, 另一个是应用场景但没调.
- **影响**: Week 2 P0-3 graph_health 会基于**永远为空的 fact_links** 计算信号. `v_graph_health` 返回 density=0, orphan_count=所有 active facts. Triage 的 orphan_delta 信号会全触发, 产生噪音洪水.
- **修复**: `reflect.ts:210-218` 在 supStmt.run 后加一行:
  ```ts
  addLink(db, loserId, cluster.winner, "contradicts", { weight: 1.0 });
  ```
  需 import `addLink` from `../cognitive/fact-links`. 加 1 个测试: reflect 跑完后 `fact_links WHERE kind='contradicts'` 有行.
- **影响估计**: 如果不做, Week 2 P0-3 一 land 就被假数据淹没, 可能触发"Week 2 返工".

### Issue 2 (HIGH): ARCHITECTURE.md Pre-P0 contracts 与实际代码严重漂移
- **文件**: `docs/ARCHITECTURE.md` (尾部 contracts 段) vs `audit.ts:42` + `reflect.ts` 全体
- **问题**: ARCHITECTURE 写 "decision_audit always on. Every high-cost decision writes one row." 但 `audit.ts:42 recordDecision` throws. reflect.ts 的 tombstone step 2 和 contradiction step 3 **不 import audit, 不写 decision_audit**. 实际 decision_audit 表从 0010 创建起就是空的, 永远不会有行, 直到 P0-2 (Week 3).
- **为什么 debate 004 漏**: per-commit 视角看到 efe6cbe 写了 contract, 看到 a83287b 创建了 stub, 但没人把"contract 说 always on" 和 "stub 不工作"连起来.
- **影响**: 未来开发者读 ARCHITECTURE 以为系统有 audit trail, 实际没有. 建立错误的心智模型. 在生产环境 (未来 dogfood) 用户信任 "每个决策都有记录" 但实际丢了.
- **修复**: 两选一:
  - (a) `reflect.ts:120-127 + :200-218` 加 audit 写入 (即使是 fake rationale, 占位), 让 contract 立即成立. 成本 S (30 分钟).
  - (b) 改 ARCHITECTURE.md: "decision_audit is reserved for future P0-2 (Week 3). Pre-P0-2 writes happen via P0-4 column mutations on facts directly." 诚实但降低了"contracts as invariants"的力度.

### Issue 3 (MEDIUM): triage 返回空 report 但对外接口已稳定
- **文件**: `triage.ts:41-55` (triage 函数签名 + 空返回); `triage.test.ts:20-35` 测试期望空 report
- **问题**: triage stub 返回 `{ signals: [], byKind: all-zeros, unresolvedTotal: 0 }`. 这个接口形状被测试锁定. Week 4 实施 P0-1 时改接口形状 (比如加 `source` / `severity_counts` 字段) 会破坏现有测试.
- **为什么 debate 004 漏**: debate 004 看 stub 接受度, 没审视"未来实施会不会被 stub 锁死".
- **影响**: Week 4 P0-1 可能需要同时改 triage.ts + triage.test.ts. 不是 blocker, 但是技术债.
- **修复**: 在 `triage.ts` 加 TODO:
  ```ts
  // TODO(P0-1 Week 4): The current shape is a placeholder. Expect to add
  // `severity_counts: Record<SignalSeverity, number>` and possibly a
  // `source: { fact_ids: string[], wiki_pages: string[] }` hash.
  ```
  并在 triage.test.ts:35 附近标注: "shape-frozen tests are stub, re-bake at P0-1".

### Issue 4 (MEDIUM): Migration 历史的 0010→0011→0012 修修补补
- **文件**: `schema/0010_phase4_myco_integration.sql`, `schema/0011_fact_links_and_health_fix.sql`, `schema/0012_correction_signal_kind.sql`
- **问题**: 0010 创建 `graph_health_snapshot` 用 NOT NULL 无 DEFAULT (bug), 然后 0011 DROP + recreate 修. 0010 创建 `health_signals` CHECK 缺 `correction_candidate` (bug), 然后 0012 DROP + recreate 修. 新 clone 的人 apply 12 个 migrations 时一切正常, 但读 schema 历史的人会迷惑.
- **为什么 debate 004 漏**: 004 看的是"正确性" 不是"可读性".
- **影响**: 纯美学 + 新贡献者上手成本. 不影响运行. 如果这是公开 repo, 未来 `git blame` 看 migrations 会让人疑惑.
- **修复**: 3 选 1:
  - (a) 在 0010 开头加注释 "known bugs, fixed in 0011 + 0012, do not edit"
  - (b) 考虑在 merge main 前 squash 0010+0011+0012 为一个 "0010_phase4_complete". **反对**: 丢失审计轨迹 (debate 审出的 bug 在 git log 里的可见性).
  - (c) 什么都不做, 接受 "debate-driven schema 迭代是 feature 不是 bug" 的立场. 选这个最诚实.

### Issue 5 (MEDIUM): Python 端 LLM 失败没有 TS 可见路径
- **文件**: `docs/ARCHITECTURE.md` "LLM call sites" 段 + `compost-ingest/compost_ingest/extractors/llm_facts.py` (out of tree)
- **问题**: ARCHITECTURE 把 Python LLM 失败的处置写为 "(existing Python retry; surface `stuck_outbox` if queue grows)". 但 triage 的 stuck_outbox 信号生成**在 P0-1 才实施**. 目前 Python ollama 挂 → ingest worker 重试 → stall → triage 空返回 → 用户无任何信号.
- **为什么 debate 004 漏**: 004 把 Python 显式标 "out of scope for P0-6 TS wrapper" 就放过了, 没问"那用户怎么知道出问题".
- **影响**: 真实 dogfood 时用户 ollama 挂一天后 compost add 全失败, 没任何提示. 需要手动 `compost doctor` 才看得到.
- **修复**: 在 P0-1 (Week 4) triage 实施时, stuck_outbox 信号源必须覆盖 "ingest_queue has lease_expired_at > 1h 的行". 现在只需在 ARCHITECTURE.md 明确标: "until P0-1 lands, Python LLM failures are visible only via `compost doctor`".

---

## 2. 代码复用 / 重构建议

### Refactor 1: fact-links.ts 的 `getNeighbors` 可以 inline
- `fact-links.ts:135-146` `getNeighbors` 只是 `getLinks` + 去重. 8 个导出里它最薄. 
- **建议**: 保留 (idiomatic graph API, 未来 P0-3 会多处调用). 但在 fact-links.ts 文件头加 "API inventory" 注释列出 8 个函数分类 (query / mutate / graph-analysis), 防止未来加第 9 个时无组织.

### Refactor 2: backup.test.ts 中手动 require('fs') 13 处
- `backup.test.ts:88, 95, 104, 110, 115, 180, 189, 198...` 都用 `require("fs").writeFileSync / copyFileSync / readdirSync / truncateSync`. Bun test + ESM 本来可以 `import { ... } from "fs"`. 这是我写测试时偷懒.
- **建议**: 统一 top-level `import { writeFileSync, copyFileSync, readdirSync, truncateSync } from "fs"`. 10 分钟清理.

### Refactor 3: backup.ts + scheduler 的 BACKUP_TIME_WINDOW_HOUR_UTC 常量散在两处
- `backup.ts` 没有, `scheduler.ts:401` 定义. 但 `backup.ts` 的文件命名 `YYYY-MM-DD.db` 用的是 UTC date — 隐式同步了时区假设. 未来有人把 scheduler 改到 04:00 UTC, backup 文件命名仍是 UTC date, 不会冲突. 但该把常量集中.
- **建议**: 把 `BACKUP_TIME_WINDOW_HOUR_UTC = 3` 移到 `backup.ts`, scheduler import. 单一真相源.

---

## 3. 文档与代码漂移

### Drift 1: ARCHITECTURE.md "facts.archive_reason enum (frozen)" 6 值 vs 实际 2
- docs 列: stale / superseded / contradicted / duplicate / low_access / manual
- reflect.ts 实际只写: stale (step 2) + contradicted (step 3)
- 其他 4 个目前没代码路径写入 (superseded 可能本就是 contradicted 的别名, duplicate 等 P1 compression 3-criteria, manual 等 `compost forget` CLI 未存在)
- **修复**: ARCHITECTURE.md 那个表格加一列 "Implementation status":
  ```
  stale | ... | ✅ reflect.ts step 2
  contradicted | ... | ✅ reflect.ts step 3
  superseded | ... | ⏳ reserved (may fold into contradicted)
  duplicate | ... | ⏳ P1 compression 3-criteria
  low_access | ... | ⏳ P1 compression 3-criteria
  manual | ... | ⏳ future `compost forget` CLI
  ```

---

## 4. Week 2 前必修 (≤ 3)

1. **Issue 1**: reflect.ts 加 `addLink(loser, winner, 'contradicts')`. **30 分钟. 直接阻断 P0-3**.
2. **Issue 2 (选 option b)**: ARCHITECTURE.md 把 "decision_audit always on" 改诚实为 "reserved for P0-2 (Week 3)". **5 分钟**.
3. **Drift 1**: ARCHITECTURE.md archive_reason 表加 implementation status 列. **5 分钟**.

**≤ 1 小时, 不阻 P0-3/P0-5 启动**.

---

## 5. 允许推迟

1. **Issue 3**: triage stub shape 锁定担忧 → 加 TODO 注释就够, 不必立即改
2. **Issue 4**: migration 历史美学 → 接受 "debate-driven 迭代" 立场, 不动
3. **Refactor 2**: backup.test.ts 的 `require('fs')` 清理 → 后台 cleanup
4. **Refactor 3**: 常量集中 → 同样 backlog
5. **Issue 5 的完整修**: Python LLM 失败信号 → P0-1 Week 4 实施时顺便做

---

## 6. 一句话总评

**跨 commit 审暴露 2 个 contract-reality 漂移** (fact_links 永空 / decision_audit 永空), 但无功能性 runtime bug. 补 1 行 addLink + 2 处文档诚实化即可进 Week 2.
