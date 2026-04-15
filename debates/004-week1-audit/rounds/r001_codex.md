### 1. Top 5 问题
1. **问题**: `core/src/persistence/backup.ts:51-60` 先删旧快照再 `VACUUM INTO`，失败即丢最后恢复点。 **触发场景**: 同日重跑遇到磁盘满/SQLite 错误。 **影响**: 数据。 **修复**: `backup.ts:49-60` 写 `*.tmp`，成功后 `renameSync`。
2. **问题**: `core/src/cognitive/reflect.ts:141-191` 多方冲突按 pair 结算，未按 `loser_id` 去重，winner 非确定。 **触发场景**: 同一 `(subject,predicate)` 有 3+ object。 **影响**: 数据。 **修复**: `reflect.ts:141-160` 先选每个 loser 的唯一最强 winner。
3. **问题**: `core/src/cognitive/audit.ts:42-60` 仍是 stub，且 `reflect.ts:115-195`、`wiki.ts:163-166` 未写 `decision_audit`，违背 `ARCHITECTURE.md:159-179`。 **触发场景**: tombstone/contradiction/wiki rebuild。 **影响**: 审计。 **修复**: 实现 `recordDecision` 并在三处成功路径落库。
4. **问题**: `cli/src/commands/backup.ts:88-95` restore 只看 pid 文件，不验活。 **触发场景**: daemon 崩溃遗留 stale pid。 **影响**: 可用性。 **修复**: 读 pid 后 `process.kill(pid,0)`；失活则删 pid。
5. **问题**: `daemon/src/scheduler.ts:433-450` 只等“下一个”03:00 UTC，03:00:01 启动会漏当天备份。 **触发场景**: 03 点窗口内重启。 **影响**: 数据。 **修复**: `scheduler.ts:433-466` 当前在 03 点窗口则立即跑一次，并记 `lastRunDate`。

### 2. 测试覆盖盲点
- `core/test/backup.test.ts`: 补“覆盖失败不丢旧备份”，断言抛错后旧 `YYYY-MM-DD.db` 仍在且字节不变。
- `core/test/reflect-archive-reason.test.ts`: 补“三方冲突唯一 winner + `decision_audit` 落库”，断言 loser 恒指向最强 winner。
- 新增 `cli/test/backup-command.test.ts`: 补“stale pid 不阻塞 restore”，断言假 pid 下 restore 成功。

### 3. 性能担忧
- `core/src/cognitive/fact-links.ts:196-246` 的 `traverse()` 用 path-string+`INSTR` 去环；在 10 万 facts/30 万 links/`maxDepth=4` 会放大 CTE 和字符串分配。建议在 `core/bench/fact-links.bench.ts` 加 benchmark。

### 4. Week 2
**Conditional Go**
- 修 same-day backup 覆盖丢快照。
- 修 contradiction arbitration 非确定性。
- 补 `decision_audit` 实现与测试。

### 5. 一句话告诫
`archived_at` 已是系统级开关；非确定性归档和缺失审计会在 Week 2 直接变成数据债。
