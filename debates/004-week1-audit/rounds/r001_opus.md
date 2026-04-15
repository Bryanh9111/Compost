# R1 — 🐙 Opus (Architecture Audit)

读了: backup.ts (157), backup CLI (113), startBackupScheduler (line 395-475),
fact-links.ts (~290), reflect.ts (line 113-188), 加上 search.ts/wiki.ts 的 cross-impact.

---

## 1. Top 5 问题 (按严重度降序)

### Issue 1 (HIGH): restore 不验证 backup 完整性
- **问题**: `restore()` 用 `copyFileSync` 直接覆盖 (backup.ts:131), 不做 `PRAGMA integrity_check`. 如果 backup 文件半写 / 部分损坏 / 被 Time Machine 中途快照破坏, 静默恢复出坏 ledger.
- **触发场景**: 用户 `compost restore latest`. backup 文件因 SSD 坏块 / 网盘同步中断 / unzip 错误而损坏.
- **影响**: 第二大脑被静默替换为损坏 db, 用户开 daemon 后才发现"reflect 报错"或"查询全空", 此时原 ledger 已被 copyFileSync 覆盖, **不可恢复**.
- **修复**: backup.ts:131 后加:
  ```ts
  const verify = new Database(targetPath, { readonly: true });
  try {
    const r = verify.query("PRAGMA integrity_check").get() as { integrity_check: string };
    if (r.integrity_check !== "ok") {
      throw new Error(`restored ledger fails integrity_check: ${r.integrity_check}`);
    }
  } finally { verify.close(); }
  ```
  外加: 在 copy 前先 backup 当前 ledger 到 `~/.compost/backups/pre-restore-<timestamp>.db.tmp` (允许回退).

### Issue 2 (HIGH, 正面发现): P0-4 副作用修了 search.ts 潜在 bug
- **问题**: search.ts:117 + :253 只过滤 `archived_at IS NULL`, **不过滤** `superseded_by IS NULL`. Phase 3 的 contradiction loser 设了 `superseded_by` 但没 archive → loser 仍在 ranking 结果中. 这是 Phase 3 隐藏 bug.
- **触发场景 (修复前)**: 用户问 "earth shape", winner ('round') 和 loser ('flat') 都返回, ranking 按 confidence 排序, loser 仍出现在结果尾部.
- **影响**: P0-4 写 `archived_at = now` 给 loser 后, search.ts 自动正确排除. **副作用是 fix, 不是 break**. 这是好消息但应在 commit message 显式标注.
- **修复**: 不需要修 — 但应在 ARCHITECTURE.md 加一句 "search.ts 的 archived_at filter 同时覆盖 contradicted/stale/duplicate 三种 archive 原因". 防止未来有人去掉这个 invariant.

### Issue 3 (MEDIUM): backup 文件权限未锁定
- **问题**: backup.ts:60 `db.exec(VACUUM INTO ...)` 创建文件用默认 umask (通常 022 = 0644). mkdir 用了 0o700 (line 44), 但**文件本身**没 chmod 0600. 全部用户知识可读.
- **触发场景**: 多用户 macOS / Linux. 默认 umask 022. 任何同机用户能 `cat ~/.compost/backups/2026-04-15.db | strings`.
- **影响**: 个人大脑全部内容泄漏到本地其他用户. PII redact (P1) 还没做, 信用卡号 / API key 直接可读.
- **修复**: backup.ts:62 后加:
  ```ts
  import { chmodSync } from "fs";
  chmodSync(targetPath, 0o600);
  ```
  同时给 ledger.db 本身在 cli/commands/reflect.ts:13 的 `new Database(...)` 之后也 chmod 0600 (单独 PR, 不算本次).

### Issue 4 (MEDIUM): restore PID-file check 不验证进程活性
- **问题**: backup.ts CLI:89 用 `existsSync(pidFile())` 判断 daemon 是否运行. **stale PID** (daemon crash / kill -9) 留下文件 → restore 永久被阻断.
- **触发场景**: 用户 daemon 崩溃, PID file 残留. 用户想 restore, 工具拒绝, 用户只能手动 rm pid file (危险, 可能误删活进程).
- **影响**: 易用性 + 错误诱导. 用户学会手动 rm pid 后, 真正运行的 daemon 也会被误杀.
- **修复**: backup.ts:89 改为:
  ```ts
  if (existsSync(pidFile())) {
    const pid = Number(readFileSync(pidFile(), "utf-8").trim());
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* ESRCH */ }
    if (alive) {
      process.stderr.write(`error: daemon running (pid ${pid}). Stop it first.\n`);
      process.exit(2);
    }
    // stale: clean up and proceed
    unlinkSync(pidFile());
  }
  ```

