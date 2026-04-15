# Debate 004 — Synthesis: Week 1 Implementation Audit

> 🐙 Opus 主持终裁 · 2026-04-14
> Participants: 🔴 Codex / 🟡 Gemini / 🟠 Sonnet / 🐙 Opus
> Rounds: R1 (4/4), R2 skipped (focused audit, convergence already strong)

---

## 🟡 最终裁决: **Conditional Go for Week 2**

四方一致 Conditional Go. Week 1 三个 P0 的核心实现没有 design-level 错误, 但有 **5 个必修缺陷** + **1 个正面副作用发现**. 修完 5 项 (~3 小时) 才进 Week 2 P0-3 / P0-5.

---

## 🟢 正面发现 (Opus R1 §Issue 2)

**P0-4 副作用修了 search.ts 潜在 ranking bug**. Pre-P0-4 时, `search.ts:117 + :253` 只过滤 `archived_at IS NULL`, 不过滤 `superseded_by IS NULL`. 即 Phase 3 的 contradicted loser 仍在 ranking 结果里. P0-4 把 loser 立即 archived → search.ts 自动正确排除. 这是 fix, 不是 break.

**Action**: 在 ARCHITECTURE.md "frozen enum" 段加一句 invariant: "search.ts 的 archived_at filter 同时覆盖 stale/contradicted/duplicate 三种 archive 原因, 不能单独走 superseded_by". 防止未来 refactor 破坏.

---

## 必修 (Pre-Week-2, ≤ 3 小时)

### Fix 1 (HIGH): 多冲突仲裁不确定性 — `reflect.ts:166-180`
- **发现者**: Sonnet P1 + Codex Issue 2 (独立 2 voices)
- **问题**:
  - (a) `cg-${Date.now()}` 在单次 reflect 调用所有 conflict pair **共用**同一个 conflict_group → 5 个不相关的仲裁全归一个组, 审计断链
  - (b) 同一 loser 可能出现在多个 (subject, predicate) pair (3+ objects) → `replaced_by_fact_id` 被多次 UPDATE, 最终值非确定
- **修复**:
  ```ts
  // reflect.ts:166 改为按 (subject, predicate) 分组, 每组一个 cg-id
  // 同时在执行前 dedupe loser, 每个 loser 只指向 max-confidence winner
  const losersByPair = new Map<string, { winner: string; cg: string }>();
  for (const c of conflicts) {
    const key = `${c.subject}::${c.predicate}`;
    let entry = losersByPair.get(key) ?? {
      winner: c.winner_id,
      cg: `cg-${Date.now()}-${key.slice(0,20)}`
    };
    // 已有 entry 时跳过 (winner 已是该 pair 的最强)
    losersByPair.set(c.loser_id, entry);
  }
  // 然后批量 UPDATE
  ```
- **测试**: `reflect-archive-reason.test.ts` 加 "三方冲突 (a/b/c 同 subject+predicate, c 是 winner)" → 验证 a 和 b 都指向 c, conflict_group 不同于其他无关 pair

### Fix 2 (HIGH): backup 同日覆盖丢最后快照 — `backup.ts:53-60`
- **发现者**: Codex Issue 1
- **问题**: 当天已有 backup → unlink → VACUUM. VACUUM 失败 (磁盘满 / SQLite 错误) → 当天的 backup 永久丢失.
- **修复**:
  ```ts
  // backup.ts:49 改为 tmp + rename
  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  if (existsSync(tmpPath)) unlinkSync(tmpPath);
  db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  // 验证完整性后 rename (原子)
  renameSync(tmpPath, targetPath);
  ```
- **测试**: backup.test.ts 加 "VACUUM fails -> previous day backup intact" (mock VACUUM 抛错, 验证旧 file 字节不变)

### Fix 3 (HIGH): restore 缺 integrity_check + WAL/SHM 残留 — `backup.ts:121-132`
- **发现者**: Opus Issue 1 + Issue 5 + Sonnet P5
- **问题**:
  - copyFileSync 不验证 SQLite 完整性 → 半损坏 backup 被静默恢复
  - 不清理 `target-wal` / `target-shm` → 旧 WAL 与新 db 不一致, 下次启动 SQLite replay 旧 WAL 产生 corruption
- **修复**:
  ```ts
  export function restore(backupPath: string, targetPath: string): void {
    // ...existing checks...
    // (a) backup pre-restore safety net (rename, not delete)
    if (existsSync(targetPath)) {
      renameSync(targetPath, `${targetPath}.pre-restore.${Date.now()}`);
    }
    copyFileSync(backupPath, targetPath);
    // (b) cleanup WAL/SHM sidecars from old ledger
    for (const sidecar of [`${targetPath}-wal`, `${targetPath}-shm`]) {
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
    // (c) verify integrity
    const verify = new Database(targetPath, { readonly: true });
    try {
      const r = verify.query("PRAGMA integrity_check").get() as { integrity_check: string };
      if (r.integrity_check !== "ok") {
        throw new Error(`restored ledger integrity_check failed: ${r.integrity_check}`);
      }
    } finally { verify.close(); }
  }
  ```
