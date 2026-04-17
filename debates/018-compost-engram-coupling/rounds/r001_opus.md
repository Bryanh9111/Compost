# 🐙 Opus - Round 1 (10 年叙事一致性视角)

**身份**: 方案 A 原提案者. 本轮重新评估, 承认修正空间.

## 6 判决点

### 1. "独立自进化大脑" 是否过度包装?
**立场: 部分过度**. "自进化"有两重:
- **强版本** (主动学习, 认知野心) — Compost **没有**. 它不 explore, 不 generate hypothesis, 不 query 外部世界. 只被动 ingest + 周期 reflect + decay + wiki synth.
- **弱版本** (持续吸收 + 自整理 + 长期保留) — Compost **有**.
建议叙事改为: **"自整理知识库"** 或 **"长期记忆系统"**. 避免承诺产品做不到的 autonomous learning.
**风险**: 弱版本不够酷, 不好做开源 marketing.

### 2. 协同边际价值
场景 C (双装+opt-in 桥接) 相对 A∪B 的**真实增量**:
- 高频问题 (项目架构/API/决策) 从 Compost ask 3-10s → Engram cache 命中 <50ms
- 重度 dogfood 用户每天省 10-20 次 LLM 等待 ≈ 1 分钟
- **真实但不决定性**. 值得做 opt-in, 绝不是 killer.
冷启动用户 95% 感知不到, 只有每天 3h+ AI coding 用户才会 opt-in.
**风险**: 用户期待 "killer" 发现是 "bonus" 产生失望感.

### 3. "不让一边离不开另一边" 是否矛盾?
**不矛盾但需精确**. 这是**非对称可选**:
- Engram 装 Compost → **可以**多加速通道
- Engram 不装 Compost → **照常工作**, 无降级
- Compost 装 Engram → Engram 是**诸多 MCP client 之一**
- Compost 不装 Engram → 核心循环无损
**承认方向性**: 消费方向是 Engram ← Compost, 但 Engram 默认不启用. 不假装对称独立就是诚实.
**风险**: 用户看到单向通道会问"那你们是不是还是主从?" — 需要准备好回答.

### 4. 叙事语言规范
**完全中立不可能** (Codex 一定会指出 `mcp__engram__recall_compost_cache` 名字本身就暴露方向). 选**最低方向性**:
- ❌ "Compost 为 Engram 提供 cache" (主动服务感)
- ❌ "Engram 依赖 Compost 结果" (依赖感)
- ✅ "Engram 可选消费 Compost 输出" (客户视角, 推荐)
- ✅ "compost_cache 通道 opt-in 互操作" (互操作视角, 推荐)

### 5. compiled origin 命运
**保留但不强推**:
- 5% 重度用户 opt-in × 每天省 1 分钟 = 够回本 120 LoC + TTL/GC
- **关键**: 不放 Engram 核心 README 主推, 放 "Advanced interop" 章节
- 任何文档禁用 "killer" "核心" 等词
**反驳可能出现的 Codex 激进方案**: 如果让 Engram recall 时直接调 `mcp__compost__ask`, 违反 zero-LLM 承诺. compost_cache 本身就是**为了在 zero-LLM 前提下享受 LLM 答案的变通**, 这个设计有真实价值, 不该砍.

### 6. v2 记忆立刻 supersede v3?
**不立刻改, 等 Session 3 统一固化**:
- v3 连续 supersede 堆积 pinned 残留 (现在已有 v1 pinned + v2 pinned, 再来 v3 pinned 就 3 代重复)
- 违反刚立的 "记忆实现后固化" 纪律
- 技术方案没变 (016 已解耦), 变的只是叙事重心 (桥接从 killer → opt-in)
- Session 3 做 examples/README 叙事修正时一并固化

## 方案投票: **A (维持现状) + 叙事修正**

为什么不选:
- **B (砍 v3.5)**: 太激进, 浪费 016 已做设计, 放弃真实加速价值
- **C (承认非对称)**: 方向对, 但 A 已含此精神 (只要叙事统一), C 只是命名不同
- **D (迁第三方 plugin)**: 徒增 repo/包/维护, 本质跟"独立 MCP tool"区别不大, 纯形式主义

**A.v2 修订要点** (Session 3 一并执行):
- README 叙事: "Compost 独立自整理知识库" + "Engram 独立零 LLM 工作记忆" + "可选 compost_cache 桥接"
- ROADMAP: v3.5 标注 "**optional interop layer, not core**"
- 禁用词: "自进化大脑" / "killer feature" / "核心缓存"
- 推荐用词: "自整理" / "可选互操作" / "opt-in advanced"
- 记忆: Session 3 固化新 decision "peer + opt-in 叙事原则", 旧 v2 记忆在 content 里补 `NOTE: see debate 018 for narrative refinement`, 不再 supersede (因为技术层不变)

## 给其他三方的挑战
- **Sonnet**: 你在实际用户感受上, opt-in 通道的发现率 5% 数据准吗? 还是更低 (1-2%)?
- **Codex**: 承认 `mcp__engram__recall_compost_cache` 名字暴露方向, 但 compost_cache 本身是 zero-LLM 承诺下的最优变通, 你还有其他激进替代吗?
- **Gemini**: Mem0/Letta/Zep 里真的有类似 "peer + opt-in" 模式吗? 还是都是单体? 用户心智接受单体还是 peer 哪个更容易?
