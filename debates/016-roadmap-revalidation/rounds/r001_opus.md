# Debate 016 · Round 1 · Opus (10-year maintenance lens)

**立场**: 把今天的每一行代码放到 2036 年的维护者桌上再判。不关心"这季度能不能 ship"，关心"五年后有没有人敢动这块"。

---

### Q1 — MODIFY

**Opus position**: 粒度悖论是真的，但真正的病不是"大小倒挂"，而是把两套系统硬绑在一条"大小-深度"轴上描述，10 年后这条叙事一定崩。

**10-year reasoning**:
"笔记本 vs 图书馆" 是营销话术，不是架构不变量。10 年维护者看到的是两个 SQLite + 两个 schema + 两套 ranking，他只会问"为什么这条记忆必须在 Engram 不在 Compost"。如果答案依赖"字符数"或"句数"，5 年内会出现大量 200-800 字的中间态记忆，routing 变成猜谜，两边都塞。字节数不是稳定的架构边界，**写入频率 + 读延迟 SLO** 才是。Engram 的真正不变量是"每次 LLM call 前都要读，必须 <50ms 确定性"，Compost 是"按需查，可以 3-10s"。粒度只是这两个 SLO 的副作用，不该当成定义。

**Boundary erosion risk**:
5 年内，用户和 agent 会开始往 Engram 塞"小段落"（因为"反正 <200 字不算大"），往 Compost 塞"一句话 fact"（因为"反正是库"），两边 schema 慢慢对齐，最后成两个功能 80% 重合的库，差异只在 MCP server 名字。

**Concrete alternative**:
放弃按"大小"描述，改按 **读路径 SLO** 描述，并写进 schema 注释和 CONTRIBUTING：
- Engram: 每条记忆必须能在"LLM call 前置注入预算"内被检索和序列化（p95 <50ms，单条 <500 tokens 序列化后）。超限 reject 写入。
- Compost: 每条 fact 必须有 `source_fact_ids` 和 `synthesis_layer`，没有就是非法记录。
两边 schema 加 CHECK constraint 强制执行（Engram 加 `length(content) < 2000`，Compost 加 `source_fact_ids IS NOT NULL OR layer = 'L0'`）。10 年后维护者看 schema 就知道边界在哪，不靠文档。

---

### Q2 — REJECT

**Opus position**: v3.5 Compost→Engram 写回，写入 `origin=compiled` 就安全 —— 是典型的"今天写得清楚，5 年后没人记得"陷阱。信任模型会塌，而且是悄悄塌。

**10-year reasoning**:
"zero-LLM promise" 是 Engram 的**唯一**技术护城河描述（相对 LycheeMem / Letta / GBrain 都在堆 LLM 的世界）。一旦允许 `compiled` 记忆进 Engram 表，3 年内会发生三件事：(1) 有人觉得"compiled 也不错，proactive 推送一下吧"，加一行 flag；(2) ranking 的 `effective_score` 开始区分 origin 权重，逻辑从"确定性排序"变成"信任加权排序"，再无法向用户解释；(3) 新贡献者看到表里已经有 compiled，觉得"再加一个 synthesized origin 也合理"。**origin 字段作为软边界，抵御不了 10 年的熵**。GPT-5.4 "NO background rewriting" 约束已经说了，你现在开的是同一个口子，只是换了名字叫 cache。

更致命：用户在 recall 看到结果时，**无法**仅凭 UI 区分"FTS5 命中的 human 原句"和"Compost 合成后 cache 回来的 compiled 条目"。即使 API 分开，CLI 和 MCP 输出混在一起排序，信任信号就丢了。一旦用户被幻觉误导一次，整个 Engram 的"可靠便签"定位就废了。

**Boundary erosion risk**:
3-5 年：compiled 比例从 5% 涨到 40%（因为自动写回比人类写入快得多），Engram 实质变成 Compost 的热缓存，而不是独立记忆层。那时候回头看"zero-LLM"承诺已是空文。

**Concrete alternative**:
**Compost 的缓存不进 Engram 表**。如果真要缓存 Compost 答案加速，走独立路径：
- 新建 `engram_compost_cache` 表（独立 schema，独立 MCP tool `recall_compost_cache`），**不进** `recall()` 的默认结果，不参与 `effective_score` 排序。
- CLI / MCP 输出上 compost cache 结果用独立 section（类似 `--- from compost cache ---`），用户一眼区分。
- Engram 核心表加 CHECK constraint: `origin IN ('human', 'agent')`，schema 层禁止 compiled。`compiled` origin 保留给 `engram compile` 命令的**只读导出**产物，不回写主库。
这样 10 年后无论接手者是谁，看 schema 就知道 Engram 主表 100% non-LLM，缓存是独立配件，关掉不影响核心。

