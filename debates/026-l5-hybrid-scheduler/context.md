# Debate 026: L5 hybrid scheduler — auto-trigger seed selection + cadence + verdict-driven gating

**Topic**: 锁 (r) hybrid scheduler 架构 — debate 025 §Q4 唯一独排项 (Gemini 1/4 vote)，入场条件已达 (2026-04-26)，现在决定怎么自动跑 L5
**Style**: quick / 1 round / cross-critique
**Advisors**: gemini, codex, sonnet + claude(opus) moderator
**Started**: 2026-04-26

## 背景

debate 025 §Q4 选 (q) on-demand only, 4-way 投票 3:1（Sonnet+Codex+Opus 反 Gemini (r) hybrid），但 Gemini 论点产品向真：**"L5 = brain 不是 smart search engine"**——脑子是会自动思考的，不是用户问才动。当时 (r) 被 defer 不是因为不对，而是因为 chain quality 真实分布未知 → premature optimization 风险。

debate 025 共识写入 ROADMAP §Phase 7 deferred:

> **`(r)` hybrid scheduler** — earned only after dogfood data shows chain quality distribution; entry condition: ≥10 chains, ≥50% user-confirmed, ≥3 with confidence > 0.7.

S662 commit `d72e301` (2026-04-26) ship 了 verdict 信号通道 + CHAIN_PROMPT 校准, 解锁 entry condition:

| 阈值 | 状态 |
|---|---|
| ≥10 chains | ✓ (12) |
| ≥50% user-confirmed | ✓ (66.7%) |
| ≥3 conf>0.7 confirmed | ✓ (4: fc648158=0.95, f647a501=0.80, a4ba063e=1.00, 6bc1f336=1.00) |

校准实证 spread=0.84 (mean_confirmed=0.94 vs mean_rejected=0.10). **(r) 现在可以建。**

## 已就位的 primitive (L5 hybrid scheduler 可消费)

- **`reasoning_chains` table** (migration 0018): chain_id 幂等, candidate_fact_ids_json, retrieval_trace_json, answer_json, confidence, status, **`user_verdict` + `verdict_at` + `verdict_note`** (migration 0019, S662)
- **`runReasoning()` core** (`cognitive/reasoning.ts`): 同步签名稳定, 返回 reused_existing 标志, 带 graceful degradation
- **`getVerdictStats(db)`** (S662): total / unjudged / per-verdict counts / positive_rate / mean_confidence_confirmed/rejected
- **`open_problems` table** (`gap-tracker.ts:86-95`): `ask_count` 列已写入, 用户重复发问的高需求信号
- **`fact_links` derived_from edges** (debate 025 closed-loop): 已 active (本会话校准链已写入新 derived_from 边)
- **Daemon scheduler 框架** (`compost-daemon/src/scheduler.ts`): `startReflectScheduler`, `startDrainLoop`, `startIngestWorker`, `startFreshnessLoop` 模式可复制
- **BreakerRegistry "l5.reason" site** (debate 023 Q4): LLM 失败有 fallback 闭环
- **Engram bidirectional**: stream_for_compost 读, writeInsight 写 (idempotent since debate 024); `engram_insight_id` 列 reserved 待 push

## 当前 ledger 状态 (real data, 2026-04-26 ~15:00)

```
chains:           12  (8 旧 l5-v1 prompt + 4 新 l5-v1-calibrated)
verdicts:         confirmed=4 refined=0 rejected=2 unjudged=6
positive_rate:    66.7%
mean confidence:  confirmed=0.94 rejected=0.10
derived_from edges: 已加 4 条 (本会话校准链产生)
open_problems:    待统计 (gap-tracker 在 ledger 中跑)
```

## 五个核心架构问题

### Q1 (Seed selection source)：自动跑哪些 seed?

调度器最关键的一刀。错选 = 烧 LLM 跑垃圾 chain → cooldown 触发 → scheduler 自闭环停摆。

