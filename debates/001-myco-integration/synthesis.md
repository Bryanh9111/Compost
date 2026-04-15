# Synthesis — Myco → Compost 集成裁决

> 🐙 Opus 主持综合 · 2026-04-14
> Participants: 🔴 Codex · 🟡 Gemini · 🟠 Sonnet · 🐙 Opus
> Rounds: 2 (R1 independent analysis + R2 cross-critique)

---

## 核心裁决 (TL;DR)

Myco 的真金是 **诊断 + 审计 + 结构退化感知**. 铜镀 (cargo cult) 是 **自动执行 + 29 维 lint + 生物学命名 + 跨项目 framework 假设 + 单文件巨型**. Phase 4 的集成应**嵌入已有模块**不开新轴.

- **P0 (Phase 4 必做, 5 项)**: 非做不可
- **P1 (Phase 5 值得做, 8 项)**: 看 P0 落地后的实际收益再决定
- **P2 (长期观望, 3 项)**: 有价值但投入产出比不够高
- **Reject (6 项)**: 明确不做, 含理由

---

## P0 裁决 (Phase 4 必做)

### P0-1: `compost triage` — Boot-time Health Signals
**四方投票**: Codex modify / Gemini accept / Sonnet P0 / Opus P0 — **一致通过**
**设计**:
- 新表 `health_signals(id, kind, severity, message, target_ref, created_at, resolved_at, resolved_by)`
- 五个信号源 (上限, 不扩): (1) stale facts beyond freshness threshold (2) unresolved contradictions > N days (3) outbox stuck > M hours (4) orphan facts delta > baseline+5 (5) wiki pages with stale evidence
- CLI: `compost triage` 输出结构化 brief, 默认读-only. `--resolve <id>` 手动关闭.
- 新模块: `packages/compost-core/src/cognitive/triage.ts`

**硬约束**: 绝不 auto-execute. signal → surface → 用户或 agent 显式 act.

**不集成的代价**: session 开始靠记忆查"上次在想啥", 与无第二大脑无异.

**风险**: 信号源爆炸. 严格保持 ≤ 5 种 kind.

---

### P0-2: `decision_audit` 表 + 置信度阶梯语义
**四方投票**: 所有人 modify/accept — **一致通过**
**设计**:
- 新表 `decision_audit(id, kind, target_id, confidence_floor, confidence_actual, rationale, evidence_refs_json, decided_at, decided_by)`
- `kind` 枚举: `contradiction_arbitration` / `wiki_rebuild` / `fact_excretion` / `profile_switch`
- 语义层置信度阈值 (只做 constant, 不做强制 lint):
  - `kernel` (schema/ranking profile): 0.90
  - `instance` (fact merge / wiki L3): 0.85
  - `exploration` (default captures): 0.75
- 扩展 `reflect.ts` 和 `wiki.ts` 的 write path, 每次高成本决策必写一行 audit
- 查询接口 `compost audit list --kind <k> --since <date>`

**不集成的代价**: 三月后看 wiki 说"X 是真", 无法回答为什么决定.

**风险**: 开放 rationale TEXT 会变成 LLM 废话回音室. 用 short enum + optional note.

---

### P0-3: `v_graph_health` SQL View — 结构退化感知
**四方投票**: Codex accept / Gemini accept / Sonnet P0 / Opus P0 — **一致通过**
**设计**:
- 等 Phase 4 "Fact-to-fact links graph + recursive CTE" 落地后, 加 view:
```sql
CREATE VIEW v_graph_health AS
SELECT
  (SELECT COUNT(*) FROM facts WHERE tombstoned_at IS NULL) AS total_facts,
  (SELECT COUNT(*) FROM facts f
   LEFT JOIN fact_links l ON l.from_fact_id = f.id OR l.to_fact_id = f.id
   WHERE f.tombstoned_at IS NULL AND l.id IS NULL
  ) AS orphan_facts,
  ... density, cluster_count ...
FROM facts LIMIT 1;
```
- 新表 `graph_health_snapshot(taken_at, total_facts, orphan_facts, density, cluster_count)` — daemon 每日快照
- triage (P0-1) 消费 delta: 如 `orphan_delta_7d > 5` 触发 signal
- 不引入外部 graph 库 (Codex/Sonnet 一致). 纯 SQL.

**不集成的代价**: contradiction arbitration 只看单点矛盾, 图整体退化 (知识碎片化) 无感知.

**风险**: 新 fact 天然无 link. 必须加 `age > 24h` gate 才算 orphan.

---

