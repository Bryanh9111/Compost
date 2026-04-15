# Round 1 — 🐙 Opus (Architecture Judge)

身份: 主持人 + 独立架构视角. 关注: 第二大脑的本质需求 vs Myco 的 agent-first 倾斜是否错位, 集成成本的长尾, Compost 身份的保全.

---

## 核心判断

Compost 是 **外部化的人类工作记忆** — 目标不是让 agent 不失忆, 是让**人**不失忆. Myco 的中心是 "agent IS the daemon", 这个定位差 90° — 很多 Myco 的"精华"在 agent-first 语境是 insight, 放到 second brain 语境就是 overhead. 必须筛.

Compost 真正缺的结构性能力有三个:
1. **主动 surface**: 现在 Compost 写入后就沉默, 只在被查询时输出. 第二大脑应该在"人回来"时主动 triage.
2. **结构退化感知**: contradiction arbitration 只处理单个 fact 矛盾, 没看整体图的退化 (孤岛 / 低密度 / 过时聚类).
3. **置信度审计链**: wiki L3 / fact 的 confidence 字段存在但无审计路径. 高成本决策 (合并矛盾 / 排出事实) 没记理由.

其他 Myco 炫技 (forage / hunger auto-execute / 29 维 lint / craft protocol) 在 Compost 语境是 anti-value.

---

## Top 10 Integrate (按 ROI 降序)

### 1. Boot-time triage view (`compost triage`)
- **Myco 源**: `MYCO.md:9-21` 🔥热区 + `src/myco/cli.py:900` hunger. 关键: "boot ritual: first action every session"
- **Compost 落地点**: 新增 `packages/compost-core/src/cognitive/triage.ts` + CLI `compost triage`; 新表 `health_signals(id, kind, severity, message, created_at, resolved_at)`.
- **集成方式**: 只借设计思路 (不抄 hunger 名字, 不抄 execute=true auto-action 的危险模式)
- **成本**: M (2-3 天)
- **不做的代价**: 用户每次开 session 靠记忆查"上次我在想啥", 跟没第二大脑一样
- **风险**: 别做成 25 tools 的巨型. 信号源限 5 个: stale facts / low-density clusters / unresolved contradictions / new raw captures / stale wiki

### 2. Open problems register (`docs/open_problems.md` 风格)
- **Myco 源**: `docs/open_problems.md` 整份. 关键: "诚实登记册 — 结构性 blind spots, 不是 feature backlog"
- **Compost 落地点**: 新表 `open_problems(id, title, description, entry_criteria, exit_criteria, confidence_floor, status, created_at)` + CLI `compost problems list/add/resolve`
- **集成方式**: 重新实现 (表 + CLI, 不是 markdown)
- **成本**: S (半天)
- **不做的代价**: 用户所有"我知道我不知道"的盲点都丢在脑子里, 第二大脑最该管的就是这个
- **风险**: 别做成 backlog tracker (已有 GitHub Issues). 关键是 **confidence_floor**: 低置信度的推论要标记, 高置信度的要关联证据

### 3. Confidence ladder on high-cost writes
- **Myco 源**: `docs/craft_protocol.md` 的 "kernel 0.90 / instance 0.85 / exploration 0.75"
- **Compost 落地点**: `reflect.ts` 的 contradiction arbitration + wiki rebuild 路径; schema 新增 `decision_audit(id, kind, target_id, confidence, rationale, evidence_refs, created_at)`
- **集成方式**: 只借设计思路. 不要 craft protocol 的整套 ceremony (辩论文件 / frontmatter schema / grandfather rule)
- **成本**: M (2 天)
- **不做的代价**: 三个月后回看 wiki 说"X 是真", 忘了为什么决定的; 矛盾仲裁后没 audit trail
- **风险**: 只在 kernel-level 决策 (合并/排出/wiki rebuild) 触发, 不要每条 fact 都来一套

