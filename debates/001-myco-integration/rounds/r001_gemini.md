# Myco-to-Compost 架构集成分析 (Gemini 视角)

作为生态与战略视角的辩论者，我关注的不仅是代码的迁移，而是如何将 Myco 的“代谢自主性”与 Compost 的“结构化工程”结合，形成一个在 LLM 快速演进中具有长期可维护性的生态位。

## 1. Top 10 Integrate 清单

### Item 1: 信号到行动 (Signal-to-Action) 闭环
- **Myco 源**: `src/myco/notes.py::compute_hunger_report` + `myco_hunger(execute=true)`
- **Compost 落地点**: `packages/compost-daemon/src/scheduler.ts` (新增 `RequirementExecutor`)
- **集成方式**: 重新实现。将 Myco 的 `hunger` 信号抽象为 Compost 的 `Requirement` 对象，Daemon 不再只是周期性运行，而是根据信号优先级（如事实冲突、知识缺口）动态调整任务权重并执行。
- **工程成本**: M
- **不集成的代价**: 基质处于被动响应状态，无法实现真正的“自主代谢”。
- **风险/反模式警告**: 避免在没有人工确认的情况下执行破坏性变更（如 prune）。

### Item 2: C 层 - 结构性退化检测 (Structural Decay)
- **Myco 源**: `src/myco/mycelium.py::find_orphans` + `compute_hunger_report` Organ 3
- **Compost 落地点**: `packages/compost-core/src/cognitive/reflect.ts` (新增 `detectStructuralDecay`)
- **集成方式**: 借用设计思路。在 SQLite 中通过递归 CTE 计算事实图（L2 Facts）的连通性、孤岛率和聚类熵，发现基质组织方式的劣化趋势。
- **工程成本**: M
- **不集成的代价**: 随着数据量增长，基质会演变成“知识癌变”，局部正确但全局混乱。
- **风险/反模式警告**: 必须区分“新知识的暂时孤立”与“旧结构的陈旧腐烂”。

### Item 3: 26 维基质免疫系统 (Immune System Lint)
- **Myco 源**: `src/myco/immune.py` (L0-L25 全量 lint)
- **Compost 落地点**: `packages/compost-cli/src/commands/doctor.ts` (扩展校验维度)
- **集成方式**: 直接移植逻辑。将 Markdown 维度的校验转化为对 SQLite 表间一致性、LanceDB 向量覆盖率以及 FTS5 索引完整性的校验。
- **工程成本**: L
- **不集成的代价**: 随着迁移和策略更新，基质内部的一致性契约（Contract）会迅速崩溃。
- **风险/反模式警告**: 严禁将 lint 仅作为 CLI 工具，必须集成进 CI 和 Reflect 循环。

### Item 4: 决策账本 (Craft Protocol)
- **Myco 源**: `docs/craft_protocol.md` + `src/myco/immune.py::lint_craft_protocol`
- **Compost 落地点**: `L4 Procedural Memory` (新增 `craft_decisions` 表)
- **集成方式**: 直接移植。将架构决策过程（辩论、攻击、防御、裁决）结构化存储，作为 L4 过程性记忆的一部分。
- **工程成本**: S
- **不集成的代价**: 失去对知识库演进逻辑的可追溯性，无法在 2027 年理解 2026 年的决策背景。
- **风险/反模式警告**: 防止为了通过 lint 而编写“空洞辩论”。

### Item 5: 压缩即认知 (Compression Doctrine)
- **Myco 源**: `docs/architecture.md` §4 "不遗忘，只压缩"
- **Compost 落地点**: `packages/compost-core/src/cognitive/wiki.ts` (Wiki 重新合成逻辑)
- **集成方式**: 重新实现。将 Wiki 视为 L2 事实的“有损压缩视图”，当 L2 事实密度或压力（Compression Pressure）超过阈值时，自动触发 Wiki 重写。
- **工程成本**: M
- **不集成的代价**: 注意力被海量碎片化事实淹没，无法形成高阶认知模型。
- **风险/反模式警告**: 压缩过程必须保留原始出处（Provenance）的溯源链。

### Item 6: 基于缺口的觅食 (Gap-driven Ingest)
- **Myco 源**: `src/myco/forage.py` + `inlet_ripe` 信号
- **Compost 落地点**: `packages/compost-daemon/src/scheduler.ts` (新增 `CuriosityWorker`)
- **集成方式**: 借用设计思路。当 `compost.query` 出现搜索未命中（Search Miss）或查询分布极度不均时，自动触发针对性 Ingest 任务。
- **工程成本**: M
- **不集成的代价**: 知识库仅限于被动接收，无法针对未知领域进行“自主扩张”。
- **风险/反模式警告**: 必须设置摄取速率限制，防止由于单一搜索词导致的“爬虫风暴”。

### Item 7: D 层 - 死知识淘汰 (Dead Knowledge Excretion)
- **Myco 源**: `src/myco/notes.py::auto_excrete_dead_knowledge`
- **Compost 落地点**: `packages/compost-core/src/cognitive/reflect.ts` (扩展 `reflect` 逻辑)
- **集成方式**: 直接移植。利用 Compost 已有的 `access_log`，对长时间未被读取、引用或验证的事实进行清理。
- **工程 --------- 成本**: S
- **不集成的代价**: 存储通胀导致的检索噪声增加，系统信噪比持续下降。
- **风险/反模式警告**: 淘汰不等于删除，必须保留在 `archived_at` 或 `superseded_by` 状态。

