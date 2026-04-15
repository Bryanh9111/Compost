# Debate: Myco 精华集成进 Compost 个人大脑

**Topic**: 从 Myco 提取哪些设计/机制值得集成进 Compost, 拒绝哪些, 如何落地到 Phase 4/5
**Date**: 2026-04-14
**Style**: thorough, 2 rounds
**Participants**: Codex (🔴), Gemini (🟡), Sonnet (🟠), Opus (🐙)

---

## 背景

三个记忆系统:
- **Engram** (全局 MCP, `~/.engram/engram.db`) — 稳定, 保留
- **Compost** (自研, `/Users/zion/Repos/Zylo/Compost`) — Phase 0-3 done, Phase 4 待规划
- **Myco** (第三方, `/Users/zion/Repos/Personal/Research-and-Integration/memory/Myco`) — Agent-First 共生认知基质

已决定不同跑三个。**不装 Myco MCP**, 只把精华集成进 Compost。

## 用户诉求 (硬约束)

- Compost = **个人第二大脑** (不是 agent memory)
- **拒绝哲学开销**: biomimetic_map.md (15K) 这类纯隐喻文档不要
- **拒绝单文件巨型化**: Myco notes.py 115KB / immune.py 153KB 反面教材
- 保持 **SQLite 工程骨架**, 不退化到 markdown+YAML
- 拒绝 Myco 生物学隐喻 (菌丝/代谢/免疫), 用 Compost 术语 (fact/wiki/reflect/contradiction)

## Compost 当前状态

- 8.5K lines TS+Python, 146 tests, 9 migrations, 20 tables
- 架构: compost-core + compost-daemon + compost-cli
- 已有: hook 被动捕获 / outbox drain / fact extraction (LLM) / embed / reflect (GC+tombstone+contradiction arbitration) / wiki L3+versioning / multi-query expansion / ranking profile (rp-phase3) / talking profile (tp-2026-04-03 via Ollama)
- 关键文件:
  - `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`
  - `packages/compost-core/src/cognitive/reflect.ts`
  - `packages/compost-core/src/cognitive/wiki.ts`
  - `packages/compost-core/src/query/ask.ts`
  - `packages/compost-daemon/src/scheduler.ts`

## Phase 4 候选 (Compost 自有)

- Episodic memory materialization
- Fact-to-fact links graph + recursive CTE
- Semantic chunking / Savitzky-Golay
- Curiosity agent + gap tracker
- Autonomous crawl with is_noteworthy semantic gates
- memory_procedural standalone table

## 初步候选 (10 项, 待辩论裁决)

| 代号 | 候选 | 来源 |
|---|---|---|
| A | `compost hunger` boot-time health check | MYCO.md §🔥热区 + hunger signal |
| B | `_canon.yaml` SSoT + lint 体系 (29 维 L0-L28) | `_canon.yaml` + `scripts/lint_knowledge.py` |
| C | Craft Protocol (置信度阶梯 0.90/0.85/0.75) | `docs/craft_protocol.md` |
| D | Mycelium graph density 结构退化指标 | `src/myco/mycelium.py` |
| E | Compression doctrine (频率/时效/排他性三判据) | `docs/primordia/compression_primitive_craft` |
| F | Cross-Project Distillation (g4-candidate) | MYCO.md Agent 行为准则 |
| G | 四层自我模型 (库存/缺口/退化/效能) | MYCO.md 身份锚点 §5 |
| H | Signal-to-Action hunger 闭环 | `src/myco/cli.py` hunger command |
| I | Forage manifest (主动觅食外部源) | `src/myco/forage.py` |
| J | Continuous Compression + Semantic Cohort | v0.39.0/v0.37.0 |

## 参赛者任务

每个参赛者独立完成:

### Round 1 (独立分析)
1. 完整阅读 Myco 指定文件 (list 见 prompt)
2. 完整阅读 Compost 指定文件
3. 输出:
   - **Top 10 integrate 清单** (每项: Myco 源 / Compost 落地点 / 方式 / 成本S/M/L / 不做的代价 / 风险)
   - **Reject 清单** (至少 3 项, 说明为什么不要)
   - 对候选 A-J 逐一裁决 (accept/reject/modify)

### Round 2 (交叉质疑)
1. 读其他三人 Round 1
2. 标注哪些是 **cargo cult** (抄皮不抄骨), 哪些是 **真 insight**
3. 最终投票: P0 (Phase 4 必做) / P1 (Phase 5) / P2 (长期观望) / Reject

### Final Synthesis (Opus)
- 合并四方意见为 P0/P1/P2/Reject 矩阵
- 为每个 P0 写最小 PR 描述 (文件 / 接口 / 测试)
- "取骨去皮" 综述 ≤ 500 字

## Word Budget

- Round 1: ≤ 1500 字 (因为要产结构化清单)
- Round 2: ≤ 800 字
- Synthesis: Opus 自裁

## 禁止

- 生物学隐喻 (菌丝 / 代谢 / 免疫 / hunger)。用 Compost 术语
- 建议新建 markdown/YAML 存储层 (必须走 SQLite)
- 建议 Compost 学 Myco 的单文件巨型化
- 空洞哲学 ("自主进化" "autopoiesis" 这种不落地的词)
