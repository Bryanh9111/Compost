# Debate 003 — Synthesis: P0 Readiness Gate

> 🐙 Opus 主持终裁 · 2026-04-14
> Participants: 🔴 Codex / 🟡 Gemini / 🟠 Sonnet / 🐙 Opus
> Rounds: R1 (4/4) + R2 (3/4 — Gemini R1 quota issues, R2 skipped)
> Decision: **Go / Conditional Go / No-Go**

---

## 🟢 最终裁决: **Conditional Go**

四方一致 (Codex Conditional / Sonnet Conditional / Opus Conditional / Gemini Go-with-implicit-conditions). Schema 准备充分, TS stubs 落点清晰, 但有 6 个 Pre-P0 fix 必须先做.

**完成 6 项 Pre-P0 fix (估算 ≤ 1 工作日) → 全速 Go**.

---

## Pre-P0 Fix List (6 项, 4/4 共识必修)

| # | Fix | 理由 / 来源 | 工作量 |
|---|---|---|---|
| 1 | **冻结 `facts.archive_reason` 枚举** (与 P0-2 decision_audit `kind` 对齐), 写入 ARCHITECTURE.md | Sonnet R2 新增 — 否则 Week 1 P0-4 写入值 Week 2 又要改, 触发 0012 补救 migration | 30 min |
| 2 | **裁决 `ranking_audit_log` vs `decision_audit` 边界** (ARCHITECTURE.md 一段话: ranking-only vs cognitive write 4 kinds) | Opus R1 #1, Sonnet R2 §3 完全认可 | 5 min |
| 3 | **LLM call site inventory + fallback 矩阵** (grep 全部 `llm.generate` / `llm.chat` / ollama, 列在 ARCHITECTURE.md, 标注每个调用的失败兜底策略) | Codex R1 C3 + Opus R1 #2 — 决定 P0-6 是 S/M/L | 30 min |
| 4 | **`correction_candidate` schema 缺失** — 写 migration 0012 给 `health_signals.kind` CHECK 加该值, OR 在 ARCHITECTURE.md 决策复用 `unresolved_contradiction` | Sonnet R1 风险 A + Codex R1 C1 (确定性 bug, 不修则 P0-5 运行时 constraint violation) | 1 hour |
| 5 | **scheduler.ts 加 `startBackupScheduler` stub** (no-op, 但定义接口签名 + backup 时间窗 03:00 UTC, 远离 reflect 6h 周期) | Codex R1 C4 + Opus R1 #4 + Sonnet R1 §scheduler — 防 P0-7 实施时与 reflect SQLite writer-lock 冲突 | 1 hour |
| 6 | **修 `graph-health.test.ts` stub baseline** — 0011 让 v_graph_health 返回真值 (0 / 0 / 0), 但测试还按 NULL stub 写 (`expect(snap.orphanFacts).toBeNull()` line 56). 改为 `expect(snap.orphanFacts).toBe(0)` | Codex R1 风险 B + Sonnet R1 盲点 1 | 15 min |

**总成本: ~3 小时. 跑 `bun test` 验证全绿后 = Full Go.**

---

## 一致共识 (4/4 R1 触及)

### C1: `correction_candidate` kind 缺失 (Codex + Sonnet)
- Codex C1: "先冻结 `health_signals` 与 correction signal 的枚举契约"
- Sonnet C3: "0010 CHECK 没有 `correction_candidate`, 写入会 constraint violation"
- → Pre-P0 #4

### C2: scheduler 没挂 P0 任务 (Codex + Opus + Sonnet)
- Codex C4: "scheduler 里 correction / snapshot / backup 挂载点未定义"
- Opus #4: "scheduler 是否能塞下 P0-7 backup cron 与 reflect 不冲突?"
- Sonnet: "scheduler 没有挂任何 P0 stub, daemon 当前稳定"
- → Pre-P0 #5

### C3: LLM 降级契约必须先于 P0-6 (Codex + Opus + Gemini)
- Codex C3: "定义 ask/wiki 的 timeout + fallback 契约"
- Opus #2: "P0-6 不是从零造接口 (LLMService 已存在), 但需先 inventory 调用点决定规模"
- Gemini 风险 1: "Self-Consumption Loop — extractor 拒绝处理系统自身生成路径"
- → Pre-P0 #3

### C4: graph-health 性能 gate 必修 (4/4)
- Codex 撤退条件: "10K facts snapshot >1s"
- Opus 撤退条件 2: ">200ms @10K facts"
- Sonnet 风险 B: "5K facts 阻塞 >200ms"
- Gemini 测试盲点: "递归 CTE 内存溢出风险"
- → 进入 P0-3 实施 acceptance gate (不是 Pre-P0)

