## 1. Top defects

1. `packages/compost-core/src/query/ask.ts:123-131,170-171`：`ask()` 只从 `hits.subject` 反查 wiki；`hits.length===0` 直接返回 “not enough information”，已有 wiki 页与 `stale_at` 提示都会丢。我已本地复现：已有 `paris.md` 且 facts 全归档时，返回 `wiki_pages_used=[]`。009 漏掉它，因为 Day4 套件没覆盖 ROADMAP 已登记的 empty-hit 路径。修复：0-hit 时先按 `question/title/slug` 查 `wiki_pages`，再决定是否早退。  
2. `packages/compost-core/test/cross-p0-integration.test.ts:257-262`：注释说 “same registry”，代码却新建了 `answerRegistry`；这并没有验证 shared-registry / union wiring，只是两个独立 happy path。009 漏掉它，因为这是 Day4 新测，且错误不会让测试红。修复：复用同一个 `BreakerRegistry`，并断言两个 site key 都走过。  
3. `packages/compost-core/test/cross-p0-integration.test.ts:136-141`, `packages/compost-core/src/cognitive/fact-links.ts:64-82`：Scenario A 只看 link 数量，不看 `observed_count`。若未来重复 `addLink()`，边仍是 1 条，测试会假绿，但图统计会漂。修复：二次 `reflect()` 后补查 `observed_count=1`。  
4. `docs/ARCHITECTURE.md:241`, `packages/compost-core/src/cognitive/wiki.ts:97-117`, `packages/compost-core/src/cognitive/triage.ts:55-71`：文档写的是 wiki 失败会 surface `stale_wiki` triage signal；代码只写 `wiki_pages.stale_at`，`triage()` 仍是 stub。009 漏掉它，因为修的是 fallback，不是 P0-1 契约回看。修复：补 signal 写入/扫描，或把文档降级为 future work。

## 2. Tech debt

- `packages/compost-core/src/query/ask.ts:72-86`, `packages/compost-core/src/cognitive/wiki.ts:216-225`：`LLMService | BreakerRegistry` + `instanceof`。保持成本：每加一种 wrapper 都要改两处分派；保留收益：当前改动最小。可推迟到出现第二种 wrapper（Retry/RateLimit）前。  
- `packages/compost-daemon/src/scheduler.ts:81-118`, `packages/compost-daemon/src/main.ts:82-88`：scheduler/wiki hook 只有生产 caller。保持成本：prod-only 断线很难被提早发现；保留收益：现在无需大改 clock/socket 注入。最多推迟到 Week 4 第一批测试债。  
- `packages/compost-core/src/cognitive/audit.ts:211-216`：`reconstructConfidenceTier` 用 float equality。保持成本：未来若 floor 改成计算值，列表返回会错 tier；保留收益：当前常量 floor 简单直接。可推迟到首次引入非字面量 floor。  
- `packages/compost-cli/src/commands/audit.ts:33-74`：`compost audit list` 无 CLI 级测试。保持成本：flag/exit code 回归无人兜底；保留收益：核心查询逻辑已有单测。可推迟到 Week 4 CLI 回补。

## 3. 契约偏离

- `docs/ARCHITECTURE.md:241` vs `packages/compost-core/src/cognitive/wiki.ts:97-117` / `packages/compost-core/src/cognitive/triage.ts:55-71`：`stale_wiki` triage signal 尚未兑现。  
- `docs/ARCHITECTURE.md:244` vs `packages/compost-core/src/llm/ollama.ts:21-27` / `packages/compost-daemon/src/mcp-server.ts:210-224`：文档写 “constructor throws on missing config”；实际 ctor 无校验，失败发生在首次 `generate()`，MCP 也不会给出固定 `doctor` hint。  
- `docs/ROADMAP.md:122` vs 当前 Day4 状态：文档仍写 `283 pass / 28 files`，与现状 `286 pass / 29 files` 不符。

## 4. Merge-blocker vs nice-to-have

- Merge-blocker：修 `ask()` 的 wiki-only blind spot；修 Scenario C 伪共享 registry；修 Scenario A 的 `observed_count` 假绿断言；在 PR 前统一 `stale_wiki` 文档与实现。  
- Nice-to-have：补 `startReflectScheduler`/`startDaemon` 端到端测试；补 `compost audit list` CLI 测试；第二种 LLM wrapper 落地前再重构 union signature。

## 5. 总评

主路径已接近可合，但 Day4 覆盖有两处假阳性，且 wiki-only 问答契约还没闭合。
