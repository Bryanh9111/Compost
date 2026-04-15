# R1 — Sonnet 4.6 视角: P0 实施准备度裁决

**参赛者**: Sonnet 4.6 (工程务实 / 范围控制 / 真实估算)
**Date**: 2026-04-14
**Branch**: feat/phase4-batch-d-myco-integration @ 8f3100a

---

## 1. Go/No-Go 投票

**Conditional Go**

**理由**:

schema 基础扎实。0010 + 0011 两个 migration 覆盖所有 P0 必需表: `health_signals`, `decision_audit`, `graph_health_snapshot`, `fact_links`, `correction_events`, 以及 `facts` 三列扩展。0011 正确修复了我在 debate 002 B3 发现的 NOT NULL bug (DROP/recreate + DEFAULT 0)，并且把 `v_graph_health` 从空壳 view 升级为 fact_links 驱动的实现。

TS stubs 状态清晰可控:

- `triage.ts`: 签名完整，返回空 report (非 throw) — P0-1 可以安全开工
- `audit.ts`: `recordDecision` throw，但只在 P0-2 写入点被调用 — 不影响存量路径
- `graph-health.ts`: `takeSnapshot` throw，`currentSnapshot` 返回 null 占位 — daemon 未挂 takeSnapshot，无立即崩溃风险
- `correction-detector.ts`: `detectCorrection` 有真实实现 (7 个 regex 模式)；`recordCorrection` throw — P0-5 可以安全增量落地

`scheduler.ts` 验证: `startReflectScheduler` 调用 `reflect()`，`reflect()` 已全量实现（Phase 3 contradiction resolution + tombstone）。**scheduler 没有挂任何 P0 stub**，daemon 当前不会因 stub 崩溃。

`hook-shim/src/index.ts` 验证: 纯 SQLite outbox append，没有对 correction_events 或 triage 的调用。P0-5 加入 correction 检测时需要在 **daemon post-drain** 路径挂，不是在 shim 里，合规。

**具体条件** (满足才可全速开工，最多 5 项):

1. **P0-7 必须 Week 1 第一天启动**: 在任何 schema 变更写入生产 ledger.db 之前，先有 backup CLI 和首次快照。数据不可逆，顺序不能倒。
2. **P0-0 fact_links 的 recursive CTE API 需要事先确定接口签名**: `graph-health.ts` 的 `delta()` 依赖它，P0-3 紧跟。接口未定就开始 P0-3 TS 实现会引入协调浪费。
3. **`correction-detector.ts` 的 `health_signals` 写入路径在 P0-5 完成前必须明确**: 目前 `findRelatedFacts()` 返回 `string[]` 但 comment 说"流入 triage"，然而 `health_signals` 的 CHECK constraint 没有 `correction_candidate` kind。写入前必须确认是加新 kind 还是复用 `unresolved_contradiction`。
4. **P0-2 写入点 (reflect.ts) 需要在 P0-4 archive_reason enum 稳定后再动**: reflect.ts 当前 tombstone 路径直接 SET archived_at，P0-2 和 P0-4 都要改这里，合并冲突风险高。按 synthesis 顺序 P0-4 先，P0-2 后，不能颠倒。
5. **10 个 skip 测试的覆盖计划需要在 Week 1 内写完 (不是 Week 4)**: 当前 3 个 RED test 在 `triage.test.ts`，其余 P0 几乎无测试。Week 4 才补测试是事后验证，不是 TDD。

---

## 2. Top 3 实施风险

### 风险 A: correction_kind 不在 health_signals CHECK 约束
- **概率**: 高 (确定会踩)
- **影响**: 高 (P0-5 INSERT 在运行时抛 constraint violation)
- **触发场景**: P0-5 实现 `recordCorrection` 后，调用 `findRelatedFacts()` 把结果写入 `health_signals`，但 `kind` CHECK 只允许 5 个值，没有 `correction_candidate`。
- **损失**: P0-5 无法写入任何信号，correction 捕获功能形同虚设，且需要 0012 migration 补 ALTER (已 commit 不能回改 0010)。
- **预防**: P0-5 开工前，决策: 加 `correction_candidate` 到 0012 migration CHECK，或复用 `unresolved_contradiction` + `target_ref` 标注，**在代码写之前定死**。

### 风险 B: graph-health.ts cluster_count 的 CTE 计算量未知
- **概率**: 中
- **影响**: 高 (daemon snapshot 可能阻塞 SQLite writer lock 数秒)
- **触发场景**: P0-3 实现 connected components recursive CTE，fact 数量达到 10K+ 时，全图遍历在 SQLite 单线程下阻塞所有并发写入，ingest worker 超时或 hook-shim 的 WAL busy_timeout 500ms 耗尽。
- **损失**: daemon 停止处理 outbox + hook 返回 exit 2 (Claude Code 侧可见错误)。
- **预防**: P0-3 实现时必须加 LIMIT + 分批计算，或把 cluster_count 的 CTE 移出事务。`takeSnapshot` 调用前先用 `PRAGMA analysis_limit` 评估。

