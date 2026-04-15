### 1. P0-2 scope gap
- `audit.ts:42-60` 未实现。做 `recordDecision INSERT ... RETURNING`、`listDecisions WHERE kind/since LIMIT`。
- `reflect.ts:116-128` 的 `stale` 按契约不写 audit；答案：不是一行，也不是逐条。
- `reflect.ts:221-252` / `wiki.ts:114-144` 应补调用：contradiction 每 cluster 1 条，wiki 每页成功 1 条。`evidence_refs_json` 前者 `fact_id[]`，后者 `observe_id[]`。`profile_switch` Week 3 不做。
- CLI 漏了 `commands/audit.ts` + `main.ts` 注册。

### 2. P0-6 scope gap
- 数值冻结为 `5/30s/1`，写常量+测试。
- breaker 按 site key 共享，不是 per-request，也不是全局：`ask.expand`、`ask.answer`、`wiki.synthesis`、`mcp.ask.factory`。
- `mcp-server.ts:199-201` 构造器不会因缺配置失败，需 `validateLLMConfig()`。
- Self-Consumption 主防线放 `outbox.drainOne()`，`ingest.ts`/`web-ingest.ts` 只早拒绝；且现有 enum 无 `wiki-rebuild`。

### 3. 未预见失败模式
- half-open 并发探测 -> breaker 失效；单 probe 锁。
- wiki fallback 不标脏 -> `ask.ts` 继续读旧页；补 `wiki_pages.stale_at` + banner。
- Mock LLM 若不测“200 + 垃圾响应”，会漏掉 `ask.ts:41-49` 的退化路径。

### 4. 估算裁决
- P0-2: M。
- P0-6: L。
- Week 3: 4.5-5.5 天。

### 5. Week 3 Conditional Go
1. 延后 `profile_switch`。
2. 先补 `wiki_pages.stale_at` 和 breaker site-key。
3. 以 `outbox.drainOne()` 为统一拒绝点，并定义 `wiki-rebuild` 标记。

### 6. 一句话告诫
别把锁死的 fallback、enum、写入边界当成“后面再补”，那会直接毁掉审计可信度。
