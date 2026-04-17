# Debate 014 — Compost Roadmap Direction Check

## 战略问题

我们走在对的 roadmap 上吗? Phase 4 Batch D 全部 P0 完成 (P0-0..P0-7, 3 PR 已
merge). 现在准备启动 Phase 4 P1 (4 项) 或跳 Phase 5. 这是**方向辩论**,
不是 tactical code audit.

## 当前状态 (事实)

**已 ship (Phase 0-4 P0)**:
- L0/L1/L2 三层数据: SQLite WAL ledger + 嵌入 + 事实三元组
- 混合检索: BM25 (FTS5) + 向量 (LanceDB) + RRF 融合 + 多查询扩展
- LLM 合成: ask + wiki + 熔断 + 多 fallback (BM25 + stale banner + slug 兜底)
- 认知循环: 6h reflect (GC + 衰减 + contradiction 仲裁 + outbox prune) + wiki 自合成
- 可观测: decision_audit (contradiction/wiki_rebuild) + triage (6 信号面) + graph_health_snapshot
- 保护: SQLite VACUUM INTO 备份 (30 日轮) + Self-Consumption guard + 单 BreakerRegistry
- CLI: add / query / ask / audit / triage / doctor / backup / restore / reflect / drain
- MCP: observe / query / ask / reflect (Claude Code hook p95 < 30ms)
- 测试: 318 pass / 0 fail / 3 skip (31 files)

**未 ship (roadmap 现有)**:

### Phase 4 P1 (4 项, 原计划 Week 5+)
- `open_problems` 表 + CLI (好奇心追踪 / gap tracker 合并)
- observations 加 `origin_hash` + `method` 列
- Perf benchmark harness (`bench/reflect-{1k,10k,100k}.bench.ts` + CI > 50% regression 报警)
- Hook-shim PII redactor (regex blocklist: CC / SSH / API-token / .env / "password:")

### Phase 4 P2 (无限期推)
- Semantic Cohort Intelligence
- Milestone retrospective scheduler
- Four-layer self-model dashboard
- compression_pressure SQL view
- memory_procedural standalone table

### Phase 5 (按需)
- `compost export/import` 便携
- 冲突解决设计文档

### Phase 6 (最小 scope)
- `compost-adapter-openclaw`
- Multimodal metadata
- Prometheus/OTel metrics

## 3 个真问题

### Q1: Phase 4 Batch D 该不该再加东西? 还是该收尾?
8 P0 + 若干 fix, 已解决 myco 借鉴的核心能力 (triage / backup / breaker / audit /
contradiction 闭环). 继续 Batch D P1 还是切 Batch E / Phase 5?

候选角度:
- **继续 P1 (PII 先)**: 开源 / 分享 前需 PII redactor, 先于 Phase 5 makes sense
- **切 Phase 5**: 便携是单用户第二场景, 先 export/import 验证数据完整性
- **切 bench harness**: 没 baseline 不知道哪里慢, 先量再优
- **停一下 dogfood**: P0 太多没真用过, 跑 2 周自己的知识再决定 P1 顺序

### Q2: 当前功能**被真实使用**吗? 哪些是过度工程?
每个 P0 都能回答 "没它会怎么样?". 但一些可能是**预防性工程**:
- `graph_health_snapshot` + `v_graph_health`: 每天 04:00 UTC 跑, 有人看过吗?
- `decision_audit`: wiki_rebuild + contradiction_arbitration 2 种写入. 用户真查过 audit 日志吗?
- `backup` 30 日轮: 单用户 macOS 开发 vs Time Machine 重叠?
- `triage` 6 信号: 用户按 signal 去手动修复的工作流存在吗?
- `Self-Consumption guard`: 用户手敲 `compost add wiki/foo.md` 的概率?
- 熔断器: Ollama 本地跑为什么需要?

### Q3: roadmap **漏了什么** 真正重要的?
现在 roadmap 是从 myco 借鉴 + debate 002 gap audit 得出的. 有没有过去 4 周的
开发经验告诉我们 "应该先做但没写进 roadmap" 的事?

候选:
- **Eval harness**: 没法衡量"知识召回质量" — 几条 ask() 哪条答得好没指标
- **数据导出 JSON**: 想把事实导给 GPT/Claude 外部工具, 目前零 CLI 支持
- **空查询降级**: `compost query` 空结果 UX 差, "I don't know" 之外无路径
- **Hook 失败处理**: p95<30ms 但 p99 呢? hook fatal 静默 swallow 还是 alert?
- **迁移倒转**: `compost restore` 能回到 P0 快照, 但回不到上个 migration (down.sql)
- **多用户基础**: 单用户现在 OK, 但 hardcoded `~/.compost/` 的假设未来要改

## R1 任务 (≤ 1200 字)

### 1. Q1 裁决 (≤ 300 字)
下一批该做什么? 明确给**具体顺序** (1-4 名), 不是 "都重要".

### 2. Q2 评判 (≤ 300 字)
列 2-3 个 "可能过度工程" 的项, 给论据 (哪些数据/使用场景支持或反对). 承认
哪些是预防性但必要.

### 3. Q3 漏洞 (≤ 300 字)
给**最多 3 项** roadmap 漏掉的 high-value 事项 + 简短理由. 禁止列超 3.

### 4. 一句话总评 (≤ 100 字)
"Compost 现在方向对 / 部分对 / 错" + 为什么.

## 硬约束
- 严禁生物学隐喻
- 不重复 debate 001-013 裁决项
- Q1 必须给**明确排序**, 不能 "并列"
- Q3 必须 ≤ 3 项 (强制收敛)
- 敢说 "某 P0 是过度工程" 是加分项; 不敢说就直说 "都必要"

## 参赛者
- Codex (工程可行性 / SQL + schema)
- Gemini (LLM 生态 / 行业视角)
- Sonnet (KISS / 用户实际使用路径)
- Opus (架构 + 终裁)

## 输出
写入 `<repo>/debates/014-roadmap-direction/rounds/r001_<名字>.md`,
末尾 print `DONE_R1_014`.
