# Final Synthesis: Compost + Engram 双栈最终发展路线

**Debate ID**: 015-compost-engram-roadmap
**Participants**: 🟡 Gemini, 🔴 Codex, 🟠 Sonnet, 🐙 Opus
**Rounds**: 1 (thorough, cross-critique)
**Date**: 2026-04-16

---

## 四方立场对照表

| 判决点 | 🟡 Gemini | 🔴 Codex | 🟠 Sonnet | 🐙 Opus | **共识** |
|---|---|---|---|---|---|
| 1. 边界划分 | 按时机 | **双轴** (主时机+辅内容) | 按时机 | 按时机 | 主时机,采纳 Codex 双轴修正 |
| 2. v3.4 同步/异步 | 异步 | 异步 | 异步 (v3.4=建议, v3.5=回写) | 异步 | **4/4 异步** |
| 3. compiled 复活 | 价值极高 | 值得+TTL+幂等键 | 值得+TTL+kind 约束 | 值得+source_fact_ids+invalidate | **4/4 复活, 需 TTL/GC/幂等** |
| 4. 避免趋同 | API 倒置 | Engram 只 recall+miss+suggest | CONTRIBUTING 硬约束 | schema 级禁令 | **4/4 需硬约束, 采组合拳** |
| 5. 独立 LLM | 仅本地治理 | 仅离线降级+显式开关 | 无(Compost 离线降级, 不含 LLM) | 无 | **分歧**: 2 反对 / 2 极窄例外 |
| 6. kind-lint 严苛度 | 早期极严 | 静态严+LLM 松复核 | unknown 拒/misrouted warn | 按 kind 分级 | **静态严, 分级, 非统一** |

---

## 关键洞察 (按价值排序)

### 1. Codex 双轴边界修正 [价值: 高]
纯"按时机"边界存在漏洞: Engram 可以偷偷把内容泛化为"频繁访问的事实", 长期仍会向 Compost 靠拢。Codex 提出**主按时机+辅按内容**: proactive/必跑路径 → Engram (0 LLM), 且内容限定 constraint/procedure/guardrail 这类"操作指南"; fact 可存但不该是主力。这修正了 Opus 方案 B 过于激进的"纯时机"。

### 2. Sonnet 接口级反滥用 [价值: 高]
**suggest_ingest 接口签名层必须禁止 await**, 强制 fire-and-forget, 不能靠文档约定。这防止 6 个月后有人把它"临时"改成同步降级, 然后变成主路径。实现建议: 返回 `void` 不返 Promise, 或用专门的 `WriteOnlyQueue` 类型。

### 3. Codex compiled 幂等键设计 [价值: 高]
`upsert by (query + source_hash + policy_ver)` — 三元组幂等键能天然解决:
- 相同 query 重复回写 → 覆盖而非累积
- source 变更 → policy_ver 递增 → 旧 compiled 自动 stale
- 配 TTL + GC → 索引不膨胀

这是 v3.5 的具体实现锚点, Opus 方案 B 只提了概念, Codex 给了 schema。

### 4. SQLite 真实风险点 [价值: 中]
Codex + Sonnet 同时指出:
- **Codex**: "真风险在 compile 回写/GC 争单写锁与 checkpoint 抖动" — WAL 模式下多个写入 worker 会卡 checkpoint
- **Sonnet**: "FTS5 冷页 p99 可达 200ms, 需 `PRAGMA cache_size=-8000`"
这是 p95<50ms 预算的硬物理约束, 必须在 v3.3 做 WAL 配置 audit。

### 5. 独立 LLM 分歧的解 [价值: 中]
Opus/Sonnet 说"无", Gemini/Codex 说"极窄"。实际上他们描述的是不同事: 
- Opus/Sonnet 反对的是**运行时 LLM 调用** (Engram 进程内 synth)
- Gemini/Codex 保留的是**离线/治理场景** (独立进程, 显式开关)
共识可以达成: **Engram 核心进程禁 LLM**, 但允许**旁路工具** (如 `engram lint --llm-assist` 这种一次性 CLI), 这不破坏 proactive 关键路径。

### 6. kind-lint 分级策略 [价值: 中]
4 方都倾向分级, 但侧重不同:
- **Sonnet**: 按合法性分 (unknown 硬拒, misrouted warn)
- **Opus**: 按 kind 分 (guardrail 严, fact 松)
- **Codex**: 按机制分 (静态严, LLM 松复核)
- **Gemini**: 早期极严