- **测试**: 加两个 case — "restore corrupt file throws" (truncate backup mid-file) + "restore cleans WAL sidecar" (create dummy -wal before restore, verify it's gone)

### Fix 4 (MEDIUM): stale PID 阻断 restore — `commands/backup.ts:88-95`
- **发现者**: Opus Issue 4 + Codex Issue 4
- **修复**:
  ```ts
  if (existsSync(pidFile())) {
    const pid = Number(readFileSync(pidFile(), "utf-8").trim());
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* ESRCH */ }
    if (alive) {
      process.stderr.write(`error: daemon running (pid ${pid}). Stop it first.\n`);
      process.exit(2);
    }
    unlinkSync(pidFile());  // stale
  }
  ```

### Fix 5 (MEDIUM): backup scheduler 03:01 启动漏当天 — `scheduler.ts:429-437`
- **发现者**: Codex Issue 5 + Gemini Issue 5
- **问题**: 03:00:01 重启 → `msUntilNextWindow` 算到次日 03:00, 当天没 backup
- **修复**:
  ```ts
  function msUntilNextWindow(): number {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(BACKUP_TIME_WINDOW_HOUR_UTC, 0, 0, 0);
    // Fire immediately if we're within the 03:00-04:00 grace window AND no backup today
    const dateStr = now.toISOString().slice(0, 10);
    const todayPath = join(opts.backupDir, `${dateStr}.db`);
    if (now.getTime() - target.getTime() < 60 * 60 * 1000 && !existsSync(todayPath)) {
      return 0;
    }
    if (target.getTime() <= now.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.getTime() - now.getTime();
  }
  ```

---

## 接受推迟 (不阻断 Week 2)

| 项 | 来源 | 推迟到 |
|---|---|---|
| chmod 0600 backup files | Opus Issue 3 | P1 PII redact 同期一起 |
| Wiki 重建漏 Sensory GC topics | Gemini Issue 2 | Phase 3 遗留, 单独 issue 跟踪 |
| Multi-source contradiction tiebreak (debate 9 约定但未实现) | Gemini Issue 3 | 同上, Phase 3 遗留 |
| `decision_audit` 写入未实现 (audit.ts:42 stub) | Codex Issue 3 | Week 3 P0-2 (按计划) |
| `traverse` path-string perf benchmark | Opus + Codex + Gemini | Week 4 P1 benchmark fixture |
| `connectedComponents` 100K+ memory | Opus + Gemini | Week 4 P1 benchmark fixture |

**注**: Codex Issue 3 (decision_audit stub) 准确指出 ARCHITECTURE.md 写了 "always on" 但代码未实现. 不构成 blocker 因为 P0-2 排在 Week 3, 但 Week 3 实施时必须**回头补 reflect.ts 的 audit 写入** (在 step 2 + step 3 各加一行 `recordDecision()`).

---

## 测试覆盖必修 (随 5 项 fix 一起 land)

1. **三方冲突 winner 稳定性** (reflect-archive-reason.test.ts) — Codex + Sonnet
2. **VACUUM 失败不丢前日 backup** (backup.test.ts) — Codex
3. **stale PID 不阻塞 restore** (新建 backup-command.test.ts) — Codex
4. **restore corrupt file throws + WAL sidecar 清理** (backup.test.ts) — Opus
5. **fact_links 数据在 backup/restore round-trip 后保留** (backup.test.ts) — Opus 盲点 B

---

## 集体共识矩阵

| 议题 | Opus | Sonnet | Codex | Gemini |
|---|---|---|---|---|
| restore 缺 integrity_check | 1st | P5 | (隐含) | 条件 1 |
| 多冲突 cg/loser 非确定 | (未抓) | **P1** | **Issue 2** | (未抓) |
| same-day backup overwrite | (未抓) | (未抓) | **Issue 1** | (未抓) |
| stale PID check | Issue 4 | (未抓) | Issue 4 | (未抓) |
| backup scheduler missed window | (未抓) | P3 | Issue 5 | Issue 5 |
| WAL/SHM sidecar 清理 | Issue 5 | (未抓) | (未抓) | (未抓) |
| chmod 0600 | Issue 3 | (未抓) | (未抓) | (未抓, 但 long-term 提) |
| audit.ts stub vs ARCHITECTURE | (未抓) | P2 (语义不对) | **Issue 3** | (未抓) |
| Wiki 漏 Sensory GC | (未抓) | (未抓) | (未抓) | Issue 2 |
| traverse perf | (concern only) | P4 | concern | Issue 4 |
| connectedComponents memory | concern | (未抓) | (未抓) | concern |
| **search.ts archived_at 副作用 fix** | **正面发现** | (未抓) | (未抓) | (未抓) |

---

## 元教训 (本次审计学到)

1. **跨视角覆盖率不足** — Opus 没抓到 Sonnet/Codex 都看到的 "shared cg" bug. 单视角再深入也有盲区, 4-way 必要.
2. **Codex 是最严苛的 schema 审计** — Issue 3 (audit.ts stub vs ARCHITECTURE 承诺) 这种"代码 vs 文档" 失约只有 Codex 抓住. 未来文档锁定后, 必须每周跑一次"代码 vs 合同" 一致性检查.
3. **Phase 3 遗留 bug 在 Phase 4 才暴露** — search.ts 的 archived_at-only filter 是 Phase 3 写的, 但只有 P0-4 改 contradiction 行为后才显出影响. 教训: **每个 P0 实施完, 必须 grep cross-module 看下游 query path 假设**.
4. **测试只验证单 P0 内部, 不验证跨 P0 集成** — Sonnet + Opus 都点出. backup → restore → reflect 这种端到端链路 0 测试覆盖.

---

## 实施计划 (Pre-Week-2)

```
Day 0.5 (3 小时):
  Hour 1: Fix 1 (multi-conflict reflect.ts 改写) + 测试
  Hour 2: Fix 2 (backup tmp+rename) + Fix 3 (restore integrity + WAL cleanup) + 测试
  Hour 3: Fix 4 (PID kill check) + Fix 5 (scheduler window grace) + 测试

→ commit "fix(phase4-d): 5 audit fixes from debate 004"
→ run full test suite: 198 → ~210+ pass
→ Week 2 Go: P0-3 + P0-5
```
