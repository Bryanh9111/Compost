## 1. Go/No-Go
**Conditional Go**。`0010/0011` 和 `reflect.ts` 已给出位点；但 `triage.ts`、`audit.ts`、`graph-health.ts` 仍是 stub，且 P0-1/P0-5 未对齐。

条件：
- 冻结 `health_signals` / correction signal 枚举
- `P0-0 + P0-3` 同 PR，改掉 null-stub 预期，并定出 `ask/wiki` fallback 与 scheduler 挂载点

## 2. Top 3 实施风险
- **风险**: P0-1/P0-5 契约冲突。**触发条件**: correction 写入 `health_signals`。**损失**: schema 返工、漏报。**预防措施**: 先补 migration+测试。
- **风险**: graph-health SQL/TS 漂移。**触发条件**: `0011` 已返回数值，但 TS/测试仍按 null stub。**损失**: 假绿、错误 snapshot。**预防措施**: `P0-0 + P0-3` 同 PR。
- **风险**: 调度接缝未定义。**触发条件**: 接 correction、LLM fallback 时发现 `scheduler.ts`/hook 只有 append/drain。**损失**: 周期滑坡。**预防措施**: 先做调度接口。

## 3. P0 顺序最后裁决
不完全认可。改为：
- Week 1: `P0-0 + P0-3` 同 PR，`P0-7` 并行
- Week 2: `P0-4 + P0-6`
- Week 3: `P0-2 + P0-5`
- Week 4: `P0-1 +` 测试

## 4. 测试覆盖盲点
- 缺 `fact_links` + recursive CTE 的 graph-health 真值测试；加在 `P0-0/P0-3`
- 缺 LLM 故障注入与 hook -> drain -> correction -> triage 集成测试；加在 `P0-6/P0-5/P0-1`

## 5. 撤退条件
- `P0-0 + P0-3` 后，10K facts snapshot 仍 >1s，或 `cluster_count` 仍写死 `0`
- Week 2 结束前 correction signal 仍要改 `health_signals` CHECK 才能落地
- `P0-6` 故障注入下，`ask/wiki` 仍直接抛错或阻塞 >10s

## 6. 独特视角
作为技术实现/schema/测试视角：先统一 CHECK、stub、调度接缝；最危险的是接口已命名，行为未定稿。
