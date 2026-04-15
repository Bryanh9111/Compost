# R2 — Sonnet 4.6 cross-critique + 集体 Go/No-Go

**参赛者**: Sonnet 4.6 (工程务实 / 范围控制)
**Date**: 2026-04-14

---

### 1. 共识合并 (四方均触及)

**A. Conditional Go，无分歧**
Codex、Opus、Gemini 全部投 Conditional Go 或 Go；我 R1 投 Conditional Go。仅 Gemini 投裸 Go（无条件），但其列出的撤退条件实际是隐式条件，语义上等价。四方投票一致：schema 准备充分，TS stubs 清晰，但有具体前置项必须完成。

**B. graph-health 性能是公认阻塞点**
Codex: "10K facts snapshot 仍 >1s" 作为撤退条件。Opus: "P0-3 benchmark >200ms @10K facts" 作为撤退条件 2。Gemini: 递归 CTE 在复杂网络中内存溢出风险。我 R1 风险 B: 5K facts 阻塞 >200ms 触发暂停。四方均独立收敛到同一点——cluster_count CTE 必须在 P0-3 合并前有基准测试 gate。

**C. LLM call site 数量是 P0-6 规模的决定因素**
Opus 明确: grep `llm.generate|llm.chat|ollama` >5 处则 P0-6 升级为 XL。Codex: 把 LLM fallback 列为顶级风险。Gemini: chaos testing (乱码/断线/延迟) 是盲点。我 R1 风险 C 提到 P0-6 应只改 daemon 路径。四方共识: P0-6 开工前必须先做 call site inventory，15 分钟 grep，结果决定规模。

**D. P0-1 (triage) 必须放在末位**
Codex: Week 4 P0-1 + 集成测试。Opus: "P0-1 留到 Week 4 不只是工程顺序，而是它的设计验证只能在那时"，明确警告不要 Week 1 开 P0-1 PR。Gemini: Week 4 triage 汇总前期所有信号点。我 R1: "P0-1 放 Week 4 正确，因为它消费所有其他 P0 产出的信号"。完全一致，无争议。

---

### 2. 真分歧

**分歧 A: Opus 提议 P0-4 提前到 Week 1 — 我修正立场，部分认可**

我 R1 把 P0-4 放 Week 2。Opus 论据是 "reflect.ts:118 和 :169 各加一行写 archive_reason，XS 改动，别浪费时间槽"。

**部分认可，但有条件**。Opus 的 XS 估算依赖一个假设：P0-4 的 `archive_reason` enum 值在 Week 1 时已经稳定。我 R1 条件 4 指出 P0-4 和 P0-2 都要改 reflect.ts 的 tombstone 路径，必须串行。如果 P0-4 在 Week 1 开工，但 P0-2 的 `archive_reason` 枚举值在 Week 2 设计 decision_audit 时又要扩展，则 Week 1 写入的值就是错的，需要 0012 migration 补。

**结论**: P0-4 可提前到 Week 1，前提是先在 Pre-P0 fix 期间冻结 `archive_reason` 枚举（与 P0-2 的 decision_audit action 类型对齐），否则 Week 1 的 P0-4 是无效工作。Opus 没有提这个联锁依赖。

**分歧 B: Codex 建议 P0-0 + P0-3 同 PR — 维持反对**

Codex: "P0-0 + P0-3 同 PR，改掉 null-stub 预期"。我 R1 明确反对：P0-0 是 migration，P0-3 是 TS 实现，捆绑导致 PR 过大，测试边界模糊。Opus 和 Gemini 均未支持捆绑建议。

Codex 的动机可能是想一次性消灭 null-stub，逻辑有道理，但工程上 migration PR 和 TS 实现 PR 分开合并是最小化回滚单元的基本纪律。P0-0 出问题可以单独回滚 migration，而不牵连 TS 层。维持 R1 立场：不捆绑。

**分歧 C: Opus 发现 ranking_audit_log 与 decision_audit 重叠 — 完全认可**