### 4. Structural degradation metrics (graph density + orphans)
- **Myco 源**: `src/myco/mycelium.py` + MYCO.md §指标面板的 `mycelium_density / graph_orphan_pressure`
- **Compost 落地点**: Phase 4 的 "Fact-to-fact links graph + recursive CTE" 之上加 `compost stats graph`; 新增 view `v_graph_health(density, orphan_ratio, cluster_count, stale_cluster_ratio)`
- **集成方式**: 重新实现 (SQL view 就够, 不用 Python graph lib)
- **成本**: S (已在 Phase 4 路线上)
- **不做的代价**: contradiction 只看单点矛盾, 图整体退化 (知识碎片化) 感知不到
- **风险**: 不要搞 edges/nodes 这种绝对值, 只看**变化率** (比上次快照 / vs 七日移动平均)

### 5. Dead knowledge tracking + tombstone reason
- **Myco 源**: MYCO.md 四层自我模型 §5 "D 层: dead_knowledge 追踪" + `docs/evolution_engine.md` (第七步淘汰)
- **Compost 落地点**: 扩展现有 `tombstones` 表, 加 `tombstone_reason TEXT` + `replaced_by_fact_id` + `revival_event_id`; 在 `reflect.ts` 写入 reason
- **集成方式**: 重新实现 (Compost 已有 tombstone, 只是理由没存)
- **成本**: S
- **不做的代价**: 排出的事实被重新捕获时无法识别 (循环 churn), 也无法回答"为什么这个我删了"
- **风险**: reason 用短 enum + optional note, 不要开放 LLM 自由发挥

### 6. Cross-project distillation tag (`g4-candidate`)
- **Myco 源**: MYCO.md §Agent 行为准则 "解决耗时 ≥2 轮的问题后标记 g4-candidate"
- **Compost 落地点**: fact / episode 表加 `distillation_tag TEXT[]`; CLI `compost distill --tag shareable` 导出 markdown bundle
- **集成方式**: 只借设计思路 (tag 机制 + 定期 sweep)
- **成本**: S
- **不做的代价**: Compost 按项目建库, 跨项目洞察永远孤立; 个人大脑最值钱的是**跨领域迁移**
- **风险**: 不要搞 "autonomous sync across projects", 手动 sweep 就够

### 7. Session memory + FTS5 on raw turns
- **Myco 源**: Myco v0.40.0 Session Memory FTS5 (MYCO.md §1 Phase ②)
- **Compost 落地点**: Phase 4 的 episodic memory 已计划. 关键是 **按 session 聚合** 不是按 turn, 加 session_summary 字段
- **集成方式**: 重新实现
- **成本**: M (Phase 4 本来就要做)
- **不做的代价**: 只有 fact 层, 没有"那次对话发生了什么"的时间轴
- **风险**: 别建成聊天记录 dump, 要 episode-level 摘要

### 8. Self-correction event capture
- **Myco 源**: MYCO.md "🆕 自承错误触发点: 同一 turn 内说出'我之前说的 X 是错的', 立即 eat + on-self-correction tag"
- **Compost 落地点**: hook 加正则捕获 self-correction 短语 → 特殊 `correction_event` 表, 关联被纠正的 fact
- **集成方式**: 直接移植逻辑
- **成本**: S
- **不做的代价**: 用户最宝贵的 "我改变主意了" 信号被当普通 turn 扔进 corpus
- **风险**: 只抓显式 self-correction 话术, 不搞 LLM 推理识别

### 9. Compression pressure metric (not full doctrine)
- **Myco 源**: MYCO.md 指标 `notes_digestion_pressure = raw / (extracted + integrated)`
- **Compost 落地点**: 加 view `v_ingest_pressure(raw_pending, digested_7d, extraction_lag_hours)`; 在 triage view 里 surface
- **集成方式**: 重新实现
- **成本**: S
- **不做的代价**: 不知道 ingestion queue 积压
- **风险**: 只作为信号, 不作为 auto-action 触发

### 10. `_canon.yaml` SSoT (极简版)
- **Myco 源**: `_canon.yaml` (但只取 "数字常量集中" 的设计, 不抄 29 维 lint)
- **Compost 落地点**: 新增 `compost.config.yaml` 存 ranking weights / confidence thresholds / decay rates; 现在这些散在 `rp-phase3` profile 和 ts 常量里
- **集成方式**: 只借设计思路
- **成本**: S
- **不做的代价**: 调参要改 3 个地方, 容易漂移
- **风险**: 不要做 lint, profile versioning 已经够了

---

## Reject 清单 (技术缺陷明确指出)