合成: **静态规则按 kind 分严苛度 + unknown 硬拒 + LLM 作可选抽样复核**。

---

## 最终路线表 (四方综合)

| 版本 | 内容 | LoC 估算 | 关键设计点 |
|---|---|---|---|
| **v3.2 ✅ done** | project.lower + stale cleanup + WAL baseline 指标 | - | baseline |
| **v3.3** | recall_miss 日志 + 分级 kind-lint + WAL/FTS5 性能审计 | ~100 | 静态规则分 kind; unknown 硬拒; `PRAGMA cache_size=-8000`; p99 SLI 指标 |
| **v3.4** | Engram→Compost 单向 `suggest_ingest` (outbox 异步) | ~50 | **接口签名层强制 fire-and-forget**; 复用 outbox 模式 |
| **v3.5** | Compost→Engram 异步回写 (origin=compiled) | ~150 | 幂等键 `(query, source_hash, policy_ver)`; TTL+GC; source 变更自动 invalidate; **独立 worker 进程**避免与 Engram 主路径争锁 |
| **v4-v7** | ~~LLM compile / multi-path / embedding / memory graph~~ | - | **4/4 判决: 全砍** |
| **新增硬约束** | schema 禁 `embedding`/`llm_response` 列; CONTRIBUTING 硬写边界; `suggest_ingest` 返回 void; Engram 核心进程禁 LLM | ~30 | Opus schema + Sonnet CONTRIBUTING + Gemini API 倒置 组合拳 |
| **旁路工具例外** | `engram lint --llm-assist` 等离线 CLI 允许调 LLM (独立进程, 显式开关) | ~20 | Codex 修正 |

---

## Areas of Agreement (4/4)
1. v4-v7 全砍
2. v3.4 异步, 严禁同步 fallback
3. compiled 通道值得复活 + 必须有 TTL/GC
4. 需要硬约束 (schema/接口/文档多层) 防止双栈趋同
5. Engram 核心不能运行时调 LLM

## Areas of Disagreement
1. **边界是纯时机还是时机+内容双轴?** → 采纳 Codex 双轴 (防止未来漂移)
2. **独立 LLM 是"无"还是"极窄例外"?** → 采纳 Codex 折中 (核心禁, 旁路允许)
3. **kind-lint 严苛度统一还是分级?** → 采纳分级 (合成 4 方)

---

## Recommended Path Forward

**立即执行 (本 session 或下一 session)**:
1. 固化决策: `remember` 一条 `decision/human` 记 "v4-v7 砍, 采纳双轴边界 + 异步回写 + 幂等 compiled"
2. 更新 decision #1 (a9962009533a) 的 `如何应用:` 补上触发时机边界

**v3.3 (下一个里程碑)**:
- SQLite WAL + `PRAGMA cache_size` 配置审计
- 分级 kind-lint (静态规则)
- recall_miss 日志 + p99 SLI 指标

**v3.4 (紧随 v3.3)**:
- `suggest_ingest` 接口 (返回 void, 禁 await)
- 复用 outbox 写 Engram 过时条目

**v3.5 (killer feature)**:
- Compost→Engram 独立 worker
- 幂等键 upsert + TTL + source-change invalidate

**硬约束 (与 v3.3 同步, 非功能):**
- Engram schema migration 禁 embedding/llm_response 列
- `CONTRIBUTING.md` 硬写禁止 LLM 调用
- CI 规则检查核心 package 不 import LLM 相关库

---

## Cost & Quality

| Advisor | Word count | Quality score (4 metrics) | 特色 |
|---|---|---|---|
| 🟡 Gemini | ~310 | 85 (简洁但缺代码示例) | API 倒置视角, MemGPT/Letta 生态对比 |
| 🔴 Codex | ~360 | 90 (具体 schema + 幂等键设计) | 技术深度最强, 双轴边界修正关键 |
| 🟠 Sonnet | ~490 | 95 (代码路径 + LoC 估算) | 实现可行性最具体, 接口级反滥用洞察 |
| 🐙 Opus | ~500 | 88 (结构清晰, 自我反对部分) | 综合视角, 承担 moderator 权衡 |

共识率: **5/6 判决点 4/4 共识**, 1 点 (边界双轴) 是 Codex 修正, 其余三方接受。
