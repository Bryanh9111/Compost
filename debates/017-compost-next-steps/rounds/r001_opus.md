# 🐙 Claude (Opus) - Round 1 (10 年维护视角)

## 6 判决点

### 1. 基线: "稳+开源" vs "深+Phase 4 功能"
**立场: 稳+开源**. Phase 4 功能边际价值递减 — Compost 已能 observe/query/ask/reflect. episodic/procedural 是博物馆式 feature 堆砌, 没现成消费者. 开源带来 dogfood 数据是 10 年生命力的燃料. **但"开源"≠今天 publish**, 而是把工作流稳固到**可以分享**的状态.  
**风险**: 过早 publish 被 issue 绑架时间. 缓解: "可分享不等于已分享".

### 2. PII redactor 真开源门槛?
**立场: 是门槛但不是最紧**. 更关键的是:
- `examples/` 目录 (用户第一次装能跑 end-to-end)
- **bench 数据作为论点证据** (README 宣称 "hook p95 < 30ms" 需要真实复现能力)
- LICENSE ✅ 已有 (MIT)

PII redactor 做粗了给假安全感 (regex 漏真 CC 号), 做深了 ML 依赖爆炸. 它是 release blocker, **不是 dev blocker**.

### 3. Phase 4 P1 内部排序
**立场: bench > PII > open_problems > origin_hash** (调整用户推荐)
- **bench** 是**测量工具** — 10 年维护里最贵的工具是"上次比这次快还是慢". 没 bench 的改动都是信仰行为.
- **PII** 次之 (release 前必过)
- **open_problems** 无现成消费者 (建库前需要有人要查)
- **origin_hash** 数据建模, 目前没消费者

**风险**: bench harness SQLite WAL + LanceDB ANN + LLM latency 混测噪声大. 缓解: 分层 bench, 每层独立基准.

### 4. episodic/memory_procedural 现在解?
**立场: 不解, YAGNI**. Phase 3 已经 defer, 没理由倒车. 挂着分歧等 3-6 月 dogfood 数据触发. `session_turns FTS5` 需要先证明"用户真从这查到价值", `memory_procedural` 更投机.  
**风险**: 僵尸 backlog. 缓解: 每 6 月 review 一次, 无新证据就 delete.

### 5. Compost 为 v3.5 预先做 cache-provider API?
**立场: REJECT 方案 E**. Engram miss log 是驱动信号, 现在做是**在需求出现前下注**, 违反 debate 016 "3-6 月数据驱动"共识. 若真要做 — Engram 侧先定契约 (尤其 source_hash 算法), Compost 只做 adapter.  
**风险**: 协议被 Engram workaround 私有化. 缓解: 把 compost_cache DDL 契约写进 debate 016 synthesis 作 canonical ref.

### 6. Compost 脏数据 audit?
**立场: 做**. 不是因为 known bad data, 是**没人知道是否有**. dogfood 几月后可能有:
- orphan observations (outbox drain 失败未重试)
- stale wiki_pages (archived_at 设但 siblings 未更新)
- tombstoned facts 被 revival_at 重新激活的孤儿
- 未被任何 derivation_run 消费的 chunks
- transform_policy 旧版本引用但 registry 已滚版

一次 `compost doctor --audit-all` 揭示很多. **风险**: 可能发现 migration 债, 时间不可控. 缓解: audit 只报告不修, 修复另起 session.

---

## Opus 3-session 执行清单

### Session 1: Bench harness + audit (最高 ROI, 10 年工具)
**LoC**: ~250 (bench fixtures ~100, bench runner ~80, CI integration ~30, audit stubs ~40)
- `bench/reflect-{1k,10k,100k}.bench.ts` — fixture generator + runner
- `bench/query-hybrid.bench.ts` — BM25+ANN+RRF 分层测量
- baseline 数据填入 README (替换"p95 < 30ms on Apple Silicon"为可复现数字)
- `compost doctor --audit-all` stub (只报告, 不修)
- CI >50% 回归 fail rule (GitHub Actions)

### Session 2: PII redactor + audit 修复
**LoC**: ~200 (PII regex + test ~80, audit 修复 ~60, migration 回溯 ~60)
- `packages/compost-hook-shim/src/pii.ts` — regex blocklist (CC / SSH / API-token / .env / password:)
- 配置为**可选** (env `COMPOST_PII_STRICT=true`), 防粗糙 regex 漏误伤
- audit Session 1 发现的脏数据: 分类 (auto-fixable / needs-user-decision)
- 写 migration 0014 (如果需要) 处理 orphan / stale

### Session 3: examples/ + docs 稳固
**LoC**: ~150 (examples ~80, docs ~70)
- `examples/01-local-markdown-ingest/` (add, query, ask)
- `examples/02-web-url-ingest/` (ETag/Last-Modified 演示)
- `examples/03-mcp-integration/` (Claude Code hook 配置)
- README 填入 Session 1 bench 数据
- `docs/dogfood-notes.md` — 真实用户使用体验记录 (open_problems 的前身)

### 明确不做 (Session 4+ 再评估)
- ❌ episodic memory (session_turns FTS5) — YAGNI
- ❌ memory_procedural — YAGNI + Gemini/Opus 分歧未解
- ❌ open_problems 表 — 无消费者, 用 `docs/dogfood-notes.md` 代替
- ❌ observations.origin_hash — 无消费者
- ❌ v3.5 cache-provider API — 等 Engram miss log 数据
- ❌ Phase 5 export/import — 等单机器稳定
- ❌ Phase 6 adapter/多模态 — 非必要

## 总结立场
**反对方案 C (全推 P1)**, **反对方案 E (cache 预做)**, **反对方案 D (现在 debate 分歧)**.  
**采纳方案 B 的骨架, 但把 bench 提到 PII 前面**, 并加入 dogfood audit.  
Compost 现在需要的不是"更多功能", 而是**"同样功能的更多证据和更少风险"**. 3 个 session 后 Compost 进入"可分享但不必分享"的成熟态, 之后的方向让 Engram miss log 数据来决定.