---

### Q3 — MODIFY

**Opus position**: 跨项目护城河是真的，但 Engram 当前用 "guardrail/constraint 跨项目" 来论证就是错的。命中率会很低，10 年后看是自欺欺人。真正跨项目的是 **meta-procedure 和 meta-guardrail**（关于"如何工作"而非"这个项目怎么做"）。

**10-year reasoning**:
"~/.compost 禁止 iCloud"、"这两个 migration 不能并行" 这类都是强项目绑定，跨项目召回反而是噪音（甚至危险 —— 把项目 A 的约束套到项目 B）。5 年后如果用户有 20 个项目，跨项目召回命中率会掉到个位数百分比，用户慢慢就关掉了，功能变成死代码。但是 **"用户偏好 TDD"、"用户讨厌 em dash"、"用户只用 uv 不用 pip"、"永远先读 manifest"** 这类 meta 级记忆是真正跨项目的，命中率高且价值高。当前 schema 没有区分这两类，全靠 `project=None` 的约定，弱得离谱。

**Boundary erosion risk**:
2 年内用户会发现跨项目召回误伤多次（比如项目 A 的"用 websocket"被套到项目 B），开始在 `project` 字段上做手动过滤，护城河功能废掉。或者反过来 —— 被误伤怕了，所有人全加 project tag，跨项目召回永远不触发，功能形同虚设。

**Concrete alternative**:
把"跨项目"作为 schema 一等字段而非字段缺省值：
- 新增 `scope` enum: `project` / `cross_project` / `meta` (关于用户/agent 自身的)。
- `cross_project` 和 `meta` 必须在写入时显式声明，不能从 `project=None` 推断。
- `recall()` 默认只查当前项目 + meta，`cross_project` 需要显式 flag。
- `meta` 级记忆进 SessionStart hook 默认注入，`cross_project` 只在 recall_miss 时降级 fallback。
这样 10 年后维护者看 schema 就知道跨项目是刻意的小集合，不是大杂烩。

---

### Q4 — REJECT

**Opus position**: v3.4 suggest_ingest 本身功能可以 ship，但用 "Engram recall_miss → Compost ingest" 这条链路做 MVP 是在 10 年维护成本上最贵的选择。

**10-year reasoning**:
Compost 已经有 observe hook + file watch + web fetch 三条入口，都是"源驱动"（有明确的内容源）。Engram recall_miss 是"缺失驱动"（只有一个查询失败的信号，没有内容）。这意味着 Compost 收到 suggest_ingest 后必须**反向去找内容**（查询什么？从哪里找？问谁？），而 recall_miss 的信号极其稀疏，5 年后日志里 90% 的 suggest 会是"查了个不该存在的东西"，剩下 10% 才是真有价值的缺口。边际价值约等于 0，但维护成本是一条跨进程异步链路（outbox + 去重 + 幂等 + TTL），**这是最糟糕的成本结构**。

更隐蔽的问题：这条链会让两个系统的时间模型耦合。Engram 的 recall 频率是 "每次 LLM call"，Compost 的 ingest 节奏是"偶发"。用 outbox 异步隔离是对的，但 10 年后 outbox 表会堆积未消费消息、失败重试、格式漂移，是典型的"加时容易减时难"的结构。

**Boundary erosion risk**:
outbox 表会变成两个系统的"垃圾中转站" —— 最初只放 suggest_ingest，两年后有人加 "also notify Compost on engram forget"、"also notify on consolidate"，schema 变成 union type，消费者必须 switch-case，最终没人敢删任何一种消息类型。

**Concrete alternative**:
- v3.3 先 ship（recall_miss 只写**本地**日志，不跨系统）。
- 让 recall_miss 日志积累 3-6 个月，看真实模式：**如果 miss 的是"用户明显问过但没存"的内容，那 suggest_ingest 有价值；如果 miss 的是"查了个幻觉"，直接废弃此特性**。
- 只有在本地日志证明真有价值后，才 ship v3.4。即使 ship，也用**同步 API 调用**（Compost 暴露 HTTP endpoint，Engram 直接 POST，失败就 drop），**不引入 outbox**。异步解耦是架构终态，但不是 MVP 阶段该背的复杂度。
- 省下来的 50 LoC 加到 v3.3 的 WAL/FTS5 audit 和 kind-lint 上，那些是 10 年后你还会感激的工具。

