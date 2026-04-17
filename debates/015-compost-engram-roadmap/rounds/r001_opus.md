# 🐙 Claude (Opus) - Round 1

身份声明: 我是方案 B 原提案者, 但本轮作为独立参与者重新评估, 有修正就认修正。

## 6 个判断点

### 1. 边界: 按触发时机 (不是按内容)
内容类型会漂移——Engram 里已经有 18 条 `kind=fact`, 和 Compost L2 facts 事实上重叠。但**延迟预算是物理硬约束**: proactive 在每次 LLM 调用前跑, p95 预算 <50ms 就是不能调 LLM, 不是因为内容是"约束"还是"事实"。反之 Compost `ask/query` 不在关键路径, 可以容忍 3-10s LLM synth。
**风险**: 触发时机边界要求纪律——没人能在 proactive 路径偷偷调 `compost.ask`。需要 schema 级约束, 不是 docs。

### 2. v3.4 异步回写, 不同步 fallback
同步 fallback 违反设计公理。p95 从 10ms → 3s = **300 倍劣化**, 用户瞬间感知"卡"。异步让 Engram 永远确定, Compost 后台物化。
**风险**: miss 首次必失, 需要 UX 上容忍"第一次空→后续命中"的两步请求。

### 3. origin=compiled 值得复活
50 条里 compiled=0 是 missed opportunity, 不是废弃信号。这恰好是 v3.5 的形态: Compost ask 一次贵, 结果物化成 Engram fact, 后续零 LLM 命中。这是 Engram **第三条护城河**: 低延迟 + MCP 原生 + **LLM 答案缓存介质**。
**风险**: compiled fact 需 `source_fact_ids` + auto-invalidate-on-source-change, 否则会陈旧。

### 4. 双栈只有加硬边界才能避免趋同
放任"Engram 可以做 X 因为方便", 3 年后必然长成 mini-Compost。必须把禁令写进 **schema 层**:
- Engram DB 禁 `embedding` 列
- 禁 `llm_response` / `synthesis_output` 字段
- `remember()` 禁接 LLM service
代码约束比 docs 约束强 10 倍。
**风险**: 新功能提案会被约束拒绝, 需要有复议流程。

### 5. Engram 无独立 LLM 合法场景
Compost 离线就是离线。Engram 不该补位——降级路径应由 Compost circuit-breaker + BM25 fallback 解决 (P0-6 已做了)。**把离线问题跨界转嫁给 Engram 是错解**, 会污染边界。
**风险**: 无。坚持反而简化架构。

### 6. kind-lint 按 kind 分级, 不统一
- **guardrail/constraint**: 严 — 必须有 `**Why:**` + `**How to apply:**` (用户 CLAUDE.md 已要求, 现在未强制)
- **procedure**: 中 — 必须可执行, 不可是观察性描述
- **fact**: 松 — 只禁重复, 允许自由格式
- **decision**: 中 — 必须有 actor + scope
**风险**: 分级规则首版必返工; 接受。

## 最终路线表

| 版本 | 内容 | 决策 |
|---|---|---|
| v3.2 | project.lower + stale cleanup | ✅ done |
| v3.3 | recall_miss 日志 + kind 分级 lint | ✅ 先做 lint, 日志为 v3.5 原料 |
| v3.4 | Engram→Compost 单向 `suggest_ingest` (过时条目推给 Compost 重抽) | ✅ 非阻塞 |
| v3.5 | Compost→Engram 异步回写 (origin=compiled + source_fact_ids + auto-invalidate) | ✅ killer feature |
| v4-v7 | LLM compile / multi-path / embedding / memory graph | ❌ **全砍** |
| 新增 | schema-level guardrail: 禁 embedding/llm_response 列 | ✅ 代码强约束 |

## 反对我自己方案 B 的点
- **UX 代价**: 用户首次问某 topic 必空, 第二次才命中。这个"冷启动"体验可能让用户困惑"为什么有时候记得有时候不记得"。→ 缓解: CLI 返回时加 hint "(Compost 正在后台综合答案, 稍后再问即可命中)"
- **compiled 污染**: 如果 Compost 的 fact 有误, compiled 到 Engram 放大错误传播。→ 缓解: compiled 强制带 `source_fact_ids`, Compost 端 fact 变更触发 invalidate。

**最终立场**: 方案 B (加上 schema guardrail + compiled TTL 细节), 砍 v4-v7。
