# R1 Sonnet 4.6 — Week 1 Audit (P0-7 / P0-0 / P0-4)

审计范围: commits `0b1dc7b` `1370ba6` `a4efbe2`  
日期: 2026-04-14

---

## 1. Top 5 问题 (严重度降序)

### P1 — 单一 `conflict_group` 覆盖所有批次冲突

**文件**: `packages/compost-core/src/cognitive/reflect.ts:169`

`groupId = \`cg-${Date.now()}\`` 在一次 reflect 调用中为所有 conflict pairs 分配同一个 `conflict_group`。若单次 reflect 发现 30 对冲突，它们全被归入同一 group，混淆后续审计路径，也违反 ARCHITECTURE.md 中 "per high-cost decision one row" 的 `decision_audit` 意图。

**触发**: 任何包含 ≥2 对不同 (subject, predicate) 冲突的 reflect 调用。  
**影响**: `decision_audit` 无法区分不同主题的仲裁事件；P0-3 graph_health 读 conflict_group 会误判聚簇规模。  
**修复** (`reflect.ts:169`):
```diff
- const groupId = `cg-${Date.now()}`;
+ // 每对单独分组
  const resolveTx = db.transaction(() => {
    for (const c of conflicts) {
+     const groupId = `cg-${Date.now()}-${c.winner_id.slice(0,8)}`;
      supStmt.run(c.winner_id, groupId, c.winner_id, c.loser_id);
      winStmt.run(groupId, c.winner_id);
    }
  });
```

---

### P2 — ARCHITECTURE.md enum 与实现不对齐: `superseded` vs `contradicted`

**文件**: `packages/compost-core/src/cognitive/reflect.ts:182`  
**文件**: `docs/ARCHITECTURE.md:178`

ARCHITECTURE.md 明确列出两个值: `superseded`(被更新事实替换) 和 `contradicted`(仲裁失败)。当前 Step 3 直接写 `archive_reason = 'contradicted'`，但丢弃了 `superseded` 路径。"同 subject+predicate 的更新事实"语义上应为 `superseded`，而真正矛盾(对立命题)才是 `contradicted`。两者混用导致 `decision_audit.kind` 的 `contradiction_arbitration` 无法区分"版本迭代"和"真实冲突"。

**触发**: 任意 reflect Step 3。  
**影响**: 分析查询无法区分两类归档动因，Week 2 P0-3 graph_health 的信号质量下降。  
**修复** (`reflect.ts:182`): 在 SQL 查询中区分 "newer version of same fact" 和 "semantically opposed object"，前者写 `superseded`，后者写 `contradicted`。最小可行方案: 按 `created_at` 差距阈值(如 <1h 视为版本迭代)分流两路 UPDATE。

---

### P3 — backup 调度器复活逻辑缺失: 服务启动时若已过 03:00 UTC 窗口需等待 ~24h

**文件**: `packages/compost-daemon/src/scheduler.ts:437-440`

```ts
if (target.getTime() <= now.getTime()) {
  target.setUTCDate(target.getUTCDate() + 1);
}
```

`msUntilNextWindow()` 在 03:00 刚过后返回 ~24h 等待。若守护进程在 03:01 启动(或崩溃重启)，下次备份需等待 23h59m，与 "ARCHITECTURE.md 要求每天备份" 的保证产生最坏 ~24h gap。

**触发**: daemon 在 03:00-24:00 UTC 区间内首次启动，且当天尚无备份。  
**影响**: 数据丢失窗口从预期 <24h 扩大至最坏 ~48h。  
**修复** (`scheduler.ts:433` 之前):
```diff
+ // 若今日尚无备份，立即执行一次
+ function shouldRunImmediately(): boolean {
+   const today = new Date().toISOString().slice(0, 10);
+   return !existsSync(join(opts.backupDir, `${today}.db`));
+ }
  async function loop() {
    while (running) {
+     if (shouldRunImmediately()) { /* run backup now, skip wait */ }
      const wait = msUntilNextWindow();
```

---

### P4 — traverse 的路径串 cycle 检测在大图下有 O(depth²) 内存问题

**文件**: `packages/compost-core/src/cognitive/fact-links.ts:229-235`