---

### Q5 — SUPPORT（保持双栈，但理由和 015 不一样）

**Opus position**: 双栈该保，但不是因为"功能互补"，而是因为**双栈才能保住 Engram 的确定性 SLO 和 Compost 的 LLM 实验自由度**。合并 = 两边都退化。

**10-year reasoning**:
统一栈听起来省维护，实际 10 年后会是这样：一个 SQLite 库既要扛 "每次 LLM call 前读" 的 50ms SLO，又要扛 "多层 LLM 合成 10K facts" 的批处理。这两种负载的索引策略、WAL 调优、vacuum 策略完全冲突。合并后必然走到"读写分离 + 读副本"，复杂度反而爆炸。**物理分库是最简单的读写隔离**。

另外维护成本 2 DBs / 2 MCP / 2 CLI 听起来吓人，但：
- 2 DBs: 独立 SQLite 文件，维护成本近 0（不是两个 Postgres 集群）。
- 2 MCP: FastMCP 复用 90% 代码，成本是一次性的。
- 2 CLIs: 独立二进制更清晰，比一个带 20 个子命令的 CLI 更可维护。
- 2 CI rules: 本来就该分开（Engram 的 zero-LLM 约束和 Compost 的 source_fact_ids 约束本质不同）。

真正的 10 年风险不是"双栈累"，是**合并后丧失了"能独立 kill 其中一个"的可选性**。如果 5 年后发现 Compost 的 LLM 多层合成是技术死路（比如 embedding + graph 范式被某个更好方案取代），双栈下可以独立弃掉 Compost 保 Engram；合并栈下要大手术。

**Boundary erosion risk**:
如果合并，2 年内 Compost 的 LLM 写入路径会污染 Engram 的确定性排序（因为两表同库，join 太方便），SLO 保不住。4 年内用户再无法理解"哪些记忆是 LLM 生成的"。

**Concrete alternative**:
保持双栈，但**显式声明 10 年的 kill-switch 可选性**写进 ARCHITECTURE.md：
- 两个系统之间**只有一条耦合**（v3.5 writeback），写清楚"Engram 在没有 Compost 时必须 100% 功能可用"（kill Compost 时删掉 `engram_compost_cache` 表即可）。
- CI 加一条 rule: Engram 核心代码不得 `import compost_*`，只能通过 MCP/HTTP 接口。
- 每年 review 一次"如果明天砍 Compost，Engram 要改多少代码" —— 超过 50 行就是耦合超标，要重构。

---

## 最担心的长期风险（Opus 独立观察）

1. **测试生态的单点失败**：99 个测试全在 pytest 里，全覆盖当前实现，但**没有一条"架构约束测试"** —— 比如"Engram 核心路径不得调用任何 LLM"、"Compost fact 必须有 source_fact_ids"、"跨系统耦合点不超过 1 个"。这类约束写在 CLAUDE.md 和 CONTRIBUTING.md 里 3 年后没人读，必须变成**可执行的 linting/CI 测试**。否则 10 年后维护者看到 99 个 passing tests 却不知道"哪些设计是刻意的、哪些是偶然的"。建议 v3.3 就加 `tests/test_architecture_invariants.py`，用 AST 静态扫描 + schema introspection 把核心约束变成可执行断言。

2. **MCP 协议锁定**：当前 MCP 是 2025-2026 年热门，但 10 年窗口里它大概率会被取代（类比 LSP 之前的各种协议）。Engram/Compost 的对外接口 90% 绑在 FastMCP 上，CLI 是薄壳。**MCP 协议淘汰那天，两个系统都要大改**。建议核心 API 层（store.py/compost core）与 MCP server 层彻底解耦，server.py 只做 protocol adapter，核心逻辑必须能被 HTTP / gRPC / 直接 Python import 同等调用。这是 10 年可移植性的最小防线。

3. **SQLite 的"够用陷阱"**：500 memories / project × N 项目，今天够用。但 10 年后用户项目数可能 200+，单库记忆 50K+，FTS5 的 p95 会从 <50ms 漂到 200ms+。届时从 SQLite 迁移的成本**极高**（schema 已硬编码、FTS5 语法已渗透所有查询）。建议从 v3.3 开始所有检索路径走一层薄 repository 抽象，而不是直接写 SQL。这不是"提前优化"，是"保留未来替换的可能性"，成本极低（~20 行），但 10 年后可能救命。
