# Debate 005 — Synthesis: Cumulative Diff Review

> 🐙 Opus 主持终裁 · 2026-04-15
> Participants: 🔴 Codex / 🟡 Gemini / 🟠 Sonnet / 🐙 Opus
> Rounds: R1 only (focused, strong convergence makes R2 unnecessary)

---

## 🟡 最终裁决: **Conditional Go for Week 2**

**4/4 一致主题**: *Schema 先行, runtime 落后* (Codex 原话). 7 commits 把 schema + 文档合约 + TS API 全部就位, 但**没有把它们连成循环**. 结果:
- `fact_links` 表永空 (没人调 addLink)
- `decision_audit` 表永空 (ARCHITECTURE 说 always-on 但没调用点)
- `triage` 返回空 (没人调, P0-1 未实施)
- Python LLM 失败 → 用户看不到信号

但**没有 runtime crash**: 因为没人 import stubs, throw 不会发生. 这意味着生产不会爆, 但合约欺骗用户.

---

## 🔴 Must-Fix Before Week 2 (4/4 共识, ≤ 2 小时)

### Fix 1 (HIGH): reflect.ts 写 `fact_links` contradicts 边
- **发现者**: Opus Issue 1 / Sonnet P4 / Gemini P2 / Codex #1 — **4/4 独立抓到**
- **位置**: `reflect.ts:220-245` contradiction resolve 事务内
- **修复**:
  ```ts
  import { addLink } from "./fact-links";
  // 在 resolveTx 内, supStmt.run 后:
  for (const loserId of cluster.losers.keys()) {
    supStmt.run(cluster.winner, cluster.groupId, cluster.winner, loserId);
    addLink(db, loserId, cluster.winner, "contradicts", { weight: 1.0 });
  }
  ```
- **测试**: reflect-archive-reason.test.ts 加 "3-way conflict creates contradicts edges" — 验证 2 个 loser × 1 winner 产生 2 条 edge

### Fix 2 (HIGH): TS `SignalKind` 与 SQL CHECK 同步 (correction_candidate)
- **发现者**: Sonnet P1 + Codex #5 — Opus 漏掉
- **位置**: `triage.ts:7-12` SignalKind union + :53-61 byKind initial shape
- **修复**:
  ```ts
  export type SignalKind =
    | "stale_fact"
    | "unresolved_contradiction"
    | "stuck_outbox"
    | "orphan_delta"
    | "stale_wiki"
    | "correction_candidate"; // added by 0012
  ```
  + triage.ts:53-60 byKind 加 `correction_candidate: 0`
  + triage.test.ts:48-60 期望改为 6 kinds (已有一个 test 写入 correction_candidate 验证 CHECK, 但 byKind shape 测试只期望 5)

### Fix 3 (HIGH): ARCHITECTURE.md 合约诚实化 (decision_audit 状态)
- **发现者**: Opus Issue 2 / Sonnet P2 / Gemini P3 / Codex #2 — **4/4 独立抓到**
- **位置**: `docs/ARCHITECTURE.md` "Audit log responsibilities" 段
- **修复选择**: 不立即实现 audit wiring (那是 Week 3 P0-2), 改为**文档诚实化**:
  ```
  decision_audit:
    Status: schema only. P0-2 (Week 3) wires `recordDecision()` calls
    into reflect.ts step 2/3 and wiki.ts rebuild. Until then, the table
    exists but is empty. Do NOT rely on audit-trail queries before Week 3.
  ```
  + `archive_reason` enum 表加 "Implementation status" 列 (Opus Issue 5 + Gemini drift):
  ```
  stale       | ✅ reflect.ts step 2
  contradicted| ✅ reflect.ts step 3
  superseded  | ⏳ reserved
  duplicate   | ⏳ P1 compression
  low_access  | ⏳ P1 compression
  manual      | ⏳ future CLI
  ```

### Fix 4 (MEDIUM): graph-health.ts TS interface 与 0011 rebuild 同步
- **发现者**: Sonnet P3 unique (Opus + Gemini + Codex 都没看到这个具体 drift)
- **位置**: `graph-health.ts:8-10`
- **问题**: `orphanFacts / density / clusterCount: number | null` 但 0011 rebuild 表为 `NOT NULL DEFAULT 0`. TS 接口在骗调用者说值可能是 null.
- **修复**:
  ```ts
  export interface GraphHealthSnapshot {
    takenAt: string;
    totalFacts: number;
    orphanFacts: number;      // was number|null, now non-null per 0011
    density: number;           // was number|null
    clusterCount: number;      // was number|null
    staleClusterCount: number;
  }
  ```
  + `currentSnapshot` 返回 0 不返回 null (反正查 v_graph_health 会拿到 0)
  + `takeSnapshot` 实现时照用即可