cycle 检测使用 `visited.path || next_id || ','` 将已访问节点拼接为字符串，再用 `INSTR(path, ',' || next_id || ',')` 检查重复。路径字符串随深度线性增长，INSTR 本身 O(path_len)；在宽图(高出度)+ maxDepth=3 时，CTE 展开行数可达 O(fan_out^depth)，每行携带长路径。fact_id 通常为 UUID(36 字符)，maxDepth=3 + fan_out=20 = 路径列 ~108 字节/行 × 8000 行 = 可接受，但若 maxDepth 调高或 fact_id 更长则爆炸。

**触发**: `maxDepth > 5` 且图密度 > 10 links/node。  
**影响**: SQLite 内存溢出或查询超时，锁住写路径。  
**修复** (`fact-links.ts:189`): 硬限 `maxDepth <= 6`，或在函数入口 `throw` 防止滥用:
```diff
+ if (maxDepth > 6) {
+   throw new Error(`fact-links: maxDepth capped at 6 (got ${maxDepth})`);
+ }
```

---

### P5 — restore 无完整性验证: 恢复的文件可能是损坏的 SQLite

**文件**: `packages/compost-core/src/persistence/backup.ts:121-131`

`restore()` 只做 `copyFileSync`，不验证目标是可用的 SQLite 数据库。若备份文件在写入过程中被截断(磁盘满)，restore 成功返回但 ledger 已损坏，守护进程下次启动直接崩溃。

**触发**: 磁盘满场景下的 VACUUM INTO 中断 + 后续 restore。  
**影响**: 数据不可用，且无错误提示。  
**修复** (`backup.ts:130` 之后):
```diff
+ import { Database as BunDB } from "bun:sqlite";
  copyFileSync(backupPath, targetPath);
+ // 验证可打开
+ const check = new BunDB(targetPath, { readonly: true });
+ check.query("SELECT 1").get();
+ check.close();
```

---

## 2. 测试覆盖盲点

**盲点 A — scheduler 无测试**: `startBackupScheduler` (`scheduler.ts:426-481`) 无任何测试文件覆盖。时间窗口计算逻辑、错误重试睡眠量(`BACKUP_INTERVAL_MS`)均未验证。最小要求: 单元测试 `msUntilNextWindow()` 在已过/未过 03:00 时的返回值区间。

**盲点 B — restore 完整性验证未测试**: `backup.test.ts` 的 `restore round-trips data` 测试(line 143)使用的是来自正常 VACUUM INTO 的有效备份。没有测试"截断备份文件 restore 后 db 打开会发生什么"——即 P5 所述场景。需增加一个 corrupt-file 测试用例。

**盲点 C — 多冲突批次的 conflict_group 隔离未测试**: `reflect-archive-reason.test.ts` 只测试单对冲突(line 93)。从未验证两对不同 (subject, predicate) 冲突是否被正确分配到独立 group(即 P1 问题完全无测试覆盖)。

---

## 3. 性能担忧

`reflect.ts` Step 2 (`packages/compost-core/src/cognitive/reflect.ts:88-112`) 将 **全量活跃 facts** 拉入 TS 内存做衰减计算。SQLite 缺少 `POW()` 函数是已知约束，注释也说明了。但若 facts 表有 100k 行，每次 reflect 传输 100k 行 JSON 到 Bun 进程，加上序列化开销，6h 定期执行可能造成显著 latency spike，阻塞 WAL checkpoint。

**可行缓解**(无需 POW): 在 SQL 层用 `WHERE importance < ? AND last_reinforced_at_unix_sec < ?` 预过滤明显陈旧的候选(importance 极低 + 强化时间极久)，减少传输量。只有边界案例才进入 TS 精算。

---

## 4. Week 2 准备就绪

**Conditional Go**

条件:
1. 修复 P1 (conflict_group 独立分配) — 影响 Week 2 P0-3 graph_health 信号质量，不修复则 Week 2 的数据直接带错误
2. 补充 scheduler 基础单元测试 (盲点 A) — P0-7 的核心调度逻辑目前零覆盖
3. 明确 ARCHITECTURE.md `superseded` vs `contradicted` 的实现映射 (P2) — 即使本周不分流，也需要写明"有意合并"还是"待修复"

P3/P4/P5 可推到 Week 2 作为 hardening 条目，不阻塞主线功能。

---

## 5. 一句话告诫

Step 3 一个 `groupId = \`cg-${Date.now()}\`` 让所有本次冲突共享同一审计组 — 这是 Week 2 graph_health 信号的地基，地基歪了上面盖什么都没用，先把这行改掉。

---

DONE_R1_SONNET_004
