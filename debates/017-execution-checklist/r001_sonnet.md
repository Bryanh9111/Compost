# r001_sonnet — Debate 017 Round 1

**立场**: Sonnet (用户心智 / 迁移过程风险)
**Date**: 2026-04-16

---

### Q1 — SUPPORT

Step 0 不冗余：中断场景（Ctrl+C、kernel panic）下，如果没有预先 audit 的快照，用户无法区分"哪些行因 CHECK 失败被跳过"和"哪些行因进程崩溃未写入"，恢复等于盲猜。

---

### Q2 — REJECT

替代方案：不加永久 unpin API；改为迁移脚本内嵌一次性 SQL `UPDATE memories SET pinned=0 WHERE origin='compiled' AND pinned=1`，迁移完成后删除脚本。理由：永久 unpin API（尤其 MCP tool 形式）在自动化脚本里极易被批量滥用——脚本没有"这条 pinned 是用户手动设的还是系统默认"的判断力，一条 `for id in ids: unpin(id)` 就能静默清空用户全部 pin，且没有任何回滚路径。unpin 的危险性比 forget 更隐蔽（forget 至少还在 DB 里标 obsolete，unpin 丢失的是优先级元数据，用户根本不会注意到）。

---

### Q3 — MODIFY

替代方案：先写 invariant test，但用"预期 schema DSL"声明（`assert_column_exists('scope')`），而不是对真实 DB introspect。DDL 跑完后 test 才真正变绿。理由：Q3 的核心风险不是顺序，而是"invariant test 写完就扔"——如果 test 只在 CI 跑一次然后被注释掉，它对用户没有任何保护。MODIFY 要求在 CI pipeline 里把 invariant test 设为必须通过的 gate，而不只是开发者手跑的验证工具。

---

### Q4 — REJECT

250 LoC 严重低估，但问题不在行数——在于对用户透明度的漏算。真正缺的是：

1. **迁移回滚的用户可见 UI**：rollback SQL 写了，但用户怎么知道"什么情况下需要手动跑 rollback"？缺少一个 `engram migrate --status` 命令显示迁移状态（未开始/进行中/成功/失败/已回滚）。这本身就是 ~30 LoC + 1 test。
2. **recall_miss_log 的写入路径**：表建了，但没有写入逻辑，用户看不到任何 miss 数据，`engram stats --misses` 永远返回空。

替代方案：把 LoC 预算改为"用户可见功能清单"作为 done-criteria，而不是行数上限——行数是内部指标，用户 care 的是"我跑完之后能验证迁移成功吗"。

---

### Q5 — REJECT

替代方案：把 6 条前置条件简化为 2 条硬依赖：(a) Step 0 audit 完成且输出 report，(b) rollback SQL 经过 dry-run 验证可执行。理由：原 6 条是"实现产物自我引用"的循环依赖，用户无法判断自己当前处于哪个阶段。用户视角的前置条件应该是可以手动 check 的外部事实（audit 数字、rollback 可执行性），而不是"invariant test 脚手架是否存在"这种只有开发者才能判断的内部状态。

---

## Sonnet 独家风险

1. **中断后状态不透明（最高风险）**：DDL migration 在 INSERT SELECT 中途被 Ctrl+C，SQLite WAL 保证原子性，但用户看到的是 memories_v2 表为空、原表完整——没有任何提示说"迁移未完成"。下次用户直接跑 Engram，server 会不会静默读旧表还是报错，取决于 db.py 的 init_db() 逻辑是否检测两表共存。这个陷阱在清单里完全不可见。建议：init_db() 检测"memories 存在且 memories_v2 存在但行数为 0"时主动 raise 而非静默降级。

2. **unpin MCP tool 的自动化滥用**：如果 unpin 作为永久 MCP tool 存在，任何调用 Engram MCP 的 agent（包括未来的 Compost agent、CI 脚本）都可以无声地批量 unpin 用户手动标记的高优先级记忆。没有 `--dry-run`，没有"这条 pin 是 human 设的"的保护，没有 audit log。这比 forget 危险：forget 有 status=obsolete 可查，unpin 的损失在正常 recall 时才会被发现（高优先级记忆"消失"在结果排序里）。

3. **"哪些记忆丢了"对用户不可见**：迁移失败时（CHECK 违反导致行被跳过），用户只能通过 `SELECT COUNT(*)` 比对行数来发现问题，没有人类可读的差异报告。建议 Step 2 输出迁移摘要：`迁移成功 487 条，跳过 13 条（8 条超长，5 条 origin CHECK 违反），rollback 可用`——这不是 nice-to-have，是用户判断"能不能继续用"的必要信息。
