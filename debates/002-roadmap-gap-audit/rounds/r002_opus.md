# R2 — 🐙 Opus Cross-Critique

## 1. 共识合并 (3+ 项, 4 人都触及)

### 共识 1: `fact_links` 是 P0-3 的隐性必修前置 (4/4)
- Opus R1 §盲点 1: "P0-3 是 stub until fact_links exists"
- Sonnet R1 §B3: "v_graph_health stub 暴露但 fact_links 不存在 → snapshot 写入会爆 NOT NULL constraint"
- Codex R1 §1: "graph_health 是假交付, 必须先做 fact_links + 双 ON DELETE CASCADE"
- Gemini R1 §2: "必须先做 fact_links, 没有边的图是统计列表"

**根因**: ROADMAP 把 fact_links 列在 carried (无 tier), Batch D 把 graph_health 标 P0. 这是一个**隐性循环依赖**, 必须在 ROADMAP 里显式画出.

### 共识 2: Backup / Disaster Recovery 是 P0 (4/4)
- Opus §盲点 2: 备份缺失是数据丢失唯一防线
- Sonnet B1+: migration 无回滚 → 数据库损坏只能 rebuild
- Codex §4: doctor backup/verify/restore + 恢复测试
- Gemini §4 新增: ledger.db 损坏恢复机制

**根因**: Compost = 第二大脑, 数据丢失 = 信任崩塌. 此项不进 P0 等于对用户撒谎说"你的知识在我这里安全".

### 共识 3: LLM 单点 + 静默失败 (4/4)
- Opus §盲点 5: Ollama 单点 + provider 抽象
- Sonnet B2: ask.ts + ingest worker 无降级 → 队列堆积死循环
- Codex 默认带过但 P0 顺序里隐含
- Gemini §1.3: Circuit Breaker, Wiki 标 stale, ask 标 "仅基于事实检索"

**根因**: tp-2026-04-03 把 Ollama 写死. Phase 4 还要加更多 LLM 调用. 不抽象 + 不降级 = 用户每次掉网就以为 Compost 坏了.

### 共识 4 (4/4 但 Codex+Sonnet 更强): Performance baseline 缺失
所有人都列了, Sonnet 给到具体 reflect.ts 全表扫描场景, Codex 给到 1K/10K/100K 三档.

### 共识 5 (3/4): Migration 回滚机制
Sonnet B1, Gemini §1.4, Codex 隐含 (在 schema 健壮性). Opus R1 列在 New 4.

---

## 2. 真分歧 (≥ 2)

### 分歧 1: `memory_procedural` 是否应该 Reject (vs 我 Opus 立场)
- **Gemini §3 主张 Reject**: "用 pinned facts 替代, 单独表是架构过拟合"
- **Opus R1**: 我没给 memory_procedural 明确意见 (Phase 4 carried 项)
- **我现在的反驳**: Gemini 部分对, 但完全 Reject 太重. Procedural 的语义是 "这件事我知道**怎么做**" (步骤 / 检查单 / 序列), 与 fact (subject-predicate-object) 形式不同. pinned facts 表达不了 "step 1 → step 2" 的依赖. 
- **修正**: 降为 P2, 不删. 等 P0 + P1 落地后看是否真的有 stale facts 想做 procedural 而表达不出来.

### 分歧 2: P0 实施顺序 — 谁先?
- **Sonnet 顺序**: P0-4 → P0-5 并行 → P0-2 → fact_links → P0-3 → P0-1
- **Codex 顺序**: fact_links → audit → archive_reason → correction → graph_health → triage
- **Gemini 顺序**: triage 先 ("感知层入口") → archive_reason → fact_links → graph_health → audit → correction
- **Opus R1**: backup + fact_links + PII redact pre-P0, 然后 triage → audit → archive_reason → correction → graph_health
- **我的反驳**: Gemini "triage 先" 不对. triage 的信号源 (stale_fact, contradiction, orphan_delta, stuck_outbox, stale_wiki) 都依赖其他模块产出的状态. 在 audit 没写 / archive_reason 不存在时, triage 输出全是空. 应该是 **audit + archive_reason 先, triage 收尾整合**.
- **Sonnet 的 P0-4 → P0-2 顺序是对的**: archive_reason 是 audit 的写入对象之一, 必须先稳定字段语义.

