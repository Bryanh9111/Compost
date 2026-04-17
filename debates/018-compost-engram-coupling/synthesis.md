# Final Synthesis: Compost ↔ Engram 关系定位

**Debate ID**: 018-compost-engram-coupling
**Participants**: 🟡 Gemini, 🔴 Codex, 🟠 Sonnet, 🐙 Opus
**Date**: 2026-04-16
**Mode**: 1 round thorough cross-critique

---

## 投票汇总

| 方 | 投票 | 核心主张 |
|---|---|---|
| 🐙 Opus | **A** | 维持 debate 016 技术方案 + 叙事修正 + 记忆暂缓 |
| 🟠 Sonnet | **A+** | 同 A, 但 compiled origin 降 P2 (保 enum, 砍 TTL/GC/MCP tool) |
| 🔴 Codex | **B** | 砍 v3.5 实现, 保留 enum 值, wiki_pages 已存 LLM 输出不需要二次物化 |
| 🟡 Gemini | **C** | 非对称依赖: Compost=经验底座, Engram=执行触角, 叙事立刻改 |

**票分散但实质共识高** — 4 方都同意"砍掉 v3.5 的实现层, 保留 compiled origin 概念, 叙事承认非对称"。分歧在"立刻改还是等"和"保留多少"上。

---

## 四方 6 判决点对照

| 判决 | 🐙 Opus | 🟠 Sonnet | 🔴 Codex | 🟡 Gemini | 共识 |
|---|---|---|---|---|---|
| 1. 自进化大脑过度包装? | 部分 (弱版本成立) | 严重 (叙事差距第 3 周失望) | 半成立 (仍需 ingest 燃料) | 改"自优化知识基座" | **4/4 过度**, 改叙事 |
| 2. 协同边际价值? | 真实但不决定 (省 1min/day) | 极小 (0.3s 快) 不支撑维护 | p95 提升无实测不该当卖点 | 增量价值不是基础 | **4/4 增量<成本** |
| 3. 对称性矛盾? | 非对称可选 | 天然非对称 no problem | 仍不对称, 可 peer 不可对称 | 非对称独立 | **4/4 非对称** |
| 4. 叙事语言 | "可选消费/互操作" | "随工作积累的 AI 记忆" | 中立不可能 (接口名暴露方向) | 经验底座 + 执行触角 | **承认方向性, 弃"killer"** |
| 5. compiled origin 命运 | 保留不强推 | 保 enum 砍 TTL/GC/MCP tool | 砍实现, 否则死代码 | 保留作溯源元数据 | **保概念, 砍实现** |
| 6. v2 记忆 supersede? | 等 Session 3 | 等 Session 3 | 等 Session 3 | **立刻改** | **3/4 延迟固化, Gemini 反对** |

---

## 关键洞察 (价值排序)

### 1. 🟠 Sonnet "第 3 周失望点" [价值: 最高]
**用户第 1 周装上觉得酷, 第 3 周问"为什么它没学到我上周说的那个约束?"** 因为约束在 Engram, 不在 Compost, 桥接默认关闭. 这是叙事错位的直接后果 — 不是功能缺陷, 是期待管理失败.

**启示**: 叙事修正**不能等 Session 3**, 否则错误叙事已经传播到 README/讨论/用户心智. Gemini 的"立刻改"有道理.

### 2. 🔴 Codex "wiki_pages 已存 LLM 输出" [价值: 高]
Compost 自己已经把 LLM 综合结果存在 wiki_pages 表里. compost_cache 是**把同一份数据在 Engram 侧再物化一次**, 目的是为了保 Engram 的 zero-LLM 承诺. 这是妥协件, 不是协同架构的独立价值.

**启示**: compost_cache 存在的唯一理由是 "Engram 不能调 LLM 但想要 LLM 答案". 如果这个需求不强, 桥接本身就没必要。

### 3. 🟡 Gemini "经验底座 + 执行触角" 隐喻 [价值: 高]
- **Compost = Substrate (经验底座)**: 静态知识, 持续积累, 不主动学习
- **Engram = Effector (执行触角)**: 动态注入, 调用底座, 不做合成
- 两者通过中立 MCP 接口 (非 compost_cache 这种强耦合) 交流

这比 "peer + opt-in" 更精准, 因为隐喻直接说明方向性 (底座 ← 触角).

### 4. 🟠 Sonnet "opt-in 率 <0.5%" [价值: 高]
比 Opus 估的 5% 低一个数量级. 问: 多少用户会主动 `compost config set engram.bridge=true`? 如果文档在第 3 层, 实际激活 <0.5%. 这直接否定 "compiled 通道值得 120 LoC + TTL/GC" 的前提.

### 5. 🔴 Codex "独立自进化只能半成立" [价值: 中]
没 agent 客户的 Compost 仍能 reflect + wiki synth, 但这是**自整理**不是**持续进化**. 真进化仍靠持续 ingest. "自进化大脑"在无输入时是骗人的.

### 6. 🟡 Gemini 生态对比 [价值: 中]
- Letta (ex-MemGPT): 单体紧耦合
- Mem0 / Zep: 向独立记忆层演进
- Compost + Engram "peer + opt-in" 在生态里是**先进但非主流**, 用户心智可接受 (类比应用+数据库模式)

---

## 合成方案: **A+** (四方综合)

### A+ = A 骨架 + B 的实现砍掉 + C 的叙事精准化

**保留** (来自方案 A / debate 016 技术方案):
- compost_cache 表 DDL (Engram 侧独立表)
- compiled origin enum 值
- 独立 MCP tool **接口定义** (不强制实现)