### P0-4: 压缩三判据 + tombstone_reason 扩展
**四方投票**: 四方一致 accept — **一致通过**
**设计**:
- 扩展 `tombstones` 表 (已存在): 加 `reason ENUM('stale', 'superseded', 'contradicted', 'duplicate', 'low_access')`, `replaced_by_fact_id`, `revival_event_id`
- `reflect.ts` Step 2 增加三个判据:
  - **频率**: `access_log.count_30d` 为 0 + age > 90d → `stale`
  - **时效**: 既有 decay formula (保留)
  - **排他性**: 同 subject 下 confidence 较低且 semantic similarity > 0.92 的 fact → `duplicate`
- 纯 heuristic, 不引入 LLM 到 reflect 写路径
- 新迁移 `0010_tombstone_reason.sql`
- 单测 `reflect.spec.ts`: 每个 reason 都有 fixture 覆盖

**不集成的代价**: (a) 排出的事实无法解释理由 (b) 同主语冗余累积 (c) 高频访问 fact 被时效公式错杀.

**风险**: 排他性判据阈值 0.92 需要 tuning. 先 dry-run mode (写 tombstone_preview, 不真正 tombstone), 人工确认后再切 live.

---

### P0-5: Self-Correction Event Capture
**四方投票**: Opus P0 / Sonnet P0 / 其他 implicit accept — **通过**
**设计**:
- hook shim 层 (`packages/compost-hook-shim`) 加正则 pattern 列表:
  - `我(之前|上次)(说|以为)的.*(错|不对)`
  - `实际上(应该|是)`
  - `I was wrong about`
  - `correction:`
  - `scratch that`
- 命中时 hook 写入 outbox `kind='correction'`, 附 `retracted_span + corrected_span`
- 新表 `correction_events(id, session_id, retracted_text, corrected_text, related_fact_ids, created_at)`
- reflect 消费时: 对 related_fact_ids 降 confidence / 触发 contradiction arbitration
- 不做 LLM 推理识别 — 只抓显式话术, 漏掉的都是边缘

**不集成的代价**: 第二大脑最宝贵的"我改变主意了"信号被当普通 turn 扔进 corpus.

**风险**: 误判代价约 0 (最多就是多记一条 correction 但未实际 retract). 价值/风险高度不对称.

---

## P1 裁决 (Phase 5 值得做, 8 项)

| 名称 | 四方态度 | 一句话 |
|---|---|---|
| `open_problems` 表 + CLI | Opus R2 P1 / Sonnet I-1 支持 | 诚实盲点登记 (≠backlog), 成本 S |
| `session_turns` FTS5 + episode 聚合 | Sonnet P1 / 所有人 P1 | Phase 4 episodic 的落地形态 |
| Compression pressure metric | Codex / Sonnet / Opus 共识 | 无 auto-action, 仅作为 triage 信号 |
| `compost.config.yaml` SSoT (无 lint) | Sonnet P1 / Opus R2 降级但接受 | 调参集中, 不做校验层 |
| Cross-project `shareable` tag + export | Sonnet P0→ 仲裁 P1 / Opus 降级 | 简化到 tag + `compost export --shareable` markdown bundle. 不做 multi-host 同步 |
| `crawl_queue` SQLite (持久化 curiosity intent) | Sonnet / Codex accept | 替代 Myco YAML manifest, 人工 trigger only |
| Inlet `origin_hash` 字段 (opt-in) | Gemini 提, Sonnet CC-3 反对强制 | **opt-in** 字段, 不强制, 仅多源 pipeline 启用 |
| 四层自我模型 dashboard (A 库存 + C 退化) | Codex S / Sonnet P1 | 只实现 A + C 两层, D 层是 Myco 的 open problem 别学 |

---

## P2 观望 (3 项)

| 名称 | 为什么 P2 |
|---|---|
| Semantic Cohort Intelligence (query-side) | 效果好但 Myco 实现庞大. 等 Phase 5 有实际 noise 证据再启动 |
| Milestone retrospective scheduler | 个人大脑单用户, weekly diff 价值待证. 先手动 `compost retro` |
| Craft Protocol lite (仅 kernel-level) | 已有 /octo:debate + decision_audit, 强制仪式优先级低 |

---

## Reject 清单

| 名称 | 技术缺陷 |
|---|---|
| 29 维 YAML lint (B) | Sonnet CC-1: SQLite schema + TS 类型已内化 80%, 叠层 = 双真相源 + L 维护成本 |
| `hunger(execute=true)` auto-action (H) | Opus CC-1: agent-first 假设错位; LLM 幻觉信号转 write 无 audit; 人失去控制 |
| `forage.py` autonomous external crawl (I) | 第二大脑是 first-party 库, 爬取污染 provenance, trust 崩塌 |
| Myco biomimetic 术语在 CLI / schema | Sonnet CC-4: Gemini 自己说拒绝却通篇用; 隐喻污染 schema 命名决策 |
| `evolve.py` 整套进化引擎 (L 成本) | Sonnet CC-2: migration + profile 版本化 rebrand, 无增量价值 |
| Craft Protocol 完整 ceremony | 单用户场景仪式成本 > 决策时间; 已有 `/octo:debate` 按需触发 |