我 R1 没有覆盖这个点，属于遗漏。Opus 引用 `0004_probabilistic_ranking.sql:24` 的 `ranking_audit_log` 表，指出 P0-2 的 `decision_audit` 语义重叠。Opus 的仲裁合理：ranking_audit_log 服务 ranking-only（查询排序），decision_audit 服务 4 个 cognitive write 路径（contradiction/wiki/excretion/profile_switch）。这是必须在 Pre-P0 明确的 ARCHITECTURE.md 一句话裁决，否则实施 P0-2 时开发者会不知道往哪个表写。我 R1 在这里有盲区，认可 Opus 的发现和解决方案。

---

### 3. 最终 Go/No-Go

**Conditional Go**

Pre-P0 fix list（四方共识，≤1 天完成，5 项硬约束）:

1. **冻结 `archive_reason` 枚举值**: 对齐 P0-4 写入值与 P0-2 的 decision_audit action 类型，写入 schema comment 或 ARCHITECTURE.md，避免 P0-4 Week 1 写入后 Week 2 又要改。
2. **裁决 `ranking_audit_log` vs `decision_audit` 重叠**: 在 ARCHITECTURE.md 加一句话明确两个表的边界（Opus 发现，四方确认为必要）。
3. **LLM call site inventory**: grep `llm.generate|llm.chat|ollama`，确认实际调用点数量，决定 P0-6 是 S/M/L，写进 P0-6 task 描述（Opus/Codex/Gemini 均独立提出）。
4. **`correction_kind` 与 health_signals CHECK 约束对齐**: 决策 P0-5 写入走新 kind `correction_candidate` 还是复用 `unresolved_contradiction`，在 0012 migration stub 里锁定，避免 P0-5 实现时运行时 constraint violation（我 R1 风险 A，确定必踩）。
5. **P0-7 backup cron 时间窗与 reflect 调度隔离验证**: 验证 backup VACUUM INTO 与 reflect 周期不冲突，给 backup 分配独立时间槽（Opus 条目 4，daemon SQLite 单写者锁风险）。

---

### 4. 最终 P0 顺序 (R2 共识整合)

```
Pre-P0 (≤1 天):
  fix list 5 项上述条件

Week 1:
  P0-7  Day 1 优先，生产数据写入前先有 backup CLI
  P0-0  fact_links migration + CTE API 接口定稿
  P0-4  archive_reason 写入 reflect.ts (XS，条件: archive_reason enum 已冻结)

Week 2:
  P0-3  graph-health TS 实现 (依赖 P0-0 merge，含 benchmark gate)
  P0-5  correction_events 捕获 (条件: correction_kind 已对齐 CHECK)

Week 3:
  P0-2  decision_audit 写入点 (依赖 P0-4 已 merge)
  P0-6  LLM circuit breaker (依赖 call site inventory 结果定规模)

Week 4:
  P0-1  triage 整合全部信号源 + e2e 集成测试 + benchmark fixture
```

与 Opus 计划主要一致，将 P0-5 从 Opus 的 Week 2 维持不变，P0-2 维持 Week 3（依赖 P0-4 串行要求）。与 Codex 计划区别：拒绝 P0-0+P0-3 同 PR，P0-2+P0-5 顺序调整。与 Gemini 计划区别：Gemini 顺序过于粗粒度，缺少串行依赖约束。

---

### 5. 自我修正

**R1 遗漏: ranking_audit_log 与 decision_audit 重叠**

我 R1 完整审计了 TS stubs 和 scheduler，但没有检查 0004 migration 的 `ranking_audit_log` 表。Opus 的"考古"发现了这个既有事实。如果不在 Pre-P0 裁决，P0-2 实施时开发者会对两个表的写入路径产生困惑，甚至重复记录。这是我 R1 上下文收集不足的直接结果——我只看了 0010/0011，没有从 0001 开始扫全部 migration 历史。下次对"新表引入"类 P0 项，应先做 `grep -r "audit" schema/` 排查现有同名或同语义表。

---

DONE_R2_SONNET_003