### R1. Craft Protocol 整套 ceremony
**拒绝**: kernel_contract floor 0.90 / 辩论文件 schema + frontmatter / grandfather rule. 这是**组织级流程伪装成技术协议**. 个人大脑单用户场景, 写一份 craft markdown 的成本 (30 分钟) > 实际做决定的时间. Compost 已有 debate 机制 (通过 /octo:debate 按需触发), 不需要强制仪式.

### R2. Hunger execute=true auto-action
**拒绝**: `src/myco/cli.py` 的 hunger(execute=true) 读 signal → 自动执行动作. 技术缺陷: LLM 幻觉的信号转成 write action 没有 human-in-loop, 污染数据层. 第二大脑必须**建议不执行**.

### R3. 25 MCP tools 表面
**拒绝**: Myco 25 tools (eat/digest/condense/absorb/prune/evolve/...). Compost MCP 现在只开 3-4 个 (add/query/reflect), context 占用低. 扩 tools 到 25 相当于把 agent 开销转给自己. 保持 **≤ 6 MCP tools**.

### R4. Biomimetic vocabulary (菌丝/代谢/免疫/基质)
**拒绝**: 15K 的 `biomimetic_map.md`. 技术缺陷: 隐喻污染 schema 和 API (比如 `myco_eat` / `myco_hunger` 对新用户是 jargon). Compost 术语 (fact/wiki/reflect/contradiction) 有意选了 neutral 词, 要守住.

### R5. Forage manifest autonomous crawl
**拒绝**: `src/myco/forage.py` 的 "主动觅食外部知识源". 技术缺陷: (a) 个人大脑是 **first-party** 信息库, 不是爬虫; (b) 爬来的东西 provenance 混乱 (和用户笔记混) 破坏 trust; (c) 已经有 Engram 做全局层了. 第二大脑就该接受 "用户给什么我存什么" 的被动角色.

### R6. Evolve.py 自我进化引擎
**拒绝**: `src/myco/evolve.py` mutation/gates/scoring. 技术缺陷: "非参数进化" = 改 markdown/yaml/目录结构, 其实就是 schema migration, Compost 已经有 9 migrations 做同样的事, 还更安全 (SQL + test). 把 migration rebrand 成 "evolution" 是 cargo cult.

---

## 对候选 A-J 裁决

| 代号 | 裁决 | 一句话 |
|---|---|---|
| A compost hunger | **accept (renamed: triage)** | 核心价值, 但去掉 execute=true 和生物学命名 |
| B _canon.yaml lint | **modify** | 只取 SSoT 部分, 丢弃 29 维 lint |
| C Craft Protocol | **modify (extract: confidence ladder)** | 只取 confidence + audit, 丢 ceremony |
| D graph density | **accept** | 真 insight, SQL view 就能做 |
| E compression doctrine | **modify (extract: pressure metric)** | 只取 pressure 公式, 丢 "doctrine" 包装 |
| F cross-project distillation | **accept** | 对个人大脑**不可或缺**, 成本低 |
| G 四层自我模型 | **modify (only tombstone + gap)** | 全盘接受过重, 取 "dead knowledge + open problems" 两层 |
| H signal-to-action | **reject** | auto-execute 危险; 只做 signal → 不做 action |
| I forage manifest | **reject** | 职责错位 (见 R5) |
| J continuous compression + cohort | **P2 观望** | Semantic Cohort 有价值但 Myco 实现巨大, 先不动 |

---

## 独特视角 (Opus 作为架构主持)

**所有人会盯着 "集成什么", 但真正的设计决策是 "先集成什么, 什么信号触发下一次再集成".** Phase 4 塞太多 Myco 借鉴会让 Compost 变成四不像 — 它有自己的 Phase 4 原计划 (episodic / fact-graph / curiosity / crawl / procedural). Myco 借鉴应**嵌入**到这些里, 不开新轴. 具体: triage view 落在 curiosity agent 出口, confidence ladder 落在 contradiction arbitration, graph health 落在 fact-to-fact links. 这样 Phase 4 不扩张, 但每个模块变厚.

**反直觉结论**: Myco 的 identity 文档 (`wiki/identity.md` 七条生命标准) 其实比代码更值得读. 但这是**读完删**的资料, 不是集成物.
