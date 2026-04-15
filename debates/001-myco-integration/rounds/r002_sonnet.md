# Round 2 — 🟠 Sonnet 4.6 (Cross-Critique)

---

## 1. Cargo Cult 点名

**CC-1: Gemini Item 3 — 26 维 lint 直接移植**
参赛者: Gemini. Item: "26 维基质免疫系统 (Immune System Lint)".
为什么是 cargo cult: Gemini 建议"直接移植逻辑"，把 Myco 针对 Markdown+YAML 文件系统结构设计的 L0-L25 lint，照搬进 SQLite+TypeScript 体系。Myco 的 lint 维度是为了弥补无 schema 约束的 Markdown 存储缺陷——SQLite 的 schema、外键、CHECK 约束已经内化了其中 80% 的契约。在有 schema 的数据库上再跑 26 个 lint，是把治疗症状当作治疗原因。
正确替代: `compost doctor` 只做 3 项 DB 级健康检查：向量覆盖率 (facts without embeddings)、FTS5 索引与主表行数一致性、contradiction 表无 unresolved 超过 N 天。成本 XS，覆盖真实风险。

**CC-2: Gemini Item 8 — evolve.py 进化引擎移植**
参赛者: Gemini. Item: "进化策略变异 (Meta-loop Evolution)".
为什么是 cargo cult: Gemini 提议对 `tp-YYYY-MM` 系列 prompt profile 做 mutation-selection 进化，成本标记为 L。Myco 的 evolve.py 本质是 schema migration + prompt A/B test 的 rebrand，Compost 已有 9 次 SQL migration + ranking profile 版本机制 (rp-phase2-default / rp-phase3)。"进化"就是更名后的 migration，不产生额外价值，成本却是 L 级别。
正确替代: 继续现有 profile 版本机制，在 `compost.config.yaml` 集中管理权重。需要 A/B test 时显式建 rp-phase4-experiment profile，人工比较指标，手动晋级。

**CC-3: Gemini Item 9 — 入口出处契约强制元数据**
参赛者: Gemini. Item: "入口出处契约 (Inlet Provenance Contract)" — 强制 `origin_hash` + `method_fingerprint`.
为什么是 cargo cult: Gemini 将 Myco 的 `OPTIONAL_FIELDS` (inlet_origin, inlet_method) 升格为强制字段。Myco 原文标注的是 OPTIONAL——Gemini 在没有具体 use case 支撑下把它变成硬约束，同时承认"避免过度采集隐私元数据"，自相矛盾。对单用户本地第一大脑，`method_fingerprint` 的仲裁价值几乎为零：用户自己知道这条从哪来。
正确替代: 保持现有 `observations.source TEXT`。有具体溯源需求时 (多数据源 pipeline)，再在 schema migration 里按需加字段，不预埋。

**CC-4: Gemini 通篇生物学隐喻违反硬约束**
参赛者: Gemini.
具体违规: Item 1 "基质处于被动响应状态，无法实现真正的自主代谢"；Item 2 "基质会演变成知识癌变"；Item 3 标题"免疫系统 Lint"；Item 5 标题"压缩即认知"中的正文"认知基质"；Item 6 "自主扩张"；独特视角"认知基质的可迁移性契约"。
Gemini 在拒绝清单里明确写了"拒绝生物学隐喻术语"，但正文中反复用"基质/代谢/免疫"——自我打脸。这不仅是风格问题，这些词渗入 item 标题和 Compost 落地点描述，会污染实际 schema 命名决策。

---

## 2. 真 Insight 背书 (愿意撤回 R1 立场)

**I-1: 撤回对 open problems 优先级的低估，支持 Opus**
Opus 将 open problems register 列为 Top 2，强调"我知道我不知道"是第二大脑最该管的盲点。我在 R1 里把它列为 P1 但没给出足够理由。Opus 的表述更准确：知识库里缺的不是答案，是对"缺口"本身的结构化记录。完全认同，提升至 P0 候补。

**I-2: 撤回对 confidence ladder 的谨慎态度，支持 Opus**
我在 R1 里把 confidence ladder 定为"只在 kernel 级别触发"并持保留态度。Opus 将其单列为 Top 3，指出 `decision_audit` 表的关键性：高成本决策（合并矛盾/排出事实）没记理由，三个月后无法回答"为什么"。这个痛点是真实的。支持 Opus 的 `decision_audit(id, kind, target_id, confidence, rationale, evidence_refs, created_at)` 设计。

**I-3: 支持 Opus 的 "嵌入而非新轴" 集成策略**
Opus 最重要的架构观点：所有 Myco 借鉴应嵌入 Phase 4 已有模块（curiosity/fact-graph/contradiction），不开新轴。我在 R1 里没有明确说这一点，只是按 item 列清单。Opus 的这个约束比任何具体 item 的取舍更重要，直接影响 Phase 4 范围膨胀风险。

---

## 3. 最终投票

P0 上限 5，P1 上限 8。

| 代号/名称 | Tier | 理由 (≤ 15 字) |
|---|---|---|
| A compost triage (renamed hunger) | P0 | session 入口核心，5 信号够 |
| D graph density + orphan ratio | P0 | SQL view 即可，退化感知真缺口 |
| C confidence ladder (audit trail only) | P0 | 矛盾仲裁后无 audit 是真漏洞 |
| G dead knowledge tombstone reason | P0 | 已有表，只加字段，成本 XS |
| F cross-project distillation tag | P0 | 跨项目迁移是个人大脑最大价值 |
| B compost.config.yaml SSoT (无 lint) | P1 | 调参散乱，集中化合理 |
| E compression pressure metric | P1 | 信号有价值，不触发 auto-action |
| open problems register | P1 | 结构化盲点记录，成本 S |
| H self-correction capture | P1 | 显式信号，正则抓取，成本 S |
| J semantic cohort (query side only) | P1 | LanceDB 向量距离可做，限检索 |
| session memory (episode-level) | P1 | Phase 4 原计划，加 session 聚合 |
| I forage manifest autonomous crawl | Reject | 职责错位，provenance 混乱 |
| H signal-to-action auto-execute | Reject | LLM 幻觉转 write action，无 human loop |
| B _canon.yaml 29 维 lint | Reject | SQLite schema 已内化，重复成本 L |
| evolve.py 进化引擎 | Reject | migration rebrand，成本 L 无增量价值 |
| craft protocol ceremony | Reject | 单用户场景，仪式成本 > 决策时间 |
| forage autonomous external crawl | Reject | 同 I，first-party 原则不容妥协 |

---

## 4. 自我修正

**撤回 R1 中对 "self-correction event capture" 的 P2 定级。**
R1 里我把它列为"观望"，认为正则抓取可靠性存疑。重新评估后：这是成本最低、价值最不对称的 item——用户明确说出"我之前说的 X 是错的"这类话时，信号噪声极低，不需要 LLM 推理。只用 5 个固定 pattern 的正则，命中即写入 `correction_event`，漏掉的都是边缘情况。误判代价几乎为零。升为 P1。

DONE_R2_SONNET
