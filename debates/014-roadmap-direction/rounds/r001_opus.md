# Debate 014 R1 — Opus (strategic direction)

## 1. Q1 — 下一批顺序

**排序 (1→4)**:

1. **Dogfood 停 1-2 周** (零代码). 8 P0 都是从 myco 借鉴 + 工程直觉推出来
   的, 但**还没跑过真实个人知识工作流**. 关键问题答不上来:
   - 每天会产生多少 observation? 多少 fact?
   - reflect 6h 够频繁吗 / 太频繁?
   - triage 6 signal 的 noise:signal 比?
   - Ollama gemma3:4b 抽出来的事实**质量**如何?
   没这些数据下做 P1 就是继续拍脑袋. 零成本, 最高收益.

2. **PII redactor** (Week 5 第一 feature). 理由: 这是**开源/分享的前置**.
   在 dogfood 中如果发现需要给朋友看 wiki 或 fact 导出, 没 redactor
   就等于把 CC / API key 明文暴露. 规模小, LoC < 200, regex 可接扩展.

3. **Bench harness + eval 合一** (Q3 扩展, 见下). 有 bench 才敢动 reflect /
   extractor / ranking. 没 bench 每次优化都赌.

4. **open_problems** — 放在最后. 现在 `ask()` 能答, `triage` 能提示,
   `audit` 能追溯. `open_problems` 的价值 (好奇心追踪) 靠用户自己手工记
   也能替代, 值不值得专门表待验证.

**`origin_hash`** 不排名 — 是 Phase 5 / Phase 6 引入多 adapter 时才需要,
现在没需求.

**切 Phase 5** 不推荐: export/import 是"数据安全 fallback", 但 P0-7 backup
已覆盖单机恢复. 真 pivot 到 Phase 5 得有"换电脑"的具体触发.

## 2. Q2 — 可能过度工程的 2 项

### OE1: `graph_health_snapshot` 每天 04:00 UTC 跑, 零消费
`v_graph_health` + `graph_health_snapshot` 表 + 整个 Union-Find 算法. 代码
~300 LoC + 一个完整 scheduler. **但 grep 仓库**: 零 caller 读 snapshot
数据, 零 CLI 命令展示它. 仅 `orphan_delta` scanner 间接用 (且 Week 4 发现
scanner 语义还漂移了 — debate 013 orphan_delta 实为 snapshot 非 delta).

**承认**: 预防性, 未来做 "图健康报告" 时有基础. **但**承认 Phase 5 之前
可能完全不看. 代价: 每日 04:00 写表 + 存储 O(days) 增长. 收益: 0 (未观察).
**判定**: 留, 但拿它当"未来补"不是"现在用".

### OE2: `triage` 6 signal 的真实工作流缺失
代码 + CLI + 测试都有, 但**人类用户会每天 `compost triage list` 吗?** 如果
是 LLM agent 读 triage 作为 "maintenance task" 源 — 那代理还没接上. 现在
triage 信号写到表里就结束了, 无 notification / digest / inbox. 用户
不看 = 不 resolve = 表增长 + 无价值.

**最小 fix**: Week 5 加一个 `compost doctor --daily-digest` 汇总
unresolved 信号 + wiki stale 数 + audit 昨日增量. 比新 P1 表更有用.

**不算过度工程的 P0**: 熔断器 (Ollama 本地也会超时) / Self-Consumption
guard (防止 reflect-wiki-reingest 真循环) / backup (VACUUM INTO 快, 开销
可忽略) / decision_audit (追溯 contradiction 仲裁是刚需).

## 3. Q3 — roadmap 漏的 3 项 (硬顶)

### M1 (HIGH) Eval harness — 没有就不敢调
没指标回答 "ranking profile X 比 Y 好 10%?" / "LLM extractor 换 gemma3:8b
值不值?" / "BM25 OR vs AND 召回差多少?". 每次调 ranking 或 extractor 都是
盲测. Week 5+ 建 10-30 条 golden questions + expected facts, 每次
`compost query/ask` 跑一次 recall@k / MRR. ~2 天搭架子.

### M2 (MEDIUM) Fact/wiki JSON 导出
没一个 `compost export --facts json` 命令. 外部 LLM (Claude/GPT) 想读
Compost 的知识, 只能走 MCP server. 如果 MCP 不可用 (IDE 外) 或用户只想
把一部分导给别人, 零路径. Phase 5 `export/import` 瞄的是整机迁移, 不是
"把 paris.md + 10 条相关 fact 导出给 GPT". 这是小而高频需求.

### M3 (MEDIUM) Ingestion quality gate (不是 P0-6 LLM 熔断, 是**提取结果质量**)
Python `llm_facts.py` 用 gemma3:4b 抽 SPO. 全仓库无一 test 或 sample 验
提取**正确率**. 一个拼写错误的 subject 或错配 predicate 会污染 fact store,
后面 reflect contradiction 仲裁、wiki 合成、ask 检索全部跟着错. Week 5
应加 "per-chunk 人工 spot-check CLI" 或 eval 子集抽检.

## 4. 一句话总评

Compost **方向大体对**但**节奏偏快** — 8 P0 落地扎实, roadmap 结构清楚,
但缺一次 dogfood checkpoint 和一套 eval 工具; 再无脑推 P1 有 "没真用过
就继续堆功能" 的风险, 应先停下跑两周再决定 P1 顺序.

DONE_R1_014
