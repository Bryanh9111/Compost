# Round 1 — Gemini 立场（生态位视角）

> **注意**: gemini-2.5-pro 配额耗尽（RetryableQuotaError 429，10 次重试后失败）。
> 本文件由 **gemini-2.5-flash** 实际生成（真实 Gemini CLI 调用），非 Sonnet 模拟。
> 标注: GEMINI_DEGRADED_MODEL (flash, not pro)

---

### Q1 — REJECT
**Gemini position**: 粒度描述反直觉——"便条夹"(Engram) 条目 ~200 字符，而"图书馆"(Compost) facts 1-5 句（更短但更深），颠覆了用户对两者的期望。

**Ecosystem reasoning**: Letta/MemGPT 的架构中，core_memory 条目短暂且简洁，archival_memory 条目更长更结构化——这是行业惯例。Engram+Compost 目前翻转了这一模式：working memory 反而更长，deep knowledge 反而更短。mem0 的 embedding 记忆也遵循"工作记忆密集、长期记忆精炼"的原则，Engram 的命名与实际粒度存在认知错位。

**Market signal**: 用户直觉期望 working memory = 短暂/轻量，deep knowledge = 结构化/可能更长。当命名与实际尺寸倒置时，onboarding 成本上升。

**If REJECT, concrete alternative**: 明确重新定义 Compost facts 为"高度提炼的信息密度单元"（强调 dense 而非 small），或将 Engram 典型条目长度收窄至 ≤80 字符以真正符合"便条"定位。

---

### Q2 — MODIFY
**Gemini position**: `compiled` origin 标签在技术上可区分，但从内容来源角度，LLM 产物进入 Engram 破坏了"零 LLM"的品牌感知，虽然运行机制仍是 zero-LLM。

**Ecosystem reasoning**: Engram 的"零 LLM"是区别于 mem0、ChromaDB-mem 等 embedding-native 竞品的核心差异化点。这些竞品的记忆都是 LLM 产物；Engram 的可信赖性正建立在"FTS5 确定性"之上。一旦用户发现 `compiled` 条目混入，即使有标签，也可能质疑整个系统的确定性。LycheeMem 等轻量方案完全没有这个混淆问题。

**Market signal**: AI 系统中内容溯源透明度正成为用户信任核心诉求，混合 provenance 会增加调试难度和心智负担。

**If MODIFY, concrete alternative**: 将"zero-LLM"重新定位为"零 LLM 运算"（operational zero-LLM），并在 recall 输出中为 `compiled` origin 添加视觉/文本标记（如 `[LLM-cached]` 前缀），使用户在 recall 时一眼识别，而非仅在数据模型层面区分。

---

### Q3 — REJECT
**Gemini position**: 跨项目复用护城河被"强项目作用域的 guardrail/constraint"自我否定，实际命中率远低于声称。

**Ecosystem reasoning**: 大多数竞品（Letta、mem0）都是隐式或显式地项目作用域化的——跨项目受控共享如果真能实现是一个差异化点，但前提是不被自身限制条款阻断。当前 Engram 的护城河叙事与 guardrail 设计逻辑互相矛盾：越严格的 guardrail 越项目私有，越私有则越无法跨项目复用。竞品不会有这种自我否定。

**Market signal**: 护城河必须清晰且可实现。一个无法实现其核心承诺的功能会在市场上迅速失去可信度。

**If REJECT, concrete alternative**: 重新评估 guardrail 作用域规则，允许显式标记为 `shareable: true` 的记忆跨项目共享；或将护城河转移到更可靠的差异化点（如"session cold-start 消除速度"或"多模型兼容的 MCP 接口"）。

---

### Q4 — SUPPORT
**Gemini position**: Engram miss 信号是一个低成本高杠杆的动态反馈环，50 LoC 赋予系统自我学习能力，战略价值超出"第四条输入路径"的表面描述。

**Ecosystem reasoning**: 自适应、自改进的记忆系统是竞争优势所在。mem0 依赖用户显式写入或 LLM 提取，缺少"工作记忆缺口驱动深层知识富化"的闭环。这一 miss 信号机制是 Engram+Compost 双栈相对于单栈竞品的独特架构优势，是 Letta 的 archival_memory 无法自然提供的。

**Market signal**: 自动化学习和系统智能是 AI 应用的高价值特性，以极低代码成本实现核心反馈环是强正向信号。

---

### Q5 — SUPPORT
**Gemini position**: Engram（零 LLM，<50ms）与 Compost（LLM 驱动，3-10s）的运算特性差异足以支撑双栈架构，强行合并会在延迟或概念清晰度上两头妥协。

**Ecosystem reasoning**: Letta 的 core_memory+archival_memory 单栈架构表明分层记忆有价值，但 Letta 是为 LLM agent 设计的统一 LLM 运行时，而 Engram 的核心差异化恰恰是"无 LLM 运算"。若 Compost 吸收 Engram，要么 Compost 必须支持零 LLM 快速路径（架构复杂度翻倍），要么 Engram 的 <50ms 保证消失（丧失 proactive recall 的实用性）。mem0 单栈的代价是延迟不可控。

**Market signal**: 针对不同性能需求的专用组件优于试图同时服务所有需求的复杂单体系统，这在基础设施领域已是共识。

---

## 最担心的生态风险

1. **"零 LLM"品牌侵蚀** — `compiled` origin 写回 Engram，即使有标签也会在用户心智中模糊"确定性 FTS5 系统"的定位。mem0 等竞品从不声称零 LLM，因此没有这个品牌风险；Engram 一旦失去这一差异化，对抗 embedding-native 竞品将毫无优势（无语义搜索 + 无 LLM = 纯关键词匹配，用户为何不直接用 grep？）

2. **跨项目护城河自我否定** — 若 guardrail 始终强项目作用域，"Project A 经验迁移 Project B"的核心价值主张永远是营销话术而非实际功能。竞品只需在 README 里加一行"支持跨项目记忆共享（无限制）"即可在这个维度碾压。

3. **无语义搜索的长期 recall 质量天花板** — v6 embedding 被永久砍掉，随着记忆库增长（500+条），纯 FTS5 关键词召回的 recall miss rate 将上升。mem0 和 ChromaDB-mem 的语义搜索能召回用户"忘记用什么词描述"的记忆；Engram 只能召回用户"恰好用了相同关键词"的记忆。这是一个随规模线性恶化的竞争劣势。
