# Debate 002 — Synthesis: Phase 4-6 Roadmap Gap Audit

> 🐙 Opus 主持终裁 · 2026-04-14
> Participants: 🔴 Codex / 🟡 Gemini / 🟠 Sonnet / 🐙 Opus
> Rounds: R1 independent + R2 cross-critique
> Scope: 反向审计 ROADMAP.md (Batch D 后) 是否有盲点 / 假设错位 / 隐性依赖

---

## TL;DR

**当前 ROADMAP (post-Batch D, 17 项) 有 3 个结构性 bug, 4 个真盲点, 3 个 cargo cult.** 修正后 Phase 4 应是 **8 P0 + 4 P1 + 4 P2 (16 项)**, 比原来更聚焦. Phase 5 精确切割 (保留 portability, 砍 multi-host concurrency). Phase 6 砍 PDF/video, 留 multimodal metadata 接口.

---

## 三个结构性 Bug (必须修, 4/4 共识)

### Bug 1: P0-3 graph_health 是假交付
- **表现**: migration 0010 创建 `v_graph_health` view, body 全 NULL; `graph_health.ts` 三个函数 throw 或 return null
- **根因**: 依赖 `fact_links` 表, 但 fact_links 在 ROADMAP 是 carried 项 (无 tier), 不在任何 P0 里
- **修正**: **fact_links 提到 `P0-0` (prerequisite)**, P0-3 TS 实现与 fact_links 同 PR

### Bug 2: graph_health_snapshot 的 NOT NULL 约束 + view stub NULL 不兼容 (Sonnet B3 发现)
- **表现**: `graph_health_snapshot.orphan_facts / density / cluster_count` 是 `NOT NULL`, 但 `v_graph_health` 当前返回 NULL. INSERT 会爆 constraint
- **根因**: 我 (Opus) 写 migration 0010 时没考虑 stub 写入路径
- **修正**: migration 0011 (与 fact_links 同) ALTER 这三列加 `DEFAULT 0`, 或改为 NULLABLE

### Bug 3: 数据丢失 = 信任崩塌 (4/4 共识 backup 缺失)
- **表现**: ledger.db 在 ~/.compost/, 无任何自动备份, 无 restore CLI
- **触发**: 用户 6 个月后 SSD 故障 / WAL 损坏 / 误删 → 第二大脑全没
- **修正**: P0-7 加 `compost backup` (SQLite VACUUM INTO 每 24h, 保留 30 份) + `compost restore <date>` CLI

---

## 四个真盲点 (3+/4 共识)

### Gap 1: LLM 单点故障无降级 (3/4)
- **谁说了**: Sonnet B2 / Gemini 1.3 / Opus 盲点 5 (Codex 隐含)
- **场景**: Ollama 离线 → ingest worker 死循环 / ask 抛异常 / wiki rebuild 失败
- **修正**: P0-6 — LLM 调用加 timeout + fallback (返回 BM25 拼接 + `[LLM unavailable]` 标注), Circuit Breaker, IExtractorClient 接口抽象

### Gap 2: 性能基线未知 (4/4)
- **谁说了**: Opus 盲点 3 / Sonnet B5 / Codex 5 / Gemini 4
- **场景**: 用户 6 个月后 facts 涨到 50K+, reflect 全表扫描跑 5 分钟, daemon 看似挂死
- **修正**: P1 — `bench/` 目录, `reflect-1k/10k/100k.bench.ts`, CI 跑回归阈值 > 50% 报警

### Gap 3: PII 数据捕获无防护 (Opus R1, 其他人未触及但严重)
- **场景**: 用户 paste API key / 信用卡号 → hook 捕获 → 永久存储. Compost 成为信用卡库
- **修正**: P1 — `redact.ts` 模块, regex 命中 (CC / SSH key / API token / .env line) 写入 `[REDACTED:type]`. 公开开源前必修

### Gap 4: Embedding 模型偏移 (Gemini 1.1)
- **场景**: 用户换 embedding 模型 → 存量向量失效 → 语义检索退化为纯文本
- **修正**: P1 — `chunks.model_signature` 列, 查询时校验, 不一致回退 BM25, `compost doctor --rebuild` 子任务

---

## 三个 Cargo Cult (3+/4 同意砍)

### Cargo 1: `four-layer self-model dashboard` P1 → P2
- **谁说**: Codex / Sonnet / Opus 一致
- **理由**: triage + `compost stats` 已覆盖 A 库存 + C 退化. 单独 dashboard 是 Myco 残留

### Cargo 2: `crawl_queue` P1 → Reject
- **谁说**: Codex / Sonnet (Opus 之前 P1 现撤回)
- **理由**: first-party 原则下是 open_problems 的重复 + 手动 `compost add <url>`

### Cargo 3: `compression_pressure` SQL view P1 → P2
- **谁说**: Gemini / Sonnet R2
- **理由**: archive_reason + triage 未在大规模数据集验证前是玄学指标. 直接用 `health_signals` 中 `stale_fact` 堆积代理

