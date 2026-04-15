---
participant: Sonnet (🟠)
role: 务实工程 — KISS / 够用即止 / 代码复杂度优先
round: 1
date: 2026-04-14
---

# Round 1 — Sonnet (务实工程视角)

## 1. Top 10 Integrate 清单

### #1 — 结构退化指标: 孤立 fact 检测

| 维度 | 详情 |
|------|------|
| Myco 源 | `src/myco/mycelium.py:294-327` (`find_orphans`) + `docs/architecture.md` Appendix F.1 |
| Compost 落地点 | `packages/compost-core/src/cognitive/reflect.ts` → 在 Step 2 语义 tombstone 后增加 orphan-fact 扫描；结果写入 `ranking_audit_log` |
| 集成方式 | 重新实现 (TS, 针对 fact graph 而非 markdown 文件) |
| 工程成本 | S |
| 不集成代价 | 孤立 fact (无 backlink、无 access、decay 趋零) 永久占位，污染排序，tombstone 靠纯时间衰减而非结构信号 |
| 风险 | 孤立判定标准要慎重：新 fact 天然无 backlink，需配合 age 门槛，否则误删新知识 |

---

### #2 — 主动觅食队列 (Inbound Source Queue)

| 维度 | 详情 |
|------|------|
| Myco 源 | `src/myco/forage.py:66-89` (`DEFAULT_FORAGE_SCHEMA`, `detect_forage_backlog`) |
| Compost 落地点 | 新表 `crawl_queue` (url, source_type, why, status, acquired_at) — Phase 4 curiosity agent 的存储层；`packages/compost-daemon/src/scheduler.ts` 新增 `startCrawlWorker` |
| 集成方式 | 借设计思路: manifest-as-SSoT + `why` 强制字段 + license/quarantine 自动触发 |
| 工程成本 | M |
| 不集成代价 | Phase 4 curiosity agent 无持久化队列，只能内存状态，daemon 重启即丢失待爬任务 |
| 风险 | forage.py 用 YAML 存 manifest — Compost 必须走 SQLite，不要照搬存储层；forage 的文件预算概念 (200 MB) 在 Compost URL 场景无直接对应 |

---

### #3 — 置信度阶梯决策协议

| 维度 | 详情 |
|------|------|
| Myco 源 | `docs/craft_protocol.md:§4` (kernel 0.90 / instance 0.85 / exploration 0.75) |
| Compost 落地点 | `packages/compost-core/src/cognitive/reflect.ts` 矛盾仲裁逻辑 + `facts.confidence` 字段使用规范；补充到 `docs/ARCHITECTURE.md` |
| 集成方式 | 只借设计思路 (3 级阈值分类 + 自我报告 + 审计链) |
| 工程成本 | S |
| 不集成代价 | 当前矛盾仲裁 (reflect.ts:137-188) 的 confidence 含义由提取器自行决定，无分级语义，将来加 LLM 提取时会产生语义漂移 |
| 风险 | Craft Protocol 整体是 Agent-for-Agent 设计，Compost 不需要其 L13/L15 lint 机制；只取 3 级阈值定义和审计链概念即可，切忌照搬 YAML frontmatter 体系 |

---

### #4 — 压缩三判据: 频率 / 时效 / 排他性

| 维度 | 详情 |
|------|------|
| Myco 源 | `MYCO.md:§4` 压缩教条 + `docs/primordia/compression_primitive_craft_2026-04-12.md` |
| Compost 落地点 | `packages/compost-core/src/cognitive/reflect.ts` Step 2 tombstone 逻辑；当前只有时效 (decay formula)，缺频率门控和排他性检测 |
| 集成方式 | 重新实现: 在 `reflect()` 中增加 `access_log` 频率判据 + 同主语多 fact 的排他性合并建议 |
| 工程成本 | S |
| 不集成代价 | 高频访问 fact 被时效公式错杀；同主语冗余 fact 积累，排序噪音上升 |
| 风险 | "排他性合并"需要语义判断，当前无 LLM 在 reflect 路径 (deliberate: debate 9 决策)；保持 heuristic only，避免引入 LLM 写路径 |

---

### #5 — Boot-time 健康摘要 (Compost doctor 改进)

| 维度 | 详情 |
|------|------|
| Myco 源 | `MYCO.md` 热区 boot ritual + `src/myco/notes.py:compute_hunger_report` 概念 |
| Compost 落地点 | `packages/compost-cli/src/commands/doctor.ts` → 输出结构化 JSON health 摘要到 `.compost/boot_brief.json`；daemon startup 读取 |
| 集成方式 | 重新实现 (TS, SQLite 查询驱动，不用 markdown 存储) |
| 工程成本 | S |
| 不集成代价 | 每次会话无系统性自检，outbox 积压 / embed 失败 / tombstone 异常只能靠 `compost doctor` 手动触发，问题发现滞后 |
| 风险 | 不要做成每次 CLI 调用都触发的动作，只在 daemon startup 和 `compost doctor` 调用时生成，避免 cold-start 性能回退 |

---

### #6 — 知识缺口追踪 (Gap Tracker)

