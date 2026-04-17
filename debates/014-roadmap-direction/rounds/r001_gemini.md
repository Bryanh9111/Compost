# Debate 014 — R1: Gemini

## 1. Q1 裁决：优先级排序

在 Phase 4 P0 完成核心闭环后，下一阶段的重心应从“功能堆叠”转向“工程稳固性”与“生态就绪”。

1.  **Hook-shim PII redactor**: **最高优先级**。作为 LLM 生态中的工具，隐私安全是“入场券”。在考虑开源或跨机器同步前，必须防止敏感信息（API Keys, SSH, .env）污染向量库。
2.  **Perf benchmark harness**: **第二优先级**。对于 MCP 和 Hook 场景，30ms 的延迟是及格线，但随着数据量增长，`reflect` 和 `query` 的性能退化是隐形杀手。没有基准测试的优化是盲目的。
3.  **Phase 5: Export/Import**: **第三优先级**。数据便携性是单用户工具的生存基础。验证数据在不同环境下的完整性，比增加复杂的知识追踪更具基础价值。
4.  **open_problems 表 + CLI**: **最低优先级**。这属于“好用的功能”而非“必要的基础设施”。在系统性能和安全性未得到量化保证前，不应继续扩张 schema 复杂度。

## 2. Q2 评判：过度工程分析

1.  **graph_health_snapshot + v_graph_health**: **过度工程**。在单机 SQLite WAL 环境下，定期的健康快照属于典型的“分布式系统思维残留”。关系一致性应通过 SQL 约束和事务保证，而非通过定时巡检并生成快照表。除非数据量达到 100k+ 节点，否则这只会增加写入放大。
2.  **Self-Consumption guard**: **过度工程**。针对 CLI 工具，防止用户手动将 wiki 目录 add 回自身的概率极低。即使发生， ingestion 层的递归深度限制或简单的路径过滤即可解决，专门引入 `BreakerRegistry` 来处理此场景属于过度防御。
3.  **decision_audit**: **部分过度**。记录 `contradiction_arbitration` 是必要的，但 `wiki_rebuild` 的每一次写入都审计会导致日志迅速膨胀。对于单用户工具，用户极少会去“审计”一个自动合成脚本的每一次执行路径，保留最近 5-10 次记录远比全量审计日志高效。

## 3. Q3 漏洞：高价值缺失项

1.  **RAG Eval Harness**: 目前虽有混合检索（BM25 + LanceDB）和 RRF 融合，但缺乏客观衡量“回答质量”的手段。没有黄金数据集（Golden Set）和 LLM-as-a-judge 的评分机制，我们无法判断任何 RRF 参数调整或多查询扩展是优化还是劣化。
2.  **JSON Output / Interop**: 目前 `query` 和 `ask` 强绑定终端输出。作为“第二大脑”，其数据必须能流向外部工具（如 Claude Code, 自动化脚本）。缺乏 `--json` 支持严重限制了 Compost 作为下游工具数据源的潜力。
3.  **Adaptive Context Selection**: 随着 context window 差异化（本地 Ollama 4k vs 外部 Claude 200k），Compost 缺乏一种根据模型能力动态裁剪事实块、摘要和 wiki 片段的适配层。目前可能是硬编码的截断，这在异构模型环境下效率极低。

## 4. 一句话总评

Compost 目前方向基本正确，但正陷入“数据结构扩张陷阱”；下一步应停止增加新的认知逻辑，转而通过量化评估（Eval）和生态接口（JSON/PII）来证明并释放现有能力的价值。

DONE_R1_014
