# R2 — 🐙 Opus Cross-Critique + 集体投票

## 1. 共识合并 (4 项, 3+/4 voices)

### C1: `correction_candidate` kind 缺失于 `health_signals` CHECK (Sonnet + Codex)
- Sonnet R1 §条件 3: "0010 CHECK 没有 `correction_candidate`, 写入会 constraint violation"
- Codex R1 §条件 1: "先冻结 `health_signals` 与 correction signal 的枚举契约"
- **Opus R1 漏掉了**, 自承. 这是确定性 bug, 必须 0012 migration 或决策"复用 unresolved_contradiction"

### C2: scheduler 没有挂钩 P0 任何任务 (Codex + Opus + Sonnet)
- Codex R1 §条件 4: "明确 scheduler 里 correction / snapshot / backup 的挂载点"
- Opus R1 必须先做 #4: "测一下 daemon scheduler 是否能塞下 P0-7 backup cron"
- Sonnet R1 §"scheduler 没有挂任何 P0 stub"
- **共识**: scheduler 接缝必须先设计后实现

### C3: LLM 降级契约必须先于 P0-6 实现 (Codex + Opus)
- Codex R1 §条件 3: "定义 ask/wiki 的 timeout + fallback 契约"
- Opus R1 必须先做 #2: "承认 LLM abstraction 已存在 (LLMService interface), P0-6 范围缩为 wrap + circuit breaker, 但需先 inventory 调用点"
- **共识**: P0-6 不是从零造接口, 是给现有 LLMService 加 wrapper. 启动前先 grep 调用点 + 写 0.5 页 fallback 设计

### C4: P0 顺序基本对, 但 P0-0/P0-3 关系是真分歧 (见 §2)
- 三方都同意 W1 P0-7 + P0-0 启动, W4 P0-1 收尾
- Week 2-3 微调有差异 (见 §2 分歧 1)

---

## 2. 真分歧

### 分歧 1: P0-0 + P0-3 是否同 PR
- **Codex R1 §3 主张**: "P0-0 + P0-3 同 PR" — 修 stub 测试, 避免 SQL/TS 双重语义漂移
- **Sonnet R1 §3 主张**: "反对捆绑, P0-0 是 migration 0011 已 commit, P0-3 是 TS 实现, 捆绑会让 PR 体积过大且测试边界模糊"
- **Opus 我的裁决**: **Sonnet 对**. Codex 把 P0-0 当成"还没写", 实际 fact_links migration 已 land (commit 8f3100a). P0-0 剩下的是 TS API (`cognitive/fact-links.ts` 新建 — recursive CTE 查询函数). P0-3 是另一个新文件 (`cognitive/graph-health.ts` 改写实现). 两个 TS 模块独立, 应分两个 PR.
- **替代方案**: P0-0 PR 含 fact-links.ts API + 测试; P0-3 PR 在 P0-0 merge 后 24h 内开. 同周完成, 不同 PR.

### 分歧 2: P0-4 提前到 Week 1 vs 留在 Week 2
- **Opus R1 §3 主张**: "P0-4 提前 Week 1 — reflect.ts 已实现 contradiction (line 134-188), 加 archive_reason 是 2 行"
- **Sonnet R1 §3 主张**: "Week 2 串行后 P0-2 — reflect.ts 同时被 P0-2 + P0-4 改, 顺序不能颠倒"
- **Opus 我现在撤回 R1 立场**: Sonnet 对. P0-4 提前到 Week 1 没有缩短关键路径 (W1 已经有 P0-0 + P0-7), 反而增加 Week 1 PR 数量. 留 Week 2, 与 P0-3 / P0-5 并行.

---

## 3. 最终 Go/No-Go (集体投票)

**Conditional Go** (4/4 一致, 含 Gemini 推断同意).

### Pre-P0 Fix List (R2 共识 5 项, ≤ 1 工作日)

1. **修 `correction_candidate` schema 缺失**: 写 migration 0012, ALTER `health_signals.kind` CHECK 加入 `correction_candidate` (Sonnet C1 + Codex C1)
2. **写 ARCHITECTURE 双 audit 表的职责划分**: ranking_audit_log = ranking-only (read path), decision_audit = cognitive write (4 kinds). 一段话, 5 分钟 (Opus R1 #1)
3. **在 ARCHITECTURE 加 LLM 调用 inventory + fallback 矩阵**: grep 找出全部 `llm.generate` 调用点, 列在 ARCHITECTURE.md 一个新章节, 标注每个调用的"失败时怎么办" (Codex C3 + Opus R1 #2)
4. **scheduler.ts 加一个 stub `startBackupScheduler`**: 暂时 no-op, 但定义接口签名 + 时间窗 (默认 03:00 UTC, 远离 reflect 6h 周期), 防止 P0-7 实施时与 reflect lock 冲突 (Codex C4 + Opus R1 #4)
5. **graph-health.ts stub 测试改 baseline**: 0011 已让 v_graph_health 返回真值, 但 graph-health.ts 测试还按 NULL stub 写 (`expect(snap.orphanFacts).toBeNull()` line 56). 改成 `expect(snap.orphanFacts).toBe(0)` (Codex 风险 #2 + Sonnet 盲点 1)

**完成这 5 项后 = Full Go**. 估算总成本: 半天.

---

## 4. 最终 P0 顺序 (R2 共识)

```
Day 0 (Pre-P0 fix, 半天):
  - migration 0012 (correction_candidate kind)
  - ARCHITECTURE.md 双 audit 职责段 + LLM call site inventory
  - scheduler stub
  - graph-health.test.ts 修正 stub baseline

Week 1:
  - P0-7 backup/restore (S, half-week)
  - P0-0 fact-links.ts API + recursive CTE (M, full week)

Week 2:
  - P0-4 archive_reason 写入 reflect.ts (XS, 借力现有 contradiction logic)
  - P0-3 graph-health.ts 实现 + snapshot (S, P0-0 land 后)
  - P0-5 correction-events 捕获 daemon post-drain (S)

Week 3:
  - P0-2 decision_audit 写入 reflect.ts + wiki.ts (M, P0-4 已 merge)
  - P0-6 LLM circuit breaker + Self-Consumption guard (M-S, 借力现有 LLMService)

Week 4:
  - P0-1 triage 整合 5 信号源 (M, 消费 P0-2/3/4/5 产出)
  - 集成测试 + benchmark fixture (P1 启动)
```

---

## 5. 自我修正

**撤回 1**: Opus R1 §3 "P0-4 提前 Week 1". Sonnet 反驳成立 — reflect.ts 串行修改风险 > 提前的边际收益.

**撤回 2**: Opus R1 漏掉了 `correction_candidate` schema CHECK 缺失这个确定性 bug. Sonnet + Codex 各自独立指出, 两人共识 = 100% 必修. 加入 Pre-P0 #1.

**新承认**: Codex R1 "graph-health 测试还按 NULL stub 写" 是我没注意的具体测试不一致. 加入 Pre-P0 #5.