### 分歧 3: Phase 5 多机同步是否完全砍掉
- **Opus R1**: 砍到 backlog
- **Sonnet B4**: 不砍, 但要先写设计文档 (冲突解决语义)
- **我现在退一步**: Sonnet 对. 直接砍会让"compost export shareable" P1 找不到接收方. 改为: Phase 5 改名 "Portability (later, on demand)", 只保留 export/import + 设计文档, 砍掉 "Multi-host concurrency coordination" 和 "HTTP transport".

---

## 3. 仲裁三大悬案

### 悬案 A: ROADMAP 17 项是否 over-budget
**裁决: 是, 砍到 12 项.**

- **保留**: Batch D 5 P0 (含 backup + fact_links 修正后 = 7 P0)
- **保留 P1**: open_problems, compression_pressure, shareable export, inlet provenance opt-in (4 项)
- **降级 → P2**: four-layer dashboard (Sonnet+Codex 共识), crawl_queue (Codex Reject), semantic chunking Savitzky (Sonnet 已说 reject 等评估)
- **P2 列表**: semantic cohort, milestone retrospective + 上述降级 = 5 项
- **新增 P0**: backup, fact_links, LLM provider abstraction (Sonnet+Opus+Gemini 共识), graph_health bug fix (Sonnet B3)
- 总: 7 P0 + 4 P1 + 5 P2 = 16 项 (略缩)

### 悬案 B: P0-3 graph_health 推迟? 还是 fact_links 提到 P0-0?
**裁决: fact_links 提到 P0-0 (prerequisite), P0-3 graph_health TS 实现与 fact_links 同 PR**.

理由 (合并 Sonnet + Codex): fact_links migration 0011 必须在 P0-3 TS 实现前 land. 单独发 P0-3 没意义. 同时 fix Sonnet B3 指出的 NOT NULL 约束 bug — 在 0011 同时 ALTER `graph_health_snapshot` 加 DEFAULT 0.

### 悬案 C: Backup 进 P0 / P1 / Pre-P0?
**裁决: P0 (与 triage / audit 同等), 不放 Pre-P0 因为不阻塞其他 P0 实施**.

理由: backup 是独立模块 (cron + SQLite .backup), 与其他 P0 平行进行. 放 Pre-P0 会拖延 schedule. 放 P1 是错的 — 用户 6 个月后断电就晚了. P0 + 与 triage 平行启动.

---

## 4. 最终新增 P0 列表 (R2 裁决, 上限 8)

| # | P0 项 | 类型 | 来源 |
|---|---|---|---|
| P0-0 | `fact_links` 表 + 双向 link API | NEW (从 carried 提升) | 4/4 共识依赖 |
| P0-1 | `compost triage` + health_signals (修 NOT NULL bug) | 现有 | Batch D |
| P0-2 | `decision_audit` + 置信度阶梯 | 现有 | Batch D |
| P0-3 | `v_graph_health` + snapshot (与 P0-0 同 PR) | 现有 (修正) | Batch D |
| P0-4 | facts archive_reason + replaced_by | 现有 | Batch D |
| P0-5 | `correction_events` (信号挂 triage 不直接改 confidence — Gemini §1.5) | 现有 (修正) | Batch D |
| P0-6 | **Backup / Restore** (`compost backup`/`restore` + 24h cron) | NEW | 4/4 共识 |
| P0-7 | **LLM provider abstraction + circuit breaker** (3/4 共识) | NEW | Opus+Sonnet+Gemini |

**总: 8 P0 (满额)**.

⚠️ PII redact (Opus R1 盲点 4) **降为 P1**, 因为它独立于其他 P0, 但开源前必修. Migration rollback (Sonnet B1) 也降为 P1, 因为 backup (P0-6) 已经覆盖了"出错怎么办"的兜底.

---

## 5. 自我修正

**撤回**: Opus R1 §3 Cut 1 "Phase 5 整体降级到 backlog". Sonnet B4 的反驳成立 — Phase 5 应保留 portability (export/import + 设计文档), 但**砍掉 multi-host concurrency 和 HTTP transport**. 这两项是 enterprise 假需求, 而单机 portability (换电脑) 是真实场景.

**新承认**: Gemini §独特视角 "Self-Consumption Pollution" (LLM 生成 wiki 又被 ingest 形成正反馈) 是我 R1 完全没看见的. 这个长期风险**应作为 P0-7 (LLM abstraction) 的子要求**: extractor 必须能识别 source 是否来自 wiki/ 目录, 拒绝再 ingest.
