## 1. Top 5 问题
1. `reflect.ts:150-160,183-218`：无 `ORDER BY` 却按首行定 winner，3+项会错挂 loser。漏因：只审 shape。修：`+ ORDER BY f1.confidence DESC,...`；`+ 先选 canonical winner`。
2. `circuit-breaker.ts:109-117`：half-open 把首 probe 结果复用给别的 prompt，串答。漏因：只锁单 probe。修：`+ 非 probe 抛 CircuitOpenError`。
3. `ask.ts:35-39,161-165` / `wiki.ts:91-95` / `mcp-server.ts:200-202`：裸 `llm.generate`，breaker 未接线。漏因：没核调用图。修：`+ registry.get(site).generate(...)`。
4. `scheduler.ts:81-90`：不调 `synthesizeWiki()`，wiki audit/fallback 主路径失效。漏因：默认 reflect 后接 wiki。修：`+ await synthesizeWiki(...)`。
5. `outbox.ts:84-95,158-246`：先选行后事务，双 worker 可重复 drain 同一 row。漏因：没审 claim 原子性。修：`+ BEGIN IMMEDIATE` / `+ UPDATE ... RETURNING`。

## 2. 边界/并发漏洞
- `circuit-breaker.ts:109-117`：probe hang 后，全请求可被永久卡死。
- `outbox.ts:84-95`：drain 与 quarantine 可交错写同一 `seq`。

## 3. 测试覆盖盲点
- `reflect.test.ts`：3-fact 同 `(s,p)` 乱序返回，断言全指向最强 winner。
- `circuit-breaker.test.ts`：不同 prompt 不得同答；probe hang 后应快失败。

## 4. Day 4 前必修
- 修 `reflect` winner 选择。
- 真接 breaker，并改 half-open 语义。
- scheduler 接 wiki 主链路。

## 5. 允许推迟
- `audit.ts:179-183`：`--since` 截 ISO，带时区会误筛。
- `wiki.ts:158-171`：`wiki_page_observe` 会残留旧 observe。

## 6. 一句话总评
真漏点在运行时接线和并发语义，不在 schema。

DONE_R1_009
