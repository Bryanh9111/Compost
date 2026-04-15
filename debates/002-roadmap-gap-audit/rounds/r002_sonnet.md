# R2 — 🟠 Sonnet 4.6 Cross-Critique + 仲裁
> Debate 002: Phase 4-6 路线图 Gap 审计 Round 2
> 2026-04-14

---

## 1. 共识合并 (四方收敛的 root 问题)

**C1. fact_links 是 P0-3 的真实阻断前置条件**
Codex: "应先做 fact_links, 否则 P0-3 只是返回 NULL 的占位 view." Gemini: "没有边的图只是统计列表, v_graph_health 将毫无意义." Opus: "把 fact-to-fact links graph 从 carried 提到 P0-0 (prerequisite)." Sonnet R1: "P0-3 TS 实现与 fact_links 功能捆绑同一 PR." 四方一致, 这是最强共识, 无争议.

**C2. 备份/灾难恢复是当前最高优先的缺失项**
Opus: "所有 Phase 0-6 投入的工程价值在数据丢失瞬间归零. 这是 second brain 的信任契约." Codex: "加 doctor backup/verify/restore + 恢复测试." Gemini: "增加 compost backup 和基于 observations 重新提取 facts 的灾后重建脚本." Sonnet R1: "compost backup 底层调用 VACUUM INTO, 每日自动备份." 四方都提到, root 问题: SQLite 是唯一真相源但没有保护层.

**C3. 性能基线完全缺失, 规模边界未知**
Codex: "先补 benchmark fixture + CI 阈值." Gemini: "应在 P4 引入 performance_telemetry 表." Opus: "至少 3 个 benchmark: reflect-1k/10k/100k.bench.ts, 回归 > 50% 报警." Sonnet R1: "compost bench 子命令, 生成合成 facts 并测量耗时." 四方一致, root 问题: 路线图目标 100 万 facts 但从不测量.

**C4. LLM 单点故障无降级策略**
Gemini 盲点 1.3: "Circuit Breaker 模式, LLM 不可用时显式标记 Wiki 为 stale." Opus 盲点 5: "谈及 LLM Provider Abstraction, IExtractorClient 接口." Sonnet R1 B2: "LLMService 加 timeout + fallback." Codex 没有单独列出, 但在 P0 列表中隐含了稳健性要求.

---

## 2. 真分歧 (具体反驳)

**分歧 A: Gemini 把 audit log bloat 列为 P1 盲点 — 过早优化**

Gemini R1 盲点 1.2: "decision_audit 在高频摄入场景下审计数据量可能迅速超过事实本身." 这个判断的触发条件是"大量重复/矛盾信息输入 (如持续抓取动态网页)". 但 Compost 是 first-party 原则 + hook-shim 捕获. 它不是爬虫, ingest 速率受限于用户实际使用 Claude Code 的频率. decision_audit 的写入仅在 reflect (6h 周期) 和矛盾仲裁时触发, 不是每次 ingest. Gemini 把 web-scraper 规模的风险嫁接到个人工具上. P4 P1 的 TTL 设计完全是 YAGNI — 在 decision_audit 表甚至还没有 1000 行之前就设计 TTL 是浪费. 反驳: 这项不应进 P4 任何优先级列表, 推迟到 Phase 5 有实际规模数据后再评估.

**分歧 B: Opus 提议砍掉 Phase 5 整体 — 方向正确但裁决过猛**

Opus R1 Cut 1: "Multi-host sync 是 enterprise 需求, 砍到等出现明确需求再启动." 问题在于 Phase 5 的核心是 "export/import" — 这不是多机协议, 是单用户换机器或备份. ROADMAP 写 "explicit export/import" 正好是最小可行的 portability 方案. Opus 自己也说 "留一个 compost export markdown (P1 已有) 作为最简 portability" — 但 compost export 和 Phase 5 的 export bundle 是同一需求的不同精度. 砍掉 Phase 5 整体会导致换机场景完全没有结构化支持. 反驳: Phase 5 应该裁剪为 "export/import bundle (单机 portability)" + 移除 "Multi-host concurrency coordination" 这个真正的 enterprise 项. 不是砍整体, 是精确切割.

---

## 3. 仲裁三大悬案

**悬案 A: ROADMAP 17 项是否 over-budget?**

裁决: **是的, 缩减到 13 项.**

