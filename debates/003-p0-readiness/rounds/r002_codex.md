## 1. 共识合并
- `P0-1` 收尾：Sonnet“消费所有其他P0信号”；Opus“5个其他P0下游”；Gemini放 `W4`。
- `P0-6` 先定降级：Gemini“来源黑名单”；Opus“wrap已有LLMService+timeout+circuit breaker”；Sonnet“Self-Consumption guard”。
- `P0-7` 前置：Sonnet“Week1第一天启动”；Opus backup/reflect“独立时间窗”；Gemini“安全边界”。

## 2. 真分歧
- 不同意 Gemini `Go`；也撤回“`P0-0+P0-3`同PR”。Sonnet“反对捆绑同PR”，Opus拆成“Week1 API/Week2 graph-health”。

## 3. Go/No-Go
**Conditional Go**。Pre-P0：`P0-7`恢复演练+分窗；冻结 correction signal/`CHECK`；先定`P0-0`API再做`P0-3`；定`ask/wiki` fallback+self-consumption guard。

## 4. P0 顺序
`P0-7->P0-0->P0-4->P0-3->P0-2+P0-5+P0-6->P0-1`

## 5. 修正
- 撤回“`P0-0+P0-3`同PR”。