| 维度 | 详情 |
|------|------|
| Myco 源 | `docs/architecture.md` Appendix F.2 (`gap_detection`，基于 tag co-occurrence) + `MYCO.md` Self Model B 层 |
| Compost 落地点 | Phase 4 gap tracker — `facts` 表按 subject 聚合，检测 query 命中但 fact 缺失的主题；新表 `knowledge_gaps (topic, first_missed_at, hit_count, resolved_at)` |
| 集成方式 | 借设计思路 (从 miss 信号而非 tag 共现推导缺口) |
| 工程成本 | M |
| 不集成代价 | Phase 4 curiosity agent 没有 gap 持久化，无法跨会话积累 "我不知道什么" 的信号 |
| 风险 | Myco 的 tag co-occurrence 依赖 markdown 标签体系；Compost 无 tag，要从 query 失败信号和 fact subject 分布重建，实现路径不同 |

---

### #7 — 四层自我模型: 库存+退化两层先行

| 维度 | 详情 |
|------|------|
| Myco 源 | `MYCO.md:§5` 身份锚点，四层自我模型 A(库存) / B(缺口) / C(退化) / D(效能) |
| Compost 落地点 | `compost doctor` 输出增加: A=fact count by subject distribution / C=orphan fact ratio + tombstone velocity / D=embed coverage ratio；写入 `boot_brief.json` |
| 集成方式 | 只借设计思路 (4 维健康指标框架) |
| 工程成本 | S |
| 不集成代价 | 无法量化系统认知健康度，只能事后发现问题 |
| 风险 | Myco 的 D 层 (效能/dead_knowledge) 在自身实现中仍是 open problem；只实现 A+C 两层务实，B+D 等 Phase 4 再补 |

---

### #8 — 摩擦信号捕获 (Friction Signal to gap)

| 维度 | 详情 |
|------|------|
| Myco 源 | `docs/architecture.md` Hunger Sensing / Session Reflection 机制；`cli.py:566-568` `--execute` flag |
| Compost 落地点 | `packages/compost-hook-shim` → PostToolUse hook 失败事件写入 `observe_outbox` with `kind='friction'`；gap tracker 消费 friction 事件 |
| 集成方式 | 借设计思路 (hook 事件流已有，只需新增 friction 事件类型) |
| 工程成本 | S |
| 不集成代价 | 工具失败/查询 miss 信号当前完全丢弃；curiosity agent 失去重要的 "系统哪里薄弱" 数据源 |
| 风险 | hook 冷启动 p95 < 30ms 是硬约束，friction 捕获不能在 hook 层做重计算，只做轻量写 outbox |

---

### #9 — 跨会话 Session Memory (FTS5 索引)

| 维度 | 详情 |
|------|------|
| Myco 源 | `docs/architecture.md` Appendix F.3 (`memory.py` Session Memory FTS5) |
| Compost 落地点 | Phase 4 — `packages/compost-core/src/schema/0010_session_memory.sql` 新增 `session_turns (session_id, role, content, created_at)` + FTS5 虚表；`compost.ask` 检索时加入 session context |
| 集成方式 | 直接移植设计 (SQLite FTS5 已有基础设施，Compost 已知路径) |
| 工程成本 | M |
| 不集成代价 | 每次 `compost ask` 无法利用历史对话上下文，重复问题无法关联，cross-session 知识积累断链 |
| 风险 | Myco 扫描 `~/.claude/projects/*/*.jsonl`；Compost 已有 hook 机制，应从 hook 主动写入，不要依赖外部目录扫描 |

---

### #10 — 进化引擎: 里程碑回顾触发器

| 维度 | 详情 |
|------|------|
| Myco 源 | `docs/architecture.md` 自进化引擎 Milestone Retrospective 三必答问题 |
| Compost 落地点 | `packages/compost-daemon/src/scheduler.ts` — 新增 `startMilestoneScheduler` (每周触发)，生成 health diff 报告写入 `observe_outbox` |
| 集成方式 | 只借设计思路 (3 个诊断问题框架，机械生成指标 diff) |
| 工程成本 | S |
| 不集成代价 | Compost 只有被动 reflect，无 double-loop 学习：系统变差时无信号，调参靠直觉 |
| 风险 | Myco 的 Milestone Retrospective 需要 Agent 写 wiki，Compost 应简化为生成结构化 JSON diff，不产生 markdown 文件 |

---

## 2. Reject 清单

### R1 — `_canon.yaml` SSoT + 29 维 lint 体系 (候选 B)

**技术缺陷**: Myco 的 lint 体系 (`src/myco/immune.py`) 153 KB 单文件，29 个 lint 维度，检查对象是 markdown/YAML 文件系统。Compost 的 "canon" 已经是 SQLite schema (9 migrations, 20 tables) + TypeScript 类型系统。将 `_canon.yaml` lint 引入意味着在已有强类型 + migration 机制之上再叠一层 YAML SSoT，产生两套真相来源。