### C5: P0-1 (triage) 必须放 Week 4 (4/4)
- 全部 4 方独立得出. P0-1 是其他 5 个 P0 的下游消费者, 提前开是炫技.

---

## 真分歧 (R2 解决)

### 分歧 1: P0-0 + P0-3 是否同 PR
- Codex 主张 (R1+R2 维持): 同 PR 一次性消灭 null-stub
- Sonnet 维持反对: PR 体积 + 测试边界 + 回滚单元
- Opus 同意 Sonnet
- **裁决**: **不捆绑**. 同周完成不同 PR (P0-0 先 merge, P0-3 在 24h 内开 PR)

### 分歧 2: P0-4 提前到 Week 1
- Opus R1 主张, Sonnet R1 反对 (Week 2)
- Sonnet R2 部分认可: **可以提前, 前提 Pre-P0 先冻结 archive_reason 枚举**
- Opus R2 撤回 Week 1 立场 — 但 Sonnet 提供了让 Week 1 可行的关键条件 (Pre-P0 #1)
- **裁决**: P0-4 进 Week 1, **前提是 Pre-P0 #1 完成**. 否则推迟 Week 2.

### 分歧 3: Gemini 投 Go (无条件) vs 三方 Conditional
- Gemini R1 投裸 Go, 但其撤退条件 (备份还原失败 / 语义检索骤降) 实际是隐式 Conditional
- Codex R2 §2 明确反对 Gemini 的 Go
- **裁决**: 视为 Conditional (Gemini 自己的撤退条件就是条件)

---

## 最终 P0 实施时序 (4/4 R2 共识, 已含 Pre-P0)

```
Day 0 (Pre-P0, ≤ 1 工作日):
  ├─ #1 冻结 archive_reason 枚举 (与 decision_audit kind 对齐)
  ├─ #2 ARCHITECTURE.md: ranking_audit_log vs decision_audit 职责
  ├─ #3 ARCHITECTURE.md: LLM call site inventory + fallback 矩阵
  ├─ #4 migration 0012: correction_candidate kind in health_signals CHECK
  ├─ #5 scheduler.ts: startBackupScheduler stub + 时间窗
  └─ #6 graph-health.test.ts: 修 stub baseline (NULL → 0)

Week 1 (data + foundation):
  ├─ P0-7  backup/restore CLI + daemon cron (Day 1 优先)
  ├─ P0-0  fact-links.ts API + recursive CTE (M, full week)
  └─ P0-4  archive_reason 写入 reflect.ts (XS, 借力现有 contradiction logic)

Week 2 (signal generators):
  ├─ P0-3  graph-health.ts 实现 + snapshot (依赖 P0-0, 含 benchmark gate)
  └─ P0-5  correction_events 捕获 (daemon post-drain, 非 hook 路径)

Week 3 (audit + reliability):
  ├─ P0-2  decision_audit 写入点 reflect.ts + wiki.ts (依赖 P0-4 已 merge)
  └─ P0-6  LLM circuit breaker + Self-Consumption guard (依赖 #3 inventory)

Week 4 (consumer + validation):
  ├─ P0-1  compost triage 整合 5 信号源 (集成测试)
  └─ P1 启动: benchmark fixture (1K/10K/100K reflect/triage/graph CTE 基线)
```

---

## Top 5 实施风险 (跨 R1 整合, 概率 × 影响排序)

| # | 风险 | 概率 | 影响 | 预防 |
|---|---|---|---|---|
| 1 | **`correction_candidate` schema constraint violation** (P0-5) | 高 | 高 | Pre-P0 #4 修 |
| 2 | **graph-health.ts cluster_count CTE 在 10K facts 阻塞 SQLite writer** (P0-3) | 中 | 高 | benchmark gate (acceptance criterion); 必要时分批 + LIMIT |
| 3 | **P0-6 实际是 L 而非 M** (3+ LLM 调用点 + fallback design + Self-Consumption guard) | 高 | 中 | Pre-P0 #3 inventory; 决定后再开工 |
| 4 | **reflect.ts 串行修改冲突** (P0-2 + P0-4 都改 tombstone path) | 中 | 中 | 严格 P0-4 先 merge, P0-2 后. 在 P0-4 PR 锁定函数签名 |
| 5 | **P0-7 backup 与 reflect SQLite writer-lock 冲突** | 中 | 高 | Pre-P0 #5 给 backup 独立时间窗 (03:00 UTC) |

---

## 撤退条件 (R1 整合, 任一触发则暂停 P0)

1. **Pre-P0 fix 实施超 1.5 工作日** — 说明问题比预期复杂, 评估是否需要 Phase 4 整体重新规划
2. **P0-0 fact-links API 实施 > 5 工作日** — 评估是否应放弃 SQLite graph 改用专门 graph 库
3. **P0-3 benchmark 在 10K facts/50K links > 200ms** — 触发 graph_health 重设计 (incremental update vs query-time scan)
4. **LLM call site inventory 发现 > 5 处** — P0-6 升级为 XL, 排到 Phase 5
5. **任何 P0 PR 让 monorepo test pass 数 < 150** — 必须先修绿才能 merge
6. **backup 与 reflect 同时跑导致 daemon 锁 > 30s** — Pre-P0 #5 验证不充分, 重新设计调度

---

## 测试覆盖必修项 (随 P0 PR 一起 land)

### P0-0 测试
- recursive CTE 在有环图 / 深度 > 10 时不内存溢出 (Gemini R1)
- ON DELETE CASCADE 行为: archived (UPDATE archived_at) 不触发 cascade, 真 DELETE 才触发 (Sonnet 盲点 3)
- benchmark: 1K / 10K nodes 性能基线

### P0-3 测试
- empty DB INSERT (Sonnet 盲点 1): `takeSnapshot()` 在无 facts 时正常写入 0/0/0
- benchmark gate: < 200ms @ 10K facts (撤退条件 3)
- cluster_count CTE 不阻塞 SQLite writer > 100ms

### P0-5 测试
- e2e: insert correction_event → call triage() → verify health_signal (Sonnet 盲点 2)
- 7 个 regex pattern 各有 fixture (现有 detect 测试已覆盖)
- 误判检测 (Gemini 风险 3): "其实" / "scratch that" 在中性上下文不触发

### P0-6 测试
- LLM mock infrastructure (Opus 盲点 A): `MockLLMService` (timeout / 5xx / hang / garbage)
- chaos: Ollama 离线时 ingest worker 不死循环
- Self-Consumption: ingest 收到 wiki/ 路径 source → 拒绝 (Gemini R1)

### P0-7 测试
- backup during reflect (chaos): 都跑能完成, 不锁 > 5s
- daemon kill mid-backup: 重启后能识别不完整 backup 跳过
- restore 一致性: 备份 → 写 100 facts → restore → 验证 100 facts 恢复

---

## 集体自我修正

| 参赛者 | 撤回 |
|---|---|
| **Opus** | "P0-4 提前 Week 1" 无条件 → 改为 "前提 Pre-P0 #1 完成" |
| **Opus** | 漏掉 `correction_candidate` schema bug, Sonnet+Codex 共识必修 |
| **Codex** | "P0-0 + P0-3 同 PR" → 撤回, 同周不同 PR |
| **Sonnet** | R1 只审计 0010/0011, 漏 0004 ranking_audit_log. 教训: 新表引入前必须 grep 全 schema 历史 |
| **Gemini** | R1 投裸 Go, 撤退条件实际是隐式 Conditional. R2 (未参与) 推断同意 Conditional |

---

## 元教训 (本次 readiness 审计学到)

1. **"已 commit 的 schema 仍可能有未发现的 constraint bug"**. 0010 commit 时所有人 review 通过, 但 `correction_candidate` 枚举 / `graph_health_snapshot` NOT NULL 都是后续审计才发现. 教训: schema PR 必须有"列出所有 INSERT 语句的可能 kind 值并对照 CHECK" 的 review checklist.

2. **TS stub 的测试是技术债的隐形累积**. 当前 10 个 skip test 看起来是 TDD red phase, 但其中 graph-health.test.ts 已经过期 (0011 让 view 返真值). Stub 测试必须随 schema 变化同步更新, 否则比没测试更糟 (假绿).

3. **"既有代码考古" 是 readiness 审计的最大产出**. Opus R1 4 项 Pre-P0 fix 全是 "已经存在但被忽略的事实" (ranking_audit_log / LLMService / reflect.ts contradiction logic / scheduler 限制). 这些不是新设计, 是没读. 教训: 任何 P0 启动前必须 30 分钟 grep 已有同语义代码.

4. **"Conditional Go" 比 "Go" 更值得信任**. Gemini 唯一投 Go, 但其撤退条件实际描述了 No-Go 信号. 健康的工程团队 R1 vote 应该有 70%+ 是 Conditional (有具体条件), 100% Go 是 red flag (没认真审).
