# Round 1 — Sonnet Position
**视角**: 用户心智模型 / 信任信号

---

### Q1 — MODIFY

**Sonnet position**: 粒度悖论是真实的，但不致命；问题在于命名而非设计。

**Mental model reasoning**: "图书馆 vs 便条夹"这个比喻会被用户反转——便条夹（Engram）的条目更长、更模糊，图书馆（Compost）的 facts 更短、更精确。用户第一次看到 Compost 返回 "1-5 句话的 fact" 时会困惑：这比我的 Engram guardrail 还短，为什么要多一个系统？这不会导致放弃使用，但会产生持续的心智摩擦，每次都要重新想一遍"这个该存哪里"。

**Trust signal analysis**: Engram 的 `kind` 字段（guardrail/constraint）给用户一个信任锚：这条记忆代表什么类型的承诺。Compost facts 没有等价的显式分类，用户无法快速判断"这是经过验证的事实还是 LLM 综合产物"。

**If MODIFY, concrete alternative**: 在 Compost 的 fact 输出里强制显示 `source_count` 和 `synthesis_level`（L0/L1/L2），让用户一眼知道这条 fact 来自几个原始来源、经过几层 LLM 加工。Engram 不需要改，它的 `origin` 字段已经够用。

---

### Q2 — REJECT

**Sonnet position**: v3.5 writeback 会摧毁 Engram 最核心的信任属性。

**Mental model reasoning**: Engram 当前的心智模型极简且强健：FTS5 deterministic，recall 结果 = 你或你的 agent 写进去的原话。引入 Compost writeback 后，用户做 recall 时无法区分"这是我写的 guardrail"还是"这是 Compost 的 LLM 摘要被写进来的 compiled 条目"。即使 origin=compiled 字段存在，99% 的用户不会在每次 recall 时检查 origin 列。一旦用户被一条错误的 compiled 条目坑过，他们会停止信任整个 Engram recall，而不仅仅是 compiled 条目——这是信任系统的雪崩特性。

**Trust signal analysis**: `origin=compiled` 是技术上存在但 UX 上不可见的信号。CLI 默认输出不显著区分 compiled 与 human/agent 条目时，用户无法分辨正确性来源。Engram 的 "zero-LLM" 是一个强信任承诺，破坏它的代价远超缓存收益。

**If REJECT, concrete alternative**: Compost 的 LLM 答案缓存应留在 Compost 内部（Compost 自己的 L0 ledger）。Engram 作为 writeback 目标完全错误。如果要跨系统通信，方向应该反过来：Engram recall_miss 通知 Compost，但 Compost 的结果不得反向写入 Engram。信任边界必须单向。

---

### Q3 — REJECT

**Sonnet position**: 跨项目护城河被严重高估，实际命中率低到不足以支撑核心价值定位。

**Mental model reasoning**: 用户在 Project A 写入的 guardrail（"禁止 iCloud 路径"）在 Project B 会因 path_scope 不匹配被过滤，或者即使出现也让用户困惑（"这条 A 项目的限制为什么出现在 B？"）。真正跨项目通用的经验极少：顶多是编码风格偏好、通用工具坑点。但这些信息用户早就写进 CLAUDE.md 了。Engram 的跨项目价值实际上是 CLAUDE.md 的带过期检查的数据库版本，用户的感知价值远低于宣传。

**Trust signal analysis**: 当跨项目 recall 出现时，用户无法快速判断"这条经验是否仍然适用于当前项目"。缺乏 applicability_score 或项目相似度信号，用户只能靠猜。

**If REJECT, concrete alternative**: 把跨项目定位缩小为"通用 guardrail 库"（约 20-30 条），明确标记为 `scope=global`，由用户手动提升。取消"自动跨项目经验迁移"的宣传，改为"你的全局工程原则库"。这是真实用例，不要夸大。

---

### Q4 — REJECT

**Sonnet position**: suggest_ingest 是重复的、低信噪比的输入路径，~50 LoC 不值得。

**Mental model reasoning**: 用户的心智模型里，Compost 的输入应该是主动的、有质量门控的。recall_miss 信号本质上是"用户搜索了某个词但没找到"——这是极其嘈杂的信号，大量 miss 来自拼写变体、项目外词汇、测试查询。Compost 已有 3 条输入路径，再加一条基于 miss 的自动 ingest，会向 Compost 注入大量低质量触发，增加 LLM 处理噪声。更糟的是，用户无法感知这个自动通道的存在，当 Compost 里出现来路不明的 fact 时，用户不知道为什么。

**Trust signal analysis**: 自动 ingest 破坏 Compost 的"用户知道里面有什么"假设。不可见的输入路径 = 不可信的输出。

**If REJECT, concrete alternative**: 把 ~50 LoC 用在 v3.3 WAL audit 上。recall_miss 数据应该记录到本地日志供用户查看（`engram stats --misses`），让用户决定是否手动触发 Compost ingest，而不是自动推送。

---

### Q5 — MODIFY

**Sonnet position**: 双栈有合理分工，但当前 API 重叠会导致选择瘫痪，需要强制隔离。

**Mental model reasoning**: 用户每次"存记忆"都要决策：Engram remember() 还是 Compost observe()？两个 MCP server 同时挂在 Claude Code 里时，agent 也会面临相同困惑，可能随机选择。这不是用户的执行力问题，这是 API 设计问题：两个系统的写入接口语义太接近，没有清晰的调用规则。双 CLI 的认知代价在日常使用中每天发生，不是一次性的。

**Trust signal analysis**: 如果 agent 自动选错了存储目标（应存 Engram 的 guardrail 被存进了 Compost），用户几乎不会发现，直到他去找这条记忆时找不到。故障模式完全不可感知。

**If MODIFY, concrete alternative**: 强制路由规则写进 CLAUDE.md（已有）还不够，需要在 MCP tool description 里硬编码排斥语言："remember() ONLY for <500 char atomic claims；observe() ONLY for raw source material"。同时，两个 MCP server 的工具列表不应有命名相似的工具（当前 remember vs observe 已经差异足够，但 recall vs search 如果都存在就危险）。双栈保留，但接口必须在工具 description 层面互斥。

---

## 最担心的心智负担（Sonnet 独立观察）

1. **静默路由失败**：v3.4/v3.5 的跨系统异步通道失败时（网络、进程未启动、消息丢失），用户完全无感知。没有失败通知，没有重试 UI，用户只会在"怎么这条经验没有被 Compost 学到"时才发现，但此时距离事件已经很久，完全无法 debug。两个系统之间的任何异步通道都必须有可见的失败日志，至少写到 `engram stats` 里。

2. **compiled 条目的半衰期不可见**：Engram 里 origin=compiled 的条目随着时间推移可能已经过时（Compost 重新综合了但 Engram 里的旧缓存还在）。用户没有办法知道一条 compiled 条目是"刚写入的新鲜缓存"还是"6 个月前的陈旧摘要"。需要 compiled 条目强制显示 `cached_at` 和 TTL 过期倒计时。

3. **proactive recall 在双栈下的身份危机**：session_start hook 目前只触发 Engram proactive。当 Compost 成熟后，用户会期望 session_start 也注入 Compost 的项目概览。但两套 proactive 叠加会超出 token 预算，用户将面临"哪个系统的 proactive 更重要"的无解选择——而这个决策每次 session 开始都要发生。