### Fix 5 (MEDIUM): Self-Consumption guard 文档 vs 代码
- **发现者**: Gemini drift #1 unique
- **位置**: `docs/ARCHITECTURE.md` "Self-Consumption guard" 段 vs `pipeline/web-ingest.ts` + `scheduler.ts` ingestUrl
- **问题**: ARCHITECTURE 写 "extractor MUST refuse to re-ingest wiki/** paths". 实际 ingestUrl 没做检查.
- **修复选择**: 不立即实现 (P0-6 Week 3 做 LLM circuit breaker 时一起), 改为**文档改软**:
  ```
  Self-Consumption guard: P0-6 sub-requirement (Week 3). Currently not
  enforced — users who manually `compost add wiki/<page>.md` will see
  the content re-ingested. Week 3 P0-6 adds the guard in ingestUrl/addFile.
  ```

---

## 🟢 允许推迟 (Week 2 启动后或更晚)

| 项 | 来源 | 推迟到 |
|---|---|---|
| Triage/correction loop 接入 scheduler | Gemini P0 | Week 4 P0-1 (按计划) |
| Python LLM 失败 → triage stuck_outbox 信号 | Opus Issue 5 / Gemini P4 / Codex #4 | Week 4 P0-1 (triage 实施时覆盖) |
| `stale_cluster_count` 计算源 | Sonnet P5 | Week 2 P0-3 实施时顺便 |
| Migration 0010→0011→0012 history 美化 | Opus Issue 4 | 接受, 不动 |
| backup.test.ts 的 `require('fs')` 清理 | Opus Refactor 2 | backlog |
| P0-3 `currentSnapshot` 实现 | Sonnet + Codex + Gemini | Week 2 P0-3 (本就计划) |
| backup-restore.test.ts 去重 | Codex refactor 2 | Week 2 cleanup |
| Provider 化 `Bun.spawn` extractor | Gemini refactor | Week 3 P0-6 时 |

---

## 📊 4-Voice Convergence Matrix

| 问题 | Opus | Sonnet | Codex | Gemini | 状态 |
|---|---|---|---|---|---|
| fact_links contradicts edges 不写 | ✅ Issue 1 | ✅ P4 | ✅ #1 | ✅ P2 | **4/4 Must Fix** |
| decision_audit "always on" 不 wired | ✅ Issue 2 | ✅ P2 | ✅ #2 | ✅ P3 | **4/4 Must Fix** |
| correction_candidate TS/SQL drift | ❌ 漏 | ✅ P1 | ✅ #5 | ❌ 漏 | **2/4 Must Fix (Opus 承认漏)** |
| graph-health TS null vs SQL NOT NULL | ❌ 漏 | ✅ P3 | ❌ 漏 | ❌ 漏 | **1/4 Must Fix (Sonnet unique catch)** |
| P0-3 只有 schema 没 runtime | (部分) | ✅ | ✅ #3 | ✅ P0 | P0-3 Week 2 本就做 |
| Python LLM 失败不可见 | ✅ | (隐含) | ✅ #4 | ✅ P4 | 推迟 Week 4 |
| Self-Consumption 未实现 | ❌ 漏 | ❌ 漏 | ❌ 漏 | ✅ drift | **1/4 Must Fix (Gemini unique)** |
| archive_reason 6 值只实现 2 | ✅ Drift 1 | ❌ 漏 | ✅ #drift | ✅ P5 | **3/4 Must Fix (文档诚实化)** |

---

## 元教训 (per-commit vs cumulative)

1. **单 commit 视角漏 4 人一致的主题**: debate 004 per-commit review 没抓到 fact_links-never-written 和 decision_audit-never-wired — 因为这些是**跨 commit 的合约-现实漂移**, 每个 commit 单看都"完成了它该做的".

2. **累积审计应每 3-5 commits 跑一次**, 不等 PR 合并前: 3 个主题漂移累积成"骨架齐全但循环未闭合", 如果不主动审, Week 2 启动后会连环踩.

3. **Sonnet 抓 TS/SQL 类型同步最强**: P1 (SignalKind 缺 correction_candidate) + P3 (graph-health null vs NOT NULL) 是 4 个 voices 里唯一发现的 — 说明未来累积审应特别让 Sonnet agent 跑"跨 migration vs TS interface 一致性"扫描.

4. **没有 runtime crash ≠ 没有问题**: 死代码 + 合约欺骗是更隐蔽的技术债. 需要 *active linking check*: grep src 看每个新 API 有没有真实 caller.

---

## 实施计划

```
Day 0.25 (~1 小时):
  Fix 1: reflect.ts 调 addLink('contradicts') + 测试 (20 min)
  Fix 2: triage.ts SignalKind + byKind + 测试更新 (15 min)
  Fix 3: ARCHITECTURE.md 合约诚实化 (15 min)
  Fix 4: graph-health.ts interface 同步 (10 min)
  Fix 5: ARCHITECTURE.md Self-Consumption 软化 (5 min)

Verify: bun test (期望 217 → 219+ pass)
Commit: "fix(phase4-d): wire fact_links + doc honesty (debate 005)"

→ Week 2 Go
```