### Cargo 4 (推迟决议): `memory_procedural` 独立表
- **Gemini Reject** ("pinned facts 已可表达"), **Opus 修正** ("有 step1→step2 序列依赖, pinned 表达不了")
- **裁决**: 降为 **P2**, 等 P0+P1 落地后看真实需求

### Cargo 5 (Sonnet R1 + R2): `semantic chunking / Savitzky-Golay` carried → Reject
- **理由**: 无评估框架, 当前 heading-based chunking 已够用, Phase 5 有真实数据再评估

---

## 真分歧 (无 R3 解决, 留作未来辩论)

### Dispute 1: Gemini "Self-Consumption Pollution" 长期风险
- Gemini R1 §独特视角: LLM 生成的 wiki 被 ingest → 幻觉正反馈循环
- Opus R2 同意: 应作为 P0-6 (LLM abstraction) 子要求 — extractor 必须识别 source 是否来自 wiki/ 拒绝再 ingest
- **未决**: 实现细节 (路径黑名单 vs source_kind 标签 vs hash 比对)

### Dispute 2: Phase 6 多模态完全砍 vs 保留元数据
- Opus / Sonnet: 砍 PDF/video/code-repos
- Gemini: "保留多模态元数据链接" (multimodal metadata extractor)
- **裁决**: Phase 6 砍 PDF/video 实质提取, 保留 `attachment` 字段 + 元数据 ingest. 不做语义解析, 只记录 source URL + MIME + size. 用户真要查 PDF 内容时手动 `pdftotext | compost add -`

### Dispute 3: Audit log TTL
- Gemini R1 1.2: 30 天 TTL 防膨胀
- Sonnet R2 反驳: 个人工具频率不会爆, YAGNI
- **裁决**: 不进 Phase 4. Phase 5 有规模数据时再加

---

## 最终 Phase 4 P0 列表 (8 项, 4/4 收敛)

| # | 项目 | 前置 | 来源 | 估算 |
|---|---|---|---|---|
| **P0-0** | `fact_links` 表 + 双向 FK + ON DELETE CASCADE + recursive CTE | 无 | 4/4 (从 carried 提升) | M (3-5d) |
| **P0-1** | `compost triage` (health_signals) — 修 Bug 2 (snapshot DEFAULT 0) | 0010 | 原 Batch D | M |
| **P0-2** | `decision_audit` 表 + 写入点 (reflect.ts / wiki.ts) | P0-4 语义稳定 | 原 Batch D | M |
| **P0-3** | `v_graph_health` TS 实现 + snapshot (与 P0-0 同 PR) | P0-0 | 原 Batch D (修正) | S (依赖 P0-0) |
| **P0-4** | `archive_reason` + `replaced_by_fact_id` + `revival_at` 写入逻辑 | facts 表 | 原 Batch D | S |
| **P0-5** | `correction_events` 捕获 (信号挂 triage, 不直接改 confidence — Gemini 1.5) | hook-shim | 原 Batch D (修正) | S |
| **P0-6** | LLM 降级策略 (timeout + circuit breaker + `[LLM unavailable]` 标注) + Self-Consumption 防护 (Wiki source 黑名单) | 无 | NEW, 4/4 共识 | M |
| **P0-7** | `compost backup`/`restore` (VACUUM INTO + 24h cron + 30 份保留) | 无 | NEW, 4/4 共识 | S |

**总成本估算**: ~3-4 周 (与原 4 周 Phase 4 接近). 比原 17 项更聚焦.

---

## 修正 Phase 4 P1 列表 (4 项)

| 项目 | 来源 |
|---|---|
| `open_problems` 表 + CLI | 原 Batch D P1, 保留 |
| `inlet_origin_hash` opt-in (机器必填) | 原 Batch D P1, 保留 |
| Performance benchmark harness (`bench/` 1K/10K/100K) | NEW, 4/4 共识 |
| PII redactor in hook-shim | NEW (Opus 盲点 4) |

砍掉的 P1: shareable export (并入 Phase 5), crawl_queue (Reject), four-layer dashboard (→ P2), compression_pressure view (→ P2)

---

## 修正 Phase 4 P2 列表 (4 项)

| 项目 | 为什么 P2 |
|---|---|
| Semantic Cohort (query-side experimental) | 原 Batch D P2 |
| Milestone retrospective scheduler | 原 Batch D P2 |
| Four-layer self-model dashboard | 降级 (3/4 共识) |
| `compression_pressure` SQL view | 降级 (Gemini+Sonnet 共识) |
| `memory_procedural` 独立表 | 降级 (Gemini-Opus 分歧未决, 观望) |

---

## 修正 Reject 列表 (新增)

| 项目 | 4/4 共识理由 |
|---|---|
| `crawl_queue` (P1) | first-party 原则下重复, 用 open_problems + 手动 add |
| `semantic chunking / Savitzky-Golay` (carried) | 无评估框架, heading-based 已够用 |
| Audit log TTL (Gemini 提) | YAGNI, 个人工具规模不会爆 |
| Migration rollback `down.sql` 强制 | backup (P0-7) 已覆盖回滚需求 (重建优于回滚) |

---

## Phase 5/6 重写