**砍掉** (来自方案 B / Sonnet P2 降级):
- TTL/GC daemon 实现
- Compost → Engram 异步 worker
- `mcp__engram__recall_compost_cache` 实现
- 所有独立表的 backfill 逻辑
- v3.5 "killer feature" 定位

**精准化** (来自方案 C / Gemini):
- 叙事: **Compost = 经验底座 (Substrate), Engram = 执行触角 (Effector)**, 非对称单向可选消费
- 禁用词: "自进化大脑" / "killer feature" / "深度协同" / "对等互操作"
- 推荐词: "自优化知识基座" / "opt-in advanced" / "单向可选消费" / "经验底座 ↔ 执行触角"

**立刻改** (来自 Gemini):
- README 叙事立刻修正, **不等 Session 3**
- 避免错误叙事继续污染后续决策

**延迟固化** (来自 Opus+Sonnet+Codex):
- 记忆库 v3 supersede 在 **Session 3 README 改完之后**一并写入
- 不再堆 pinned 残留 (v1 v2 v3 四代压制太乱)

---

## Compost v3.5 重新定义

```
v3.5 原计划 (debate 016):
  - compost_cache 表 + TTL/GC + 独立 worker + 独立 MCP tool  (~120 LoC)
  - 位置: "killer feature"

v3.5 调整后 (debate 018):
  - compost_cache 表 DDL 保留 (schema 向前兼容)
  - compiled origin enum 保留 (Engram schema CHECK 允许)
  - 实现: 全部 DEFERRED (等 3+ 真实用户请求, 至少 6 个月后)
  - 位置: "reserved advanced interop slot, not scheduled"
```

等效于 **v3.5 砍了实现, 保留接口合约**。未来若真需要, 不用新 migration 就能开启。

---

## 4/4 共识决议

1. **"自进化大脑"叙事错** — 改 "自优化知识基座" 或 "经验底座" (Substrate)
2. **协同增量 < 维护成本** — 不做 v3.5 实现
3. **承认非对称** — Engram 单向消费 Compost, 不伪装对等
4. **compiled origin 保概念** — 留 enum 值 + 表 DDL, 砍 runtime 实现
5. **wiki_pages 已充分** — Compost 侧 LLM 输出已 canonical 存储 (无需 Engram 二次物化)

## 3/4 共识

- **叙事立刻改, 不等 Session 3** (Gemini 反 Opus/Sonnet/Codex 的延迟)
  - **采纳 Gemini**: 错误叙事污染成本 > 立刻修改成本

## 1/4 少数 (保留存档)

- Codex 主张彻底砍 v3.5 (方案 B 纯粹版). 多数保留 DDL 作未来扩展口.

---

## 执行清单 (立刻 vs 延迟)

### 立刻 (本 session 或下 session)
1. **修正 README 叙事** (`README.md` 第 1-10 行, 项目身份段):
   - "self-evolving personal knowledge base" → "self-organizing personal knowledge substrate"
   - 去除 "self-evolving"
   - 添加 "Compost serves as Substrate; agents (e.g. Engram) are Effectors"
2. **修正 ROADMAP v3.5 条目** (Engram repo 和 Compost repo 协同):
   - 原 "v3.5 killer feature" → "v3.5 reserved advanced interop slot"
   - 标注 "implementation deferred until ≥3 real user requests, minimum 6 months"
3. **ARCHITECTURE.md** (如有): 加一章 "Substrate-Effector Pattern" 说明非对称

### Session 3 一并固化
4. **记忆 v3 supersede** (写入两个项目):
   - compost 项目: "Compost 最终形态 v3" (去掉桥接 killer 渲染, 改 Substrate 叙事)
   - engram 项目: "Engram 最终形态 v3" (桥接降为 reserved slot)
   - 两个共享 "debate 018 裁决" 记忆

### 用户新指令 (分离处理)
5. **memory research 项目吸收**: 用户 `/Users/zion/Repos/Personal/Research-and-Integration/memory/` 包含 14 个外部项目 (Myco, gbrain, LycheeMem, Understand-Anything, Ombre-Brain, supermemory, claude-subconscious, CatchMe, claude-code-source, llm-wiki.md 等).
   - **不在本 debate 范围**, 但影响未来方向
   - 建议: 开独立 debate 019 "从外部 memory 项目提取优点扩充 Compost"
   - 逐项评估每个项目的独特优势, 映射到 Compost/Engram 可吸收的特性

---

## Cost & Quality

| Advisor | Output | Quality | 亮点 |
|---|---|---|---|
| 🟡 Gemini | ~390 字 | 92 (Substrate/Effector 隐喻 + 立刻改主张) | 生态定位最到位 |
| 🔴 Codex | ~250 字 | 85 (SQLite 技术洞察 + 最激进砍法) | wiki_pages 二次物化洞察 |
| 🟠 Sonnet | ~480 字 | 95 (第 3 周失望点 + opt-in 率 <0.5% + 具体 LoC) | 用户体验最贴实 |
| 🐙 Opus | ~500 字 | 88 (综合视角 + 反驳替代方案) | moderator 权衡 |

**最大价值产出**: 
1. Gemini 的 Substrate/Effector 隐喻 — 未来 README/docs 直接用
2. Sonnet 的第 3 周失望点 — 解释为什么叙事必须立刻改
3. Codex 的 wiki_pages 二次物化观察 — 证明 v3.5 是妥协件而非刚需

---

## 最终结论

**Compost 和 Engram 是 Substrate ↔ Effector 关系, 不是 peer**. 承认非对称, 但保持"离开对方都能独立存活"的硬约束. v3.5 桥接实现 **DEFERRED**, 只保留 DDL + enum 作未来扩展口. 叙事立刻修正, 记忆 Session 3 固化. 用户新指令 (memory research 吸收) 另开 debate 019.