- **(a) High ask_count gaps only** — `SELECT * FROM open_problems WHERE ask_count >= 2 AND status='open'` 跑 reasoning。Pro: 用户真实重复发问的明确高需求信号; gap 表 schema 现成; cheapest single-source。Con: 依赖 ask_count 真有数据 (Compost 部署多久了? 用户实际产生了多少 gap?); gap 信号本身是 query miss, 推理可能也 miss。
- **(b) Verdict-similarity** — confirmed chains 的 seed_id → 取其 SPO embedding → ANN k-NN 找相似未推理过的 fact → 推理。Pro: 直接利用刚 ship 的 verdict 信号通道, 自校准; "用户认可的题目类型" 自动扩散。Con: bootstrap 依赖至少几条 confirmed (现在 4 条够); 容易陷入 "永远推 zyloapp 内容" 的 local maximum。
- **(c) Recently-active subjects** — `SELECT subject, COUNT(*) FROM facts WHERE created_at > now-24h GROUP BY subject ORDER BY COUNT DESC LIMIT 3`, 跑每个 subject 最新事实做 seed。Pro: 用户当前关注的领域自动思考 (产品上 Gemini 的 "brain 跟着我的 thread" 直觉); fact 表查询零新依赖。Con: subject 噪音 (engram-pull 一次性灌进 614 facts, 错把 import surge 当成 user activity); 需要"活跃"信号去噪。
- **(d) Multi-source weighted** — (a)+(b)+(c) 三源各产候选, RRF 融合, 取 top N。Pro: ranking_profile 范式复用; 任一源失效另两个兜底。Con: 三套 selection logic 的复杂度膨胀; debate 026 该锁的是 *MVP* 不是终态。
- **(e) Graph density target** — `SELECT subject FROM facts WHERE outbound_link_count<2 ORDER BY recently_referenced LIMIT N`, 跑 fact_links 稀疏区。Pro: 直接服务 debate 025 closed-loop densification 目标 (graph 自动变密); 量化可断言。Con: graph 密度是手段不是目的; 用户感知不到这个 KPI; 可能让 scheduler 跑 "用户根本不在乎" 的 seed。

### Q2 (Cadence)：什么节奏?

LLM 成本 vs proactive 价值。

- **(p) Fixed 6h, max N=3** — 跟 reflect 同 cadence 但独立 ticker; 单 cycle 上限 3 链 ≈ 5min ollama (Mac mini gemma4:31b 实测 60-90s/链)。Pro: 可预测; 跟 reflect 错峰 (reflect 跑完 30min 后开 reason cycle)。Con: 不响应用户活跃度; 6h 固定可能 burn LLM 在用户不在场时。
- **(q) Coupled to reflect** — `startReflectScheduler` 末尾 hook 调 reasoning cycle (reflect 已稳定 cadence 6h, 不再加新 ticker)。Pro: 简单, 一个 daemon timer 一个 wake-up; 跟其他后台工作同步。Con: reflect 失败 → reasoning 也跳过, 耦合风险; reflect cycle 已含 wiki rebuild + LLM, 加 reasoning 把单 cycle 时间从 ~30s 推到 ~5min。
- **(r) Adaptive — verdict-driven cadence** — 默认 6h, 但近 N 链 confirmed_rate ≥ 80% → 加速到 3h (用户认可, 产 chain 越多越好); ≤ 30% → 退到 24h 或 pause。Pro: 真自校准; 质量好就多产, 差就退避; 直接用 verdict 信号闭环。Con: 复杂度; 加速路径可能让用户感觉 "我没标的还在堆", 退避路径可能感觉 "我标了几个就罢工"。
- **(s) Idle-only** — daemon 探测 outbox 队列空 + 无 query 活跃 ≥ 30min, 才跑一次。Pro: 完全不打扰; 用户在场时 LLM 不抢资源。Con: macbook 合盖即停; 需新的 idle 探测机制 (不在现有 scheduler 范式内); 用户期望 "起床看到 brain 想了什么" 可能 idle 永远不触发。

### Q3 (Quality gate / cooldown)：什么时候停跑?

防止 scheduler 在质量崩溃时持续烧 LLM 产垃圾。

- **(i) No gate** — 一直跑, 完全靠 (q) cadence 上限。Pro: 极简; 信任 prompt 校准 + retrieval 质量。Con: 如果哪天 ollama 模型坏了 / prompt 退化, scheduler 会在 24h 内堆 12 条垃圾 rejected chain。
- **(ii) Static threshold** — 启动 cycle 前查 getVerdictStats: 近 N=10 已 judged 链 rejected_rate ≥ 50% → skip cycle (不 pause, 下次还试)。Pro: 自然反应质量回归; 无 manual 干预; verdict 信号已就位。Con: 阈值 (50%? 40%?) 怎么定来自实证; bootstrap 期 unjudged 多, "近 10 条 judged" 可能凑不齐导致 gate 失效。
- **(iii) Verdict-driven cooldown + manual resume** — rejected_rate ≥ threshold → 写 paused=true 状态, 必须 `compost reason scheduler resume` 手动重启。Pro: 强制人工介入审视质量回归; 失败模式可见。Con: 用户可能忘记 resume, scheduler 永久休眠产品死。
- **(iv) Static gate + verdict cooldown 双层** — (ii) 是 per-cycle skip (软), (iii) 是连续 K 轮 skip 后转 paused 持久态 (硬)。Pro: 软+硬两级; 短期波动不打扰用户, 长期回归才求救。Con: 状态机复杂度; 测试可断言但要造数据。