### 风险 C: reflect.ts 并发改动 (P0-2 + P0-4 同时需要修改 tombstone 路径)
- **概率**: 中
- **影响**: 中 (merge 冲突导致延误，或静默 bug: archive_reason 写入被覆盖)
- **触发场景**: Week 2 同时开工 P0-4 (archive_reason 写入) 和 P0-3；Week 3 再加 P0-2 (decision_audit 写入 reflect)。如果 P0-4 和 P0-2 PR 不按序合并，tombstone step 里的字段写入互相覆盖。
- **损失**: `archive_reason` 写入后被 P0-2 PR 的 reflect 改动覆盖 NULL，无 test 覆盖时难以发现。
- **预防**: reflect.ts 相关 PR 按 P0-4 -> P0-2 顺序串行合并，或在 P0-4 PR 里锁定 tombstone 函数签名，P0-2 PR 只在 decision_audit 写入点追加不重写。

---

## 3. P0 顺序裁决

synthesis 提议的顺序整体认可，但需要两处调整:

**Week 1**: P0-7 (Day 1 优先，生产有数据后立即) + P0-0 (fact_links migration + CTE API 接口定稿)

**Week 2**: P0-4 (archive_reason 写入 reflect，独立 PR) + P0-3 (graph-health TS，依赖 P0-0 CTE) + P0-5 (correction 捕获，但必须先解决 Condition 3 的 kind 问题)

> **调整**: synthesis 把 P0-3 写成"与 P0-0 捆绑同 PR"。**反对**。P0-0 是 migration，P0-3 是 TS 实现，捆绑会让 PR 体积过大且测试边界模糊。正确做法: P0-0 PR 只含 migration + CTE 查询函数；P0-3 PR 在 P0-0 merge 后立即开，同 Week 2 完成。

**Week 3**: P0-2 (decision_audit 写入，P0-4 必须已 merge) + P0-6 (LLM circuit breaker + Self-Consumption guard)

**Week 4**: P0-1 (triage 整合全部信号源，P0-3/P0-5 提供信号) + 集成测试 + benchmark fixture

> **调整**: P0-1 放 Week 4 正确，因为它消费所有其他 P0 产出的信号。Week 4 benchmark 应与 P0-1 并行，不是 P0-1 完成后。

---

## 4. 测试覆盖盲点

### 盲点 1: graph_health_snapshot NOT NULL 路径无写入测试
- **位置**: 0011 修复了 DEFAULT 0，但没有测试验证 `takeSnapshot()` INSERT 路径在 null 信号下正常写入 (orphan_facts=0, density=0.0 等)。
- **应加**: P0-3 的 test 文件里加 "takeSnapshot on empty DB inserts row with defaults" 用例。如果这个路径没测试，0010 的 bug 模式会在下次 migration 中重演。

### 盲点 2: correction_events processed_at 消费路径无测试
- **位置**: `correction-detector.ts` 的 `findRelatedFacts()` 输出"流入 triage"，但 triage.ts 当前不消费 correction_events。两者之间的管道完全没有集成测试。
- **应加**: P0-5 测试里必须包含 end-to-end: insert correction_event -> call triage() -> verify health_signal 出现。否则信号管道在任何重构后都是静默断裂的。

### 盲点 3 (额外): fact_links ON DELETE CASCADE 行为未验证
- **位置**: 0011 定义了双向 FK + CASCADE，但没有测试: 当 `facts` 中的行被 reflect 的 tombstone 路径 archived 时，CASCADE 是否预期触发 (archived 不是 DELETE，CASCADE 不会触发)。
- **应加**: P0-0 测试里加一个 "archiving a fact does NOT cascade links; deleting does" 断言，避免后续误以为 CASCADE 处理了孤儿边。

---

## 5. 撤退条件

### 条件 1: fact_links recursive CTE 在 5K facts 时阻塞 > 200ms
- **信号**: Week 1 P0-0 PR 的基准测试显示 cluster_count CTE 在 5K nodes 上超过 200ms。
- **动作**: 暂停 P0-3 的 cluster_count 实现，退化到 view 中返回常量 0 (0011 已这样做)，把完整 CTE 推迟到 P1 benchmark harness 建立后评估。不阻塞其他 P0。

### 条件 2: P0-6 LLM circuit breaker 引入新 async 路径导致 hook-shim 冷启动超过 20ms
- **信号**: P0-6 实现时如果把任何 LLM 超时逻辑错误地拉入 hook-shim 依赖链，`index.ts` 的冷启动从 8ms 爬升超过 20ms (现有 spec 硬上限)。
- **测量**: P0-6 PR review 前跑 `hyperfine 'bun packages/compost-hook-shim/src/index.ts'`，超过 20ms 立即打回，不合并。
- **注**: P0-6 应只改 daemon 路径，hook-shim 路径应完全不受影响。这个条件是防止意外污染。

---

## 6. 独特视角 (Sonnet 告诫)

现在有 8 个 stub throw 等待实现，但 scheduler.ts 里没有挂任何一个 — 这是好事，意味着 daemon 当前稳定。风险不在 stub 本身，而在"实现时顺手扩展接口"。每个 P0 PR 必须只做一件事: 不要在 P0-4 里顺手加 P0-2 的 audit 写入，不要在 P0-0 里顺手重构 reflect。范围蔓延是 4 周变 6 周的唯一原因。