### Phase 5 — Portability (later, single-machine focus)
**保留**:
- `compost export <bundle>` / `compost import <bundle>` (单机迁移用)
- 设计文档: import 冲突解决 (last-writer-wins / merge / fail) — 不动手, 写下来

**砍掉**:
- ~~Cross-machine sync protocol~~ (enterprise 假需求)
- ~~Multi-host concurrency coordination~~ (enterprise)
- ~~HTTP transport for remote MCP clients~~ (MCP stdio 已够)

### Phase 6 — Ecosystem (later, minimal)
**保留**:
- compost-adapter-openclaw (实际有用)
- Multimodal metadata extractor (Gemini 修正版): `attachment` 字段 + URL/MIME/size, 不解析内容
- Prometheus/OpenTelemetry metrics export (运维真需求)

**砍掉**:
- ~~PDF (docling) full extraction~~ (用户用 `pdftotext | compost add -`)
- ~~Video transcripts~~ (没人会喂 video)
- ~~Code repos full ingest~~ (代码已在 git)
- ~~hermes adapter, airi adapter~~ (没用户 - 等明确需求再加)
- ~~compost relearn~~ (Phase 5 export/import 已覆盖)

---

## 实施顺序 (R2 共识)

```
Week 1: P0-0 (fact_links migration 0011 + recursive CTE API)
        P0-7 (backup script + cron) [并行]

Week 2: P0-4 (archive_reason 写入 reflect)
        P0-3 (graph_health TS, 与 fact_links 捆绑) [依赖 P0-0]
        P0-5 (correction_events 捕获) [并行]

Week 3: P0-2 (decision_audit 写入 reflect.ts + wiki.ts) [依赖 P0-4 enum]
        P0-6 (LLM circuit breaker + provider abstraction)

Week 4: P0-1 (triage 整合所有上述信号源)
        集成测试 + benchmark fixture (P1 启动)
```

---

## ROADMAP.md 必修 Delta (具体编辑)

需要在下次 commit 修改:

1. **`docs/ROADMAP.md` Phase 4 章节**: 替换为本 synthesis 的 P0/P1/P2/Reject 列表
2. **`docs/ROADMAP.md` Phase 5**: 改名 "Portability", 删除 multi-host + HTTP 字段
3. **`docs/ROADMAP.md` Phase 6**: 大幅缩减, 留 openclaw + multimodal metadata + telemetry
4. **新增 `packages/compost-core/src/schema/0011_fact_links.sql`**: 为 P0-0 准备 (本 PR 可不写, 但 ROADMAP 提到)
5. **修 `0010_phase4_myco_integration.sql`** Sonnet B3 bug: graph_health_snapshot 三列加 DEFAULT 0
   - 实操: 不能改已 commit migration 校验和, 应在 0011 加 ALTER TABLE 修复
6. **更新 `cognitive/correction-detector.ts` 的 TODO**: 信号挂 triage, 不直接改 confidence (Gemini 1.5)

---

## 集体自我修正 (R2 公开记录)

| 参赛者 | 撤回的立场 |
|---|---|
| **Opus** | 撤回 "Phase 5 整体砍掉" (Sonnet 反驳成立, 应精确切割) |
| **Opus** | 承认 Gemini "Self-Consumption Pollution" 长期风险, 之前完全没看见, 加入 P0-6 |
| **Sonnet** | R1 把 backup 放 P1 是错的 (数据不可逆性低估) → P0-7 |
| **Codex** | R1 把 backup 写成 "跨 phase" → 撤回, Pre-P0/P0 末位 |
| **Gemini** | R1 audit log TTL P1 → R2 仍坚持但被 Sonnet 反驳 YAGNI, 留作分歧 |

---

## 下一步执行清单

1. **立即修 ROADMAP.md** — 应用上面 Delta 6 项编辑
2. **创建 issue/branch tracker** — 为 8 个 P0 各开一个 tracker (内部, 不需 PR 平台)
3. **下周开工 P0-0 + P0-7 并行** — fact_links 是 critical path
4. **不动手 Phase 5/6** — 等 Phase 4 P0 全部 land 后再评估

---

## 元教训 (本次审计学到的)

1. **隐性依赖 = 隐性 P0**. ROADMAP 把 fact_links 列在 carried 是错误分类. 任何被多个 P0 引用的"基础设施"项必须自己也是 P0. Lesson: 写 ROADMAP 时画依赖图, 不只是列清单.

2. **Cargo cult 会被 R2 cross-critique 揪出**. 4 项被 3+ 人砍掉的 P1 都是上次 Myco 辩论里 P1 列表的"看起来好"项. 没有 R2 的话它们会进 Phase 4 实现, 浪费 1-2 周.

3. **Backup 不是工程债, 是信任契约**. 4/4 共识不是因为它技术难, 是因为没它整个项目的价值随时归零. 这种"低成本但绝对必要"的项目应该在 ROADMAP 里有专门类别 (信任基础设施).

4. **migration 一旦 commit 就不能改**. Sonnet B3 发现的 NOT NULL bug, 因为 0010 已 commit 不能改, 只能在 0011 加 ALTER. Lesson: migration 必须有 dry-run + 红队评审, 写入 schema 前。
