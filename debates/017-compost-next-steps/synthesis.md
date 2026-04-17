# Final Synthesis: Compost 下一步执行计划

**Debate ID**: 017-compost-next-steps
**Participants**: 🟡 Gemini, 🔴 Codex, 🟠 Sonnet, 🐙 Opus
**Date**: 2026-04-16
**Mode**: 1 round thorough cross-critique

---

## 四方立场对照

| 判决点 | 🟡 Gemini | 🔴 Codex | 🟠 Sonnet | 🐙 Opus | 共识 |
|---|---|---|---|---|---|
| 1. 基线 | 稳+品牌叙事 | 稳+开源 | 稳+最小开源集 | 稳+开源 | **4/4 稳+开源** |
| 2. PII 是门槛 | 是 (Hard Gate) | 是 | 是 (最硬) | 是但非最紧 | **4/4 是** |
| 3. P1 排序 | Bench > PII > origin_hash > open_problems | PII > bench > origin_hash > open_problems | PII > bench > origin_hash > open_problems | bench > PII > open_problems > origin_hash | **3/4 PII > bench > origin_hash > open_problems** |
| 4. D (debate 分歧) | YAGNI | 不解 | YAGNI | 不解 | **4/4 不解** |
| 5. E (cache API) | 不提前做 | 不做 | 不做 | REJECT | **4/4 REJECT** |
| 6. Audit | 必须 | 做但限一轮 | 做 (doctor 扩展) | 做 (只报告不修) | **4/4 做** |

**共识率: 5/6 判决点 4/4, 1/6 是 3/4 (Opus 小众反对)**

---

## 关键洞察 (按价值排序)

### 1. Codex: source_hash 归属权 [价值: 高, 独家]
方案 E (预先做 cache-provider API) REJECT 的真正理由: **`source_hash` 应由 Engram 定义, Compost 只存 opaque 值**. 跨栈契约的 hash 算法必须由消费者 (Engram) 定, 否则将来 Engram 换 hash 方案时 Compost 端全部存的 hash 都失效. 这修正了 debate 016 synthesis 里含糊的 "幂等键 (query, source_hash, policy_ver)" — 归属权没写清楚。

### 2. Sonnet: PII 真实 LoC 215, 不是 30-50 [价值: 高]
分解:
- regex blocklist + scrub() 函数: 60 LoC
- hook-shim 集成 (scrub before INSERT): 15 LoC
- unit tests (CC/SSH/envvar/apikey/password + 边界 + unicode bypass): 80 LoC
- `compost doctor --check-pii` 扫描 existing `observe_outbox.payload`: 40 LoC
- 文档 + CHANGELOG: 20 LoC

**启示**: 3 session 里 S1 不能只做 PII, 得配合 audit 一起.

### 3. Sonnet: envelope JSON 进 outbox 是硬洞 [价值: 高]
`packages/compost-hook-shim/src/index.ts:108` `JSON.stringify(envelope)` 直接把整个 envelope 存入 `observe_outbox.payload`. Claude Code hook payload 含 tool_input, 任意字符串都可能穿透. 当前唯一防线是"用户知道不要 compost add password"—不够.

### 4. Codex: bench 分层避免噪声 [价值: 高]
SQLite WAL + LanceDB ANN + LLM latency 混测噪声大. **分 3 层 bench 独立基准**:
- `bench/sqlite-{reflect,drain,query}.bench.ts` (WAL/checkpoint 独立)
- `bench/lancedb-ann.bench.ts` (embedding + ANN 独立)
- `bench/llm-latency.bench.ts` (Ollama roundtrip 独立)

这修正 Opus 的"分层 bench"提议, 给出具体切分方案。

### 5. Codex + Sonnet 同时指出: open_problems 重叠风险 [价值: 中]
`open_problems` 表和现有 `health_signals` (triage) + `correction_events` 语义高度重叠:
- health_signals 记录"需要人工注意的异常"
- correction_events 记录"用户纠正过的事实"
- open_problems 要记录"已知不知道的事"

三者都是"待处理条目". **先做 `docs/dogfood-notes.md` 手写观察**, 不急着建表 — 等 session_turns 数据证明"这类条目确实无处归"。

### 6. Codex: origin_hash 迁移陷阱 [价值: 中]
加列 **先 nullable + backfill, 别直接 NOT NULL + 假默认**. 否则:
- `NOT NULL` 强制会让 migration 失败 (现有 observations 行都没 hash)
- 假默认 (如 `DEFAULT 'legacy'`) 污染分析 — 无法区分"真没记录"vs"老数据"

### 7. Gemini: 开源信号 [价值: 中]
- 最说服力 artifact: **README bench 曲线图 + 3 分钟 demo 视频** (不是论文)
- 参考: Letta/MemGPT 开源时的 privacy 前置步骤 = PII redactor
- Good First Issues 来源 = open_problems CLI 透明化 (Gemini 独家视角, 但要跟 Codex 的重叠风险权衡)

### 8. Opus: bench 是 10 年工具, 不是功能 [价值: 中]
bench 是**测量工具**, 没 bench 的改动都是信仰行为. 这说明 S2 做 bench 不能做完就走, 要作为 CI 规则永久保留 (>50% 回归 fail)。

---

## 合成执行清单 (4 方综合, 4 session)

### Session 1: PII redactor + audit 扫描 (~275 LoC)
**来源**: Codex (S1 PII+audit) + Sonnet (S1 PII) + Gemini (S1 PII + bench 1.0)

