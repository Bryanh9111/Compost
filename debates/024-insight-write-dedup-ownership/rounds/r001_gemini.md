# Round 1 — Gemini — Debate 024

针对 Compost 产生的重复 insight 写入问题，我选择方案 **(a) Engram 侧加约束**。这不仅是一个技术实现的选择，更是对“记忆系统”与“应用逻辑”边界的权衡。

## 选择 (a) Engram 侧加约束

从架构设计的“关注点分离”（Separation of Concerns）原则出发，Engram 作为事实上的 Memory Store，其核心职责是维护记忆的**完整性**（Integrity）和**一致性**（Consistency）。

1.  **约束语义的归位**：
    `root_insight_id` 本质上是该段记忆的“身份指纹”。如果一个存储系统允许具有相同身份标识的两个实体共存，那么该系统就退化成了一个单纯的 Log。Engram 的目标是作为 AI 的长期记忆，它应当具备识别“重复信息”的能力。将唯一性约束（UNIQUE INDEX）放在数据库层，是利用基础设施来保证业务逻辑的“物理不可违背性”。

2.  **多客户端安全的唯一保证**：
    Conway's Law 告诉我们，系统的结构反映了组织的沟通结构。Compost 目前是唯一的 producer，但未来可能出现专用的 `compost-web` 仪表盘、自动化 aggregator 或是 cross-project synthesizer。如果我们将去重逻辑放在 Compost 侧（方案 b），那么每一个新的 producer 都必须重新实现这套逻辑。这不仅造成代码冗余，更极易因实现差异（如 key 算法漂移）导致数据库出现“脏数据”。方案 (a) 是 origin=compost 命名空间下的全局兜底。

3.  **避免分布式竞争（TOCTOU）**：
    方案 (b) 在客户端先 `recall` 后 `remember`。在多进程并发或网络延迟波动时，存在典型的“检查时-使用时”（Time-of-Check to Time-of-Use）竞争。而方案 (a) 利用 SQLite 的原子性约束，能够在一次 RTT（Round Trip Time）内解决冲突，性能更优且逻辑无瑕疵。

## Q1 dedup key shape
**选择：`(origin, root_insight_id, chunk_index)`**

*   **理由**：`root_insight_id` 已经通过 UUIDv5 聚合了 `project` 和 `fact_ids`（详见 `splitter.ts:46`）。由于 `splitInsight` 产生的 chunk 逻辑是确定性的，`chunk_index` 决定了内容的物理位置。
*   **为何不用 `content_hash`？**：Compost 的去重语义是“基于事实集合的等价”，而非“基于文本的完全相等”。如果 LLM 在两次推送间生成的文字稍有不同（例如语气词微调），但引用的 fact 集合未变，我们通常认为这是同一条 insight。使用 `root_insight_id` 能更好地捕捉这种“语义等价性”。

## Q2 重复时行为
**选择：Return Existing ID (Put-Semantic)**

*   **理由**：
    *   **报错 (Error 409)** 会干扰 `writer.ts:147-156` 的 `PendingWritesQueue`。如果 queue 收到一个重复写入错误，它需要具备解析错误消息并将其判定为“伪失败”的能力，这增加了客户端逻辑的脆弱性。
    *   **返回已有 ID** 实现了标准的幂等写入语义。对于 Compost 客户端，只要拿到了 ID，就意味着“目标状态已达成”，无需关心是新创还是复用。这简化了 `safeRemember` 的后续处理流程。

## Q3 约束 scope
**选择：Origin-Specific (origin='compost')**

*   **理由**：
    目前的 `source_trace` 结构及 `root_insight_id` 算法是专门为 Compost 设计的。在 Engram 中对 `origin='compost'` 应用 Partial Unique Index 是最稳健的路径。对于 `origin='human/agent'`，它们目前缺乏自然的幂等键，强行统一可能导致不可预知的写入丢失。我们应先在 Compost 路径建立范式，待其他 origin 演进出稳定的 trace 协议后再行推广。

## Q4 历史 4 行处理
**选择：保留时间最早的 2 行，物理删除重复的 2 行。**

*   **执行方案**：
    1.  找到具有相同 `root_insight_id` 且 `created_at` 较晚的行。
    2.  利用 `compost_insight_sources` 上的外键约束（应设为 `ON DELETE CASCADE`）一并清理关联表。
    3.  必须在应用索引 `idx_compost_insight_idempotency` **之前**完成清理，否则迁移会失败。

## Cross-critique

**对方案 (b) 的批判：**
方案 (b) 试图将责任推给客户端，这在单体应用时代可行，但在分布式/多客户端生态下是极其危险的。
*   **RTT 损耗**：`writeInsight` 本身就是循环内执行，如果每一片 chunk 都要先 `recall`，通信成本翻倍。
*   **契约漂移风险**：`packages/compost-engram-adapter/src/writer.ts:111` 里的逻辑非常依赖当前的 `splitter` 实现。如果未来某个客户端没用这个适配器，直接通过 MCP 调用 Engram，方案 (b) 的防线就全线崩溃。

**对方案 (c) 的批判：**
方案 (c) 过于沉重。它要求的“双层变更”涉及到 Engram 的 SDK 契约变动。
*   如果 `remember` 返回值改为 `{id, status: "created" | "existing"}`，所有现有的 Engram 客户端（甚至包括那些非 Compost 客户端）可能都需要适配新的类型定义。在当前 Phase 5/6 快速迭代期，这种 Break-change 的协调成本太高。方案 (a) 配合“返回已有 ID”可以在不改变基础 Response 结构的前提下解决问题。

## 关于代码中的不一致性点拨 (Context Audit)
在 `packages/compost-engram-adapter/src/splitter.ts:46` 中，`key` 的构造方式是：
`(project ?? "") + "|" + sorted.join(",")`
但 `context.md` 中引用的 snippet 显示是 `${project}:${sorted.join(",")}`。
**警告**：这是一个潜在的 Key 漂移风险。如果我们在迁移脚本中手动计算 `root_insight_id` 来清理历史数据，必须使用 `|` 作为分隔符，否则算出的 UUID 无法匹配现有数据。

## TL;DR
1. 方案：(a) Engram 侧加 Partial Unique Index，利用基础设施保障幂等。
2. 逻辑：(origin, root_insight_id, chunk_index) 构成的唯一键捕捉“事实集合等价性”。
3. 演进：重复写入时由 Engram 返回已有 ID，对 Compost 保持透明，保障重试队列的一致性。