具体缺陷: L0-L3 检查的是文本文件一致性 — 这在 Myco 的 markdown 基础设施中有意义；在 Compost 的 SQLite schema 中，类型一致性由 Bun TypeScript 编译器 + migration 保证，lint 是冗余层。L7/L8/L12 等 wiki 格式检查根本不适用 Compost。引入后维护成本 >> 收益。

### R2 — 四层自我模型完整版含 D 层效能 (候选 G 完整实现)

**技术缺陷**: Myco 自评 D 层 (`dead_knowledge` 追踪 + 自适应阈值 + 自动淘汰) 为 "open problem"，在自身系统都未收敛。`MYCO.md:§5` 明确: "完整 D 层仍需自适应阈值 + 自动淘汰工作流"。将一个原系统自己标记为 open problem 的层移植进来，引入的是问题而非解法。Compost 的 tombstone + decay formula 已覆盖核心需求，D 层只需从 `access_log` 衍生指标，不需要独立的 `dead_knowledge` 概念。

### R3 — 跨项目蒸馏 (候选 F: Cross-Project Distillation)

**技术缺陷**: Myco 的 Cross-Project Distillation 是 agent 在 `log.md` 末尾标记 `g4-candidate`，然后手动蒸馏到框架文档。这是一个 Agent 工作流约定，不是可编码的机制。Compost 的定位是个人第二大脑 (单项目，不是多项目 agent framework)。将"跨项目"概念引入 Compost 需要重新定义 "project" 边界 — Compost 目前无 project 表，所有知识共享一个 namespace。实现这个功能需要 Phase 5+ 的 multi-host 基础设施，引入时序错误。

### R4 — 生物学隐喻术语系统 (顺带 reject)

**技术缺陷**: Myco 系统中大量术语 (hunger/metabolism/immune/excrete/mycelium) 在用户层 CLI 暴露。这些不只是命名问题 — 它们反映了 Myco 的设计假设: agent 是唯一操作者，用隐喻降低 agent 的工具选择成本。Compost 是人直接操作的 CLI，用户看到 `compost excrete` 而非 `compost delete` 会产生认知摩擦。Myco 术语体系整体不可移植，只能取机制不取名称。

---

## 3. 候选 A-J 逐一裁决

| 代号 | 候选 | 裁决 | 一句话理由 |
|------|------|------|-----------|
| A | compost health check (boot-time) | **accept (modify)** | 实现为 `compost doctor --brief` 写入 `boot_brief.json`，不引入 "hunger" 术语；S 成本，Phase 4 |
| B | `_canon.yaml` lint 体系 | **reject** | Compost 的 SSoT 是 SQLite schema + TS 类型，再叠 YAML lint 是双重真相来源 |
| C | Craft Protocol 置信度阶梯 | **accept (modify)** | 只取 3 级阈值定义用于 `facts.confidence` 语义分级，不引入 L13/L15 lint 体系 |
| D | graph density 结构退化指标 | **accept (modify)** | 改为 fact 孤立比率 (orphan facts / total facts)，SQLite 查询即可，不需要外部 graph 库 |
| E | 压缩三判据 | **accept** | 频率+时效+排他性直接扩充 `reflect()` tombstone 逻辑，纯 SQL，S 成本 |
| F | Cross-Project Distillation | **reject** | Compost 单 namespace，实现需要 multi-host 基础设施，时序错误 |
| G | 四层自我模型 | **accept (modify)** | 只实现 A 库存 + C 退化两层，D 层是 Myco 自己的 open problem，B 层等 gap tracker Phase 4 |
| H | Signal-to-Action hunger 闭环 | **accept (modify)** | 改为 `compost doctor --auto-fix` 执行预定义修复动作 (rebuild L1, prune orphans)；去掉 `hunger` 术语 |
| I | Forage manifest (主动觅食) | **accept (modify)** | SQLite `crawl_queue` 表替代 YAML manifest，保留 `why` 强制字段和 status lifecycle 设计 |
| J | Continuous Compression + Semantic Cohort | **accept (modify)** | 压缩三判据 (E) 已覆盖，Semantic Cohort 改为 fact subject clustering (SQL GROUP BY + cosine)；不引入外部 cohort 库 |

---

## 4. 务实工程独特视角 (≤200 字)

其他参与者可能聚焦于机制的完整性和理论优雅性，我要指出一个纯工程维度: **Myco 的核心设计缺陷是单文件巨型化** — `notes.py` 115 KB、`immune.py` 153 KB、`cli.py` 超长。这不只是代码风格问题：它反映了 Myco 在 Agent-First 场景下，为了让 agent 通过 MCP 一次加载完整上下文，刻意把所有逻辑集中在少数文件里。这个假设在 Compost 中不成立 — Compost 是人驱动的 CLI，模块边界应该服务于人的可维护性，而非 agent 的上下文窗口效率。

集成时，每一个来自 Myco 的机制都应该问: "这个设计是因为问题本质需要，还是因为 Myco 是 Agent-First 而 Compost 不是？" 压缩判据、孤立检测、健康指标 — 机制本身是好的；但 hunger CLI + YAML manifest + 29 维 lint 背后的 "agent 是唯一读者" 假设在 Compost 中不成立，不能照搬。取骨，弃皮。
