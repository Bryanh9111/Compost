## Codex R1

1. Week 4 排序
- Day1：锁 P0-1：`triage list --kind --limit`、surface-only、`stale_wiki<-wiki_pages.stale_at`、`correction_candidate` 不改 `facts.confidence`。随后先并 `daemon/main.ts:82` 与 `daemon/mcp-server.ts:53,210-214`。并行：删 `core/schema/0010_phase4_myco_integration.sql:82` 注释、整 `daemon/scheduler.ts:1-15,449-455` import。
- Day2：补 `daemon/scheduler.ts:81-123` 集成测；修 `core/query/ask.ts:128-137,175-176` 0-hit wiki fallback。
- Day3：实装 `core/cognitive/triage.ts:55-72,77-86`；并行补 `core/cognitive/correction-detector.ts:65`。
- Day4：接 `compost triage list` CLI；补 `cli/commands/audit.ts:38-58` 参数/exit-code 测试；若未滑坡，再做 `cli/commands/doctor.ts:27-40` 的 `--check-llm`。
- Day5：全量回归。`core/llm/circuit-breaker.ts:109-123` 若无可复现 starvation，本周不改。

2. 排除项
- 不做 4 个 P1；不解本周依赖链。
- 不做 `core/query/ask.ts:77-90`、`core/cognitive/wiki.ts:216-224` 的 union 重构；`docs/ROADMAP.md:135` 触发未到。
- 不做 `docs/ROADMAP.md:138` 的 float-band 改写。

3. 风险预警
- kind 漂移：`core/cognitive/triage.ts:12-18` vs `core/schema/0010_phase4_myco_integration.sql:16-22`；Day1 不锁，Day3 必返工 SQL/TS/CLI。
- registry 分叉：`docs/ROADMAP.md:134`；Day2 前不合并，scheduler 测的是假拓扑。
- 半开语义若被顺手优化，可能打破 `core/test/circuit-breaker.test.ts:179-224`。

4. Done-definition
- 必达：单 registry、scheduler wiki 测、`triage.ts` 两个 stub 清零、`compost triage list`、`correctedText` extraction。
- 覆盖：`core/test/triage.test.ts`、`daemon/test` scheduler case、`cli/test/cli.test.ts`、`core/test/correction-detector.test.ts`。
- Gate：不留 `triage.ts:56,82` / `correction-detector.ts:65` stub；invalid CLI exit 2；wiki failure 不停 cadence；全绿。

5. 一句话总评
先清 wiring debt，再交只读 triage 最小闭环；状态机和类型层重构全部后移。

DONE_R1_011