砍掉/降级:
1. `four-layer self-model dashboard` (P1 → P2): Codex 建议降级, Opus 同意, Sonnet R1 同意. triage + stats 已覆盖其实质.
2. `crawl_queue` (P1 → Reject): Codex 明确 Reject, first-party 原则下这是 open_problems 的重复.
3. `semantic chunking / Savitzky-Golay` (P1 carried → Reject): Sonnet R1 Reject, 无评估框架下实现是盲目优化.
4. `compression_pressure SQL view` (P1 → P2): Gemini 建议降到 P2, 在 archive_reason + triage 未在大规模验证前是玄学指标.

保留 17 - 4 = 13 项. 同时新增 3 项 (Backup + bench + PII redact) 净变化 = 13 + 3 = 16 项, 但原 P0/P1 各减负, 可接受.

**悬案 B: P0-3 graph_health 推迟? 或 fact_links 提到 P0-0?**

裁决: **fact_links 提到 P0-0 (prerequisite), P0-3 不推迟但捆绑实现.**

理由: 推迟 P0-3 会让 triage 的 orphan_delta 信号永远缺席, 影响 Phase 4 整体健康监控价值. 正确做法是: fact_links 表 migration (0011) 作为 P0-0 prerequisite 先 merge; P0-3 的 TS 实现与 fact_links API 捆绑同一 PR 交付, 不允许单独先发 P0-3 stub 实现. Gemini 的 "没明确表态" 反而说明这个问题的答案没有歧义 — 四方中三方明确说 fact_links 必须先, Gemini 隐含同意. P0-3 本身不推迟, 但其 TS 实现依赖 fact_links 落地.

**悬案 C: Backup/Disaster Recovery 进 P0/P1/Pre-P0?**

裁决: **P4 P0 (与现有 P0 并列, 不是 Pre-P0).**

Opus 建议 Pre-P0, Codex 和 Sonnet R1 建议 P1 或 P0. 反驳 Pre-P0: Pre-P0 含义是"所有 P0 工作开始之前必须完成", 但实际上 P0-1 triage / P0-2 decision_audit 在本地 db 丢失时同样归零. 让 backup 晚于 P0-1/P0-4 落地并不增加实质风险 — 因为 Phase 4 Batch D 开始时数据量极少, 丢失代价低. 但 Phase 4 完成后用户开始日常 dogfood, 此时没有 backup 才是真风险. 所以: backup 在 Phase 4 P0 列表末尾 (实现成本 ~100 行, 阻断日常 dogfood 后的数据丢失), 不需要比 P0-4 更早.

---

## 4. 最终新增 P0 列表 (R2 裁决, Phase 4 P0 完整列表)

| # | 项目 | 前置 | 说明 |
|---|------|------|------|
| P0-0 | `fact_links` 表 + 双向 FK + ON DELETE CASCADE | 无 | prerequisite for P0-3; 从 carried 提升 |
| P0-1 | `compost triage` (health_signals) | 0009/0008/0007 | 原列表, 保留 |
| P0-2 | `decision_audit` 表 + 写入点 | P0-4 语义稳定 | 原列表, 保留 |
| P0-3 | `v_graph_health` TS 实现 + snapshot | P0-0 | 捆绑 fact_links PR, 原列表 |
| P0-4 | `archive_reason` + `replaced_by_fact_id` + `revival_at` | facts 表 | 原列表, 保留 |
| P0-5 | `correction_events` 捕获 | hook-shim | 原列表, 保留 |
| P0-6 | LLM 降级策略 (timeout + fallback + [LLM unavailable] 标注) | 无 | 新增; Gemini/Opus/Sonnet 三方共识 |
| P0-7 | `compost backup` + daemon 每日自动备份 (VACUUM INTO) | 无 | 新增; 四方共识; 日常 dogfood 前必须有 |

共 8 项 (原 5 + 新增 3: P0-0 fact_links 升级 + P0-6 LLM 降级 + P0-7 backup). 上限 8 项, 刚好.

---

## 5. 自我修正

**修正: R1 将 backup 放在 P1 — 降级不当.**

Sonnet R1 第 4.1 节写 "Phase: Phase 4 P1 (与 P0 同批次发布前完成)." 但看完 Opus 的论证 ("第二大脑的信任契约", "所有 Phase 0-6 投入的工程价值在数据丢失瞬间归零") 以及 Codex 的 "跨 phase 必要项", 把 backup 放 P1 是错误的. P1 意味着 P0 全部完成后才做, 而 P0 落地时 triage / decision_audit 数据已经开始积累. 正确分级是 P0 末位 (P0-7), 确保进入日常使用前数据有保护. 原 R1 因为强调 KISS + 最小范围而低估了数据丢失的不可逆性.