### Item 8: 进化策略变异 (Meta-loop Evolution)
- **Myco 源**: `src/myco/evolve.py` (Mutation-Selection 逻辑)
- **Compost 落地点**: `packages/compost-core/src/policies/` (新增进化机制)
- **集成方式**: 重新实现。对 `tp-YYYY-MM` 系列策略（如提取 Prompt）进行变异，并通过 `reflect` 中的验证反馈进行优胜劣汰。
- **工程成本**: L
- **不集成的代价**: 固定的 Prompt 无法适应 LLM 能力的变化，策略会逐渐过时。
- **风险/反模式警告**: 进化必须在“硬约束门”（Hard Gates）内进行，严禁变异核心契约。

### Item 9: 入口出处契约 (Inlet Provenance Contract)
- **Myco 源**: `src/myco/notes.py::OPTIONAL_FIELDS` (inlet_origin, inlet_method)
- **Compost 落地点**: `observations` 表 (Schema 扩展)
- **集成方式**: 直接移植。在 L0 观测层强制要求 `origin_hash` 和 `method_fingerprint`，确保每一条事实都能回溯到物理世界的源点。
- **工程成本**: S
- **不集成的代价**: 失去“事实真理性”的基础，无法在存在矛盾时进行置信度仲裁。
- **风险/反模式警告**: 避免过度采集隐私元数据。

### Item 10: 语义群体智能 (Cohort Intelligence)
- **Myco 源**: `src/myco/notes.py` §Cohort detection
- **Compost 落地点**: `packages/compost-core/src/query/search.ts` (新增 `SemanticGrouping`)
- **集成方式**: 重新实现。利用 LanceDB 的向量距离，在检索和压缩时将相似事实视为“群体”，整体评估其重要性和时效性。
- **工程成本**: M
- **不集成的代价**: 无法识别重复信息的积累，导致冗余认知负载。
- **风险/反模式警告**: 聚类算法的漂移可能导致不相关事实被错误地“打包”压缩。

---

## 2. Reject 清单

- **Item**: Myco 的 Markdown+YAML 存储体系
- **拒绝理由**: 技术性能缺陷。Myco 依赖文件系统扫描和正则表达式解析。在大规模（>10k 事实）场景下，这会导致 `hunger` 和 `lint` 耗时呈指数级增长。Compost 必须坚持 SQLite 为核心，Markdown 仅作为 L3 Wiki 的“导出格式”。

- **Item**: 显式的“生物学隐喻”术语 (Eat, Excrete, Mycelium)
- **拒绝理由**: 品牌与生态定位冲突。Compost 的定位是“Personal Knowledge Base”，生物学词汇会提高用户的认知门槛并引发不必要的安全疑虑。应统一使用 `Ingest`, `Prune`, `Graph` 等标准工程术语。

- **Item**: 手动触发的“Gear”换挡模型
- **拒绝理由**: 用户体验倒退。Myco 早期版本需要人类决定何时“反思”。Compost 的目标是 `Daemon-First`，所有的代谢行为应由系统根据 `Requirement` 信号自主决策，人类仅作为 Audit 层。

---

## 3. 对已列候选 A-J 逐一裁决

| 代号 | 裁决 | 一句话理由 |
|---|---|---|
| A compost hunger | accept | 信号驱动的自愈是核心，改名为 `compost requirement` |
| B _canon.yaml lint | accept | 契约驱动的治理是 Compost 长期稳定的保障 |
| C Craft Protocol | modify | 记录在 SQLite L4 层，而非仅作为 Markdown 文件 |
| D graph density | accept | 解决“结构性退化”这一未解难题的关键指标 |
| E compression doctrine | accept | 将 Wiki 合成正规化为一种“认知压力释放”机制 |
| F cross-project distillation | reject | 当前阶段应专注单机性能与隔离，跨项目逻辑由 Agent 侧处理 |
| G 四层自我模型 | accept | 完美对应 Compost 的 L0-L4 结构，补强 C/D 层定义 |
| H signal-to-action | accept | 消除“感知到问题却不解决”的死循环 |
| I forage manifest | modify | 集成进 `web_fetch_state`，作为“待摄取”的优先级队列 |
| J continuous compression | accept | 由 `compression_pressure` 信号触发的背景合成 |

---

## 4. 你的独特视角

我看到其他人忽略的一个维度是：**“认知基质的可迁移性契约 (Portability Contract)”**。

目前的讨论集中在如何“吞噬”和“存储”，但从生态位来看，Compost 最大的风险是**“知识闭锁”**。Myco 的 `evolve.py` 展示了策略演进的可能性，但 Compost 需要更进一步：**将提取策略 (tp-2026-xx) 与数据本身解耦**。

如果我们集成了 Myco 的进化引擎，我们需要确保：即使底层模型从 gemma3 换成 Claude 4，或者数据从本地迁移到云端，我们的 L0 溯源账本永远是可重读、可重提取的。这意味着 L1-L3 层必须被视为“可丢弃的衍生物”。我们要集成的不是 Myco 的代码，而是它的**“核契约 (Kernel Contract) 意识”**——数据可以腐烂，但提取事实的逻辑和决策过程（Craft）必须作为“人类文明的备份”永久留存。

DONE_R1_GEMINI
