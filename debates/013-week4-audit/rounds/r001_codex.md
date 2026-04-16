# Codex R1

## 1. Top defects
1. `packages/compost-core/src/cognitive/triage.ts:47-53,323-331`：声明了 `orphanDeltaThreshold`，但 `triage()` 实际把 `scanOrphanDelta()` 的窗口绑到 `staleFactDays`，默认变成 90d。锁定语义是 orphan >30d；`compost triage scan` 会静默漏掉 30-89d orphan，且现有测试只测 scanner 直调，没兜住默认路径。
2. `packages/compost-cli/src/commands/triage.ts:103-117`, `packages/compost-core/src/cognitive/triage.ts:417-427`：`triage resolve` 无论 id 不存在、已 resolve，还是刚更新，都会打印成功。人工 triage 会拿到假确认。
3. `packages/compost-core/src/cognitive/triage.ts:218-225,226-249`：`orphan_delta` 代码是“逐 fact surface”，不是 migration/comment/contract 写的“vs baseline > 5”。同一 kind 出现语义漂移，下游读数不可直接信。
4. `packages/compost-daemon/src/scheduler.ts:108-113`：reflect cadence 是“daemon 启动后每 6h”，不是文档写的 `00/06/12/18 UTC` 对齐；重启时间会改变窗口，并削弱 backup/reflect 分窗假设。

## 2. Tech debt
- `packages/compost-core/src/cognitive/triage.ts:72-77`, `packages/compost-core/src/schema/0012_correction_signal_kind.sql:29-32`：upsert 查 `(kind,target_ref,resolved_at)`，但无对应 partial index。cost `S`；benefit 是 `health_signals` 过万行后仍可稳定去重；trigger：poison pill / chronic stale target。
- `packages/compost-core/src/cognitive/triage.ts:57-85,417-427`：resolved 后重发没有 reopen/TTL/compaction 策略。cost `M`；benefit 是限制历史表增长；trigger：长期修不掉的 stuck/outdated target。
- `packages/compost-core/src/query/ask.ts:144-152`：wiki fallback 没有 slugify，也无 `ORDER BY`。cost `S`；benefit 是 wiki-only query 结果稳定；trigger：多词问题、重复 title、嵌套 path。

## 3. Contract deviations
- `debates/011-week4-plan/contract.md:23-24` 说 CLI 从 `triage.ts` 读 enum；`packages/compost-cli/src/commands/triage.ts:25-34` 实际硬编码第二份列表，不是单一源。
- `debates/011-week4-plan/contract.md:61-62` 锁定 CLI 只暴露 `resolve --by user`；`packages/compost-cli/src/commands/triage.ts:98-116` 现在对外暴露 `agent`。
- `docs/ROADMAP.md:168` 仍写 “5 signal kinds”，与 `debates/011-week4-plan/contract.md:5-21` / `triage.ts:12-18` 的 6 kinds 不一致。

## 4. Merge-blocker vs nice-to-have
- Merge-blocker：修 `orphan_delta` 默认窗口/参数接线；让 `resolveSignal()` 返回是否命中，CLI 对 missing/already-resolved id 非 0 退出。
- Nice-to-have：导出 `SIGNAL_KINDS` 常量供 CLI/文档共用；要么做 UTC 对齐，要么下调文档表述；给 wiki fallback 补 slugify + `ORDER BY`。

## 5. 总评
Week 4 可以开 PR，但先补两个小修：`orphan_delta` 默认行为错误、`resolve` 假成功；其余主要是契约漂移和规模债。