---

## 取骨去皮综述 (≤ 500 字)

**Myco 在做的事, 本质上是把一个知识系统的五个失败模式形式化**: (1) 入库但不反思 (2) 反思但不审计 (3) 有矛盾但无仲裁 (4) 整体退化但无感知 (5) 知道缺口但不追踪. 它用生物学隐喻 (基质 / 代谢 / 免疫 / 菌丝) 给这些机制起名, 又把 agent-first 假设推到极致 (hunger auto-execute / 25 MCP tools / markdown+YAML SSoT / 29 维 lint).

**Compost 需要继承的是前半**: 把这五个失败模式当作 Phase 4 的 invariant, 不是 feature. 五个 P0 分别对应:
- triage → 失败模式 1 (被动 → 主动 surface)
- decision_audit → 失败模式 2 (审计链)
- graph_health → 失败模式 4 (结构退化)
- 压缩三判据 + tombstone_reason → 失败模式 3 (矛盾 + 冗余仲裁)
- self-correction capture + open_problems (P1) → 失败模式 5 (缺口追踪)

**Compost 要明确拒绝的是后半**: Myco 的 agent-first 架构假设 (单文件 150KB, 25 tools, auto-action) 是其**部署形态**选择, 不是认知设计的必要条件. 第二大脑的主角是**人**, 不是 agent. 所有 Myco 机制必须经过"术语映射 + 假设替换 + 存储替换 (markdown→SQLite)" 三道过滤才可能集成.

**更深一层, Myco 给我们的最大礼物不是代码, 是语言**: 它把"结构退化 / 审计链 / 缺口登记 / 压缩教条"这些模糊直觉明确命名. 这些概念读完就能用, 不需要借它的工程外壳. Compost 读完 Myco 的 identity.md / open_problems.md / vision_recovery_craft 之后, 可以把那几份文档永久归档 (不留 Myco MCP, 不留 YAML lint, 不留单文件巨型), 只保留被这五个失败模式教育过的 schema 和 view.

**集成路线**: Phase 4 不扩原有 5 大主题 (episodic / fact-graph / semantic-chunk / curiosity / crawl / procedural), 把 P0 的 5 项**嵌入**到相应主题里. triage 落在 curiosity 模块出口, confidence ladder 落在 contradiction arbitration, graph_health 落在 fact-to-fact links, 压缩三判据落在 reflect 模块, self-correction 落在 hook 层. 不开新轴, 每个模块变厚. Phase 5 再评估 P1 的 ROI, 不承诺.

**风险观察**: 这次集成最容易的失败是"借 Myco 皮扩大 Phase 4 范围". 必须守住 P0 只 5 项, P1 做不做等 Phase 4 落地反馈.

---

## 投票矩阵 (对照表)

| 候选 | Codex R1 | Gemini R1 | Sonnet R1 | Opus R1 | Sonnet R2 | Opus R2 | **裁决** |
|---|---|---|---|---|---|---|---|
| A triage/hunger | modify | accept | accept (modify) | P0 | P0 | P0 | **P0** |
| B _canon lint | reject | accept | reject | modify (only SSoT) | Reject | Reject | **Reject (full); P1 only SSoT subset** |
| C confidence ladder | modify | modify | accept (modify) | P0 | P0 (support Opus) | P0 | **P0** |
| D graph density | accept | accept | accept (modify) | P0 | P0 | P0 | **P0** |
| E compression 3 criteria | accept | accept | accept | P0 | P1 | P0 | **P0** |
| F cross-project | modify | reject | reject | P0 → R2 withdrew | P0 (insist) | Reject → P1 simplified | **P1 (simplified tag + export)** |
| G 四层自我模型 | accept | accept | accept (modify) | P1 (only A+C) | P1 dashboard | P1 | **P1 (A+C only)** |
| H signal-to-action | modify | accept | accept (modify) | Reject | Reject | Reject | **Reject** |
| I forage autonomous | modify | modify | accept (modify) | Reject | Reject | Accept (SQLite queue) | **P1 (queue only, no crawl)** |
| J cohort + continuous compression | modify | accept | accept (modify) | P2 | P1 (cohort only) | P2 | **P2** |

---

## 下一步

1. 把本 synthesis.md merge 进 `docs/debate-myco-integration-synthesis.md`
2. 用 P0 清单刷新 `docs/ROADMAP.md` Phase 4 章节
3. 为 P0-1 到 P0-5 各创建一个 PR skeleton (branch + migration + 空 test)
4. 提交 `feat(phase4): integrate Myco P0 insights — triage/audit/graph-health/compression/correction`