### Q4 (State persistence)：调度器状态存哪?

- **(A) Migration 0020 + 单行 `reasoning_scheduler_state` table** — `(paused BOOLEAN, paused_reason TEXT, paused_at TEXT, last_cycle_at TEXT, last_cycle_stats_json TEXT, consecutive_skipped_cycles INTEGER)`。Pro: 跟其他 ledger 状态同存, 备份/恢复零特殊化, 跨 process safe (SQLite WAL); CLI/MCP 读写一致路径。Con: schema bump 仅为 1 行单元状态, 略重。
- **(B) JSON file** — `${COMPOST_DATA_DIR}/reason-scheduler-state.json`。Pro: 零 migration; 简单。Con: 跟 SQLite ledger 形成两个 truth; 跨 process 无锁; backup 命令需特殊处理。
- **(C) In-memory only** — daemon 重启丢状态, 重新开始。Pro: 极简。Con: cooldown 状态丢 → restart 抹平质量回归记忆; manual pause 不持久。
- **(D) Reuse existing key-value table** — 如已有通用 `daemon_kv` / `system_state` 表则复用。Pro: 零 migration。Con: 现状 grep 显示无此通用表 (本 debate 上下文 grep 验证), (D) 实际等价于 (A) 的 cheaper variant 但需先建通用表 = 比 (A) 重。

### Q5 (User-facing surface)：CLI / MCP 暴露范围?

verdict surface S662 ship 了 CLI + MCP 双通道, 这次是否同样对称?

- **(I) CLI only** — `compost reason scheduler {status|pause|resume}`, MCP 不暴露。Pro: agent 不太需要直接控制 scheduler (那是用户决策); 减少 MCP 工具数。Con: agent 想看 "scheduler 现在什么状态" 时拿不到。
- **(II) CLI + read-only MCP** — CLI 全套, MCP 只暴露 `compost.reason.scheduler.status`。Pro: agent 可读不可写, 控制权在用户; 跟 verdict.stats 一致 (read-only)。Con: 半开半合, 一致性差。
- **(III) Full CLI + Full MCP** — `compost.reason.scheduler.{status, pause, resume}` 全暴露。Pro: 跟 verdict 通道完全对称; agent 检测质量回归可主动 pause。Con: agent 误 pause 后用户不察觉 → 产品死。

## 硬约束

1. **debate 025 §Q4 决议不破**: on-demand path (compost reason run) 永远 first-class, hybrid 是叠加不是替代
2. **verdict 信号通道契约不破**: setVerdict / getVerdictStats / verdict='rejected' 不 archive 状态 (S662 设计)
3. **HC-6 单用户 LLM 成本敏感**: 默认 cycle 上限 ≤ 5 链/小时 (gemma4:31b 60-90s/链, Mac mini 单线程)
4. **chain_id 幂等不破**: scheduler 跑相同 (seed, policy, candidates) 必须复用 reasoning_chains 行 (debate 024 课程)
5. **derived_from write-back 强制**: 调度器跑出的成功链同样必须写 derived_from (debate 025 closed-loop 不可绕)
6. **CHECK constraint freeze**: 0019 user_verdict CHECK 锁死三态 ('confirmed', 'refined', 'rejected'), 任何新 verdict kind 是 schema migration
7. **测试可断言**: scheduler 行为必须可注入时间/伪 LLM, 跑 cooldown / cycle / state-persist 三个维度 fixture
8. **不重复 reflect 已干的事**: reflect 已含 wiki rebuild + LLM 调用, scheduler 不复用它的 cadence (Q2 (q) 选项利弊评估)

## 期望产出

裁定 Q1-Q5 各一个 winner, 给出:
- 每个 Q 的 4-way 投票表
- 真分歧 Q 的 tiebreak rationale
- 落地 patch 估时 + 文件 / 函数 ref (照 025 synthesis 格式)
- "out of scope" 明示哪些 follow-up 切片留给 debate 027+