### Issue 5 (MEDIUM): restore 不清理 WAL/SHM sidecar
- **问题**: backup.ts:131 只 copy `ledger.db`, 不动 `ledger.db-wal` / `ledger.db-shm`. WAL 模式下, 这两个 sidecar 持有"已写但未 checkpoint"的事务. Restore 后, 旧 WAL + 新 db 文件 = 不一致状态, 下次 daemon 启动 SQLite 会尝试 replay 旧 WAL 到新 db → 数据腐败.
- **触发场景**: 任何 restore 操作 (因为 WAL 模式是 PRAGMA journal_mode=WAL, 默认开).
- **影响**: 数据 corruption. 比 issue 1 更隐蔽 (integrity_check 不一定立即报)
- **修复**: backup.ts:131 改为:
  ```ts
  copyFileSync(backupPath, targetPath);
  for (const sidecar of [`${targetPath}-wal`, `${targetPath}-shm`]) {
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
  ```

---

## 2. 测试覆盖盲点

### 盲点 A: 没有 backup → restore → reflect 端到端测试
- **缺什么**: backup.test.ts 验证 round-trip 数据 (line 137-160), 但**不跑 reflect 在 restored db 上**. 如果 restore 后 schema 损坏 / index 缺失, reflect 会爆但测试不抓.
- **应在**: `test/backup-e2e.test.ts` 新建. Seed 100 facts + links + observations → backup → modify db (delete some) → restore → run `reflect()` → verify report.errors 为空.

### 盲点 B: 没有 fact_links 跨 backup 恢复测试
- **缺什么**: backup.test.ts:69-89 验证 `health_signals` table 在 snapshot 中存在, 但**不验证 `fact_links` 数据保留**. P0-0 是新表, snapshot 应包含完整 fact_links 行.
- **应在**: backup.test.ts 加: seed 5 facts + 3 links → backup → 在 snapshot 中查 `SELECT COUNT(*) FROM fact_links` = 3.

### 盲点 C: 没有 backup 文件权限测试
- **缺什么**: 没人验证 0600 (issue 3 一旦修)
- **应在**: backup.test.ts 加: `expect(statSync(result.path).mode & 0o777).toBe(0o600)`

---

## 3. 性能担忧

### 担忧: connectedComponents 在 100K facts 时内存爆
- **场景**: fact-links.ts:265-285 (`connectedComponents`) 把所有 facts + links 装进 TS Map. 100K facts × ~50 bytes overhead + 500K links × 100 bytes ≈ 55MB heap. 200K facts → 110MB.
- **数据规模估算**: 用户 dogfood 6 个月可能到 50K facts (Phase 3 estimate). 不立即爆但增长不可控.
- **建议 benchmark**: P0-3 实施时加 `bench/connected-components.bench.ts`, 测 1K / 10K / 100K facts. 如果 100K > 1s 或 > 200MB, 改用 SQL UNION-FIND extension 或 incremental component tracking (link insert 时维护).

---

## 4. Week 2 准备就绪?

**Conditional Go**.

进 P0-3 / P0-5 之前必须先做 **3 个 backup 安全 fix** (issues 1, 4, 5):
1. restore 后跑 `PRAGMA integrity_check`
2. PID-file check 加 `process.kill(pid, 0)` 活性验证
3. restore 清理 WAL/SHM sidecar

总成本 ~1 小时. Issues 2 (search.ts side-effect) 是文档更新, 5 分钟. Issue 3 (chmod 0600) 是 P1 PII redact 同期做的安全加固, 可推迟但建议先做.

**不阻断 P0-3/P0-5**: fact-links 和 reflect 的实施层面没硬伤 (issues 6-9 在我审查里都是 LOW), 主要风险都集中在 backup/restore 的恢复路径 — 这些路径在 P0-3/P0-5 实施期间不会被触发, 但**任何 production dogfood 之前必修**.

---

## 5. 一句话告诫

第二大脑的 backup 路径出错 = 静默删除全部知识 — Phase 4 任何代码都不许在没有 integrity_check 的情况下覆盖 ledger.db.