**内容**:
- `packages/compost-hook-shim/src/pii.ts` scrub() 函数, regex blocklist (CC/SSH/API-token/.env/"password:")
- `packages/compost-hook-shim/src/index.ts:108` 集成 scrub before `JSON.stringify(envelope)`
- unit tests 覆盖 6 类 pattern + 边界 + unicode bypass (~80 LoC)
- `compost doctor --check-pii` 扫描 existing `observe_outbox.payload` (~40 LoC)
- `compost doctor --check-integrity` 一次性 audit (~60 LoC): orphan observations / dangling fact_links / stale wiki_pages / transform_policy 遗留
- 审计只**报告**不修, 发现结果写 `docs/dogfood-notes.md` 备注 Session 3+ 决策
- 配置 `COMPOST_PII_STRICT=true` env (用户可关, 防粗糙 regex 漏误伤)

**验证**:
- hook-shim tests + doctor tests 全绿, coverage ≥ 90%
- 手测: `echo "my CC is 4532015112830366" | compost add -` 应被拒绝或 redact

### Session 2: 分层 bench harness (~250 LoC)
**来源**: Codex (分层避免噪声) + Opus (10 年工具) + Sonnet (120 LoC 估算)

**内容**:
- `bench/sqlite-reflect.bench.ts` (reflect-1k/10k/100k fixture)
- `bench/sqlite-query.bench.ts` (BM25 FTS5 独立)
- `bench/lancedb-ann.bench.ts` (embedding + ANN 独立)
- `bench/llm-latency.bench.ts` (Ollama roundtrip + circuit-breaker)
- CI 集成: `.github/workflows/bench.yml` — >50% 回归 fail
- README 替换"p95 < 30ms on Apple Silicon"为 **真实可复现数字** (每层独立)
- 顺便跑一次 DB integrity scan, 记录 orphan 数量 baseline

**关键**: bench fixture **PII-safe** (用 Faker 生成的 fake data, 不能触发 Session 1 的 regex)

### Session 3: origin_hash 迁移 + examples/ (~200 LoC)
**来源**: Codex (nullable + backfill) + Sonnet (origin_hash 是 provenance 前置) + Opus (examples 开源门槛)

**内容**:
- Migration 0014: `ALTER TABLE observations ADD COLUMN origin_hash TEXT` (nullable, 无默认)
- Migration 0014: `ALTER TABLE observations ADD COLUMN method TEXT`
- Pipeline 写入路径打 hash (`packages/compost-core/src/pipeline/ingest.ts`)
- Backfill script: 为旧 observations 计算 hash (可选 --dry-run)
- 用 Session 2 bench 验证 hash 无性能回归 (>5% 则 reject)
- `examples/01-local-markdown-ingest/` (add, query, ask end-to-end)
- `examples/02-web-url-ingest/` (ETag/Last-Modified 演示)
- `examples/03-mcp-integration/` (Claude Code hook 配置样板)

### Session 4+ (defer, 证据驱动)
- `open_problems` 表: **不急**, 先看 `docs/dogfood-notes.md` 积累 3 个月, 判断是否真无处归 (避免和 health_signals/correction_events 重叠)
- v3.5 cache-provider API: 等 Engram miss log 数据
- episodic memory / memory_procedural: YAGNI defer
- Phase 5/6: 等单机稳定
- 3 分钟 demo 视频 (Gemini 信号 artifact): Session 3 完成后再做

---

## 四方共识决议

### 4/4 共识 (直接采纳)
1. 基线 = 稳+开源
2. PII 是开源门槛
3. D (episodic/procedural) YAGNI 不解
4. E (cache-provider API) REJECT — source_hash 归 Engram
5. Audit 要做 (一次性, 报告式)

### 3/4 共识 (采纳多数)
- P1 排序: **PII > bench > origin_hash > open_problems** (Opus 少数反对 bench 在前)
  - 折中: S1 做 PII + audit, S2 做分层 bench, 实际是**并轨而非分先后**

### 未共识 (延后)
- open_problems 表是否真要建? (Opus/Codex 质疑重叠, Gemini/Sonnet 支持)
  - **暂不做, 用 docs/dogfood-notes.md 代替, 3 月后 re-evaluate**

---

## Cost & Quality

| Advisor | Output | Quality | 特色 |
|---|---|---|---|
| 🟡 Gemini | ~370 字 | 85 (生态叙事强, 缺 LoC 细节) | 开源信号: bench 曲线图+demo 视频 |
| 🔴 Codex (retry) | ~370 字 | 88 (迁移细节 + source_hash 归属) | **source_hash 归 Engram** 独家 |
| 🟠 Sonnet | ~490 字 | 95 (真实 LoC + 隐藏依赖链 + envelope 硬洞 index.ts:108) | 实现可行性最具体 |
| 🐙 Opus | ~500 字 | 88 (10 年维护视角 + 反 C/D/E) | bench 是工具不是功能 |

共识率: **5/6 4/4 共识, 1/6 3/4 共识** — 高度收敛, 方案成熟可执行。

---

## 最终结论

**Compost 下一步 = 方案 B 扩展版**: PII redactor 不是一个孤立 task, 要带 audit (Codex) + 分层 bench (Codex) + origin_hash (Sonnet provenance 前置). 3 session 就能把 Compost 推到"可分享但不必分享"的成熟态.

**明确砍掉**: episodic memory / memory_procedural / cache-provider API / open_problems 表 / Phase 5-6 — 等数据或需求真实出现再动.

**最重要的副产品**: 本次 debate 揭示了 `source_hash` 归属权问题, 需要反馈到 Engram session (告诉他们 source_hash 算法由 Engram 定义, Compost 只存 opaque 值).
