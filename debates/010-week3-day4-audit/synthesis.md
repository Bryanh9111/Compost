# Debate 010 — Synthesis (Opus)

Week 3 + Day 4 累积审查. 4 方 R1 全部 landed.

## 共识 (≥ 2 方 flag)

| 议题 | Codex | Gemini | Sonnet | Opus | 共识强度 |
|---|---|---|---|---|---|
| scheduler wiki hook 零集成覆盖 | T2 | — | D3 | D1 | 3/4 |
| 两个独立 `BreakerRegistry` 实例 | T3 | — | D4 | D2/T1 | 3/4 |
| union signature (`LLMService \| BreakerRegistry`) tech debt | T1 | T1 | T1 | D5 | 4/4 |
| Day 4 测试有假阳性 | #2,#3 | — | D3 | D3 | 3/4 |
| `mcp.ask.factory` enum 无 caller / type lie | — | — | D2 | — | 1/4 (Sonnet 独家) |
| `ask()` 在 hits=0 时丢 wiki+stale banner | #1 | — | — | ROADMAP risk 3 | 2/4 (Codex 独家给了 reproducer) |
| 文档 file:line 锚点过时 | C3 | — | D5 | C3 | 3/4 |
| ROADMAP P0-4 描述漏了 step 2 'stale' | — | — | C2 | — | 1/4 |
| half-open 长任务饿死短任务 | — | #1 | — | — | 1/4 (Gemini 独家) |
| `ask.ts` fallback 无 log | — | #2 | — | D4 | 2/4 |

## 终裁: Merge-blocker (PR 前必清, ≤ 1h)

按依赖/效率排序:

1. **[2 min] `scheduler.ts:456` 删重复 `import { existsSync } from "fs"`** (Sonnet D1)
   文件头 `:11` 已导入. strict mode 会炸.

2. **[2 min] 文档快速对齐** (Sonnet C2 + Codex C3 + Opus C2)
   - `docs/ROADMAP.md:122` "283 pass / 28 files" → "286 pass / 29 files"
   - `docs/ROADMAP.md:102` P0-4 描述补 "step 2 'stale' + step 3 'contradicted'"
   - `docs/ARCHITECTURE.md:234` "Every LLM invocation MUST" → "Every **TypeScript** LLM invocation MUST" (Python 侧已明写 out-of-scope)

3. **[5 min] 测试注释 vs 代码不符** (Codex #2, Sonnet D3)
   `cross-p0-integration.test.ts:246,259` Scenario C 的注释说"same registry"但代码构造了两个. 选一: (a) 改用同一 `registry` (更有测试价值, 验证 `wiki.synthesis` state 和 `ask.answer` state 在同 registry 下独立演化) (b) 改注释, 承认这是两个独立 registry 的 happy path 组合.
   推荐 (a).

4. **[10 min] `ask.ts` LLM fallback 加结构化日志** (Gemini #2, Opus D4)
   `query/ask.ts:166-177` 的 `catch {}` 吞掉所有错误. 至少 `console.warn` + err.message + err.name (让 SRE 区分 `CircuitOpenError` vs 真实 5xx). 对 `expandQuery` 的 catch 同理.

5. **[15 min] `breaker-registry.ts:24` 删 `mcp.ask.factory` 或补 caller** (Sonnet D2)
   Enum 声明但无 caller = type 谎言. 当前无 caller, 直接从 union 删掉; 真需要再加.

6. **[10 min] ARCHITECTURE.md 补"双 registry"脚注** (Sonnet C1)
   line 244 或附近加一句: "daemon boot 另有一份 registry 在 `main.ts` for `startReflectScheduler`; 两者不共享 state (ROADMAP known-risks row 1 已登记)".

**总计 ≤ 45 min 即可开 PR.**

## 不阻断 Merge 但需要进入 Week 4 待办

| 项 | Owner | Effort | Trigger |
|---|---|---|---|
| scheduler wiki hook 集成测试 (Opus D1 + Sonnet D3 + Codex T2) | Week 4 Day 1 | 2h | 写一个 `scheduler.test.ts`, 用 1ms interval + MockLLM registry 驱动 `startReflectScheduler`, 断言 `wiki_rebuild` audit 被写 |
| 合并两个 `BreakerRegistry` 实例 (Opus T1 + Sonnet D4 + Codex T3) | Week 4 Day 1 | 30 min | `main.ts` 导出, `startMcpServer(db, registry)` 加参 |
| half-open 长任务饿死短任务 (Gemini #1) | Week 4 design | 2h | 考虑 per-site openMs 或 probe timeout cap |
| union signature 重构为 `ILLMProvider.forSite()` (Codex/Gemini/Sonnet/Opus all T1) | 等第 3 种 wrapper | 1h | Retry/RateLimit wrapper 出现时必做 |
| `compost audit list` CLI 测试 (Codex T4) | Week 4 | 30 min | enum 验证 + exit code |
| `OllamaLLMService` 未运行时的 UX (Opus 6) | Week 4 | 1h | `compost doctor --check-llm` 实装 |
| `ask()` hits=0 时查 wiki (Codex #1 / ROADMAP risk 3) | Week 4 | 1h | 按 question 做 wiki_pages title 查找, 决定是否 short-circuit |
| `stale_wiki` triage signal 未兑现 (Codex #4) | P0-1 triage 一起做 | 1h | 在 `synthesizeWiki` fallback 路径写 `health_signals` 行; 或文档降级为 "P0-1 dependency" |
| `scheduler.ts` import 整理 (Sonnet T5) | Week 4 | 15 min | 头部一把梭 |
| `archive_reason='superseded'` 清理 (Sonnet C3) | Week 5+ | 5 min | migration CHECK 收紧或文档锁定语义 |
| `reconstructConfidenceTier` float equality (Opus/Sonnet/Codex T) | 首次引入计算 floor 时 | 5 min | 改 `>=` 门槛比较 |
| `circuit-breaker.test:179` setTimeout(30) CI flaky (Gemini #2) | 观察 | — | 先看 CI 是否真 flaky, 不 flaky 就不动 |

## 分歧 (未达成共识, 记录不处理)

- **Gemini #1 (half-open 饿死)**: 独家观点, 但**背后假设是"wiki 合成触发 probe"**. 当前 daemon 路径里 wiki 和 ask 是**不同 registry** (D4 未合并前), 所以此场景不存在. 一旦合并 registry (Week 4 待办 1+2), 此问题升级为真风险, 届时再 design.
- **Codex #1 (`ask()` wiki-only blind spot)**: Codex 认为 blocker, 其余 3 方没提 (Opus 已在 ROADMAP risk 3 登记为 "accepted"). 放 Week 4 待办.

## 总评

Week 1-3 + Day 4 功能面可合, 四方一致认为"代码过关". 拦截点都是文档/
测试/注释的**卫生问题** + 一个 enum 谎言 + 一个 log 缺失, 总耗 ≤ 45 min.
真正的设计争议 (双 registry / half-open / union signature) 都归到
Week 4 待办, 不阻断 PR.

## 建议执行顺序

1. 按上面 Merge-blocker 6 项清单, 顺序执行, 预计 45 min
2. 全量 `bun test` 验证 286 pass
3. `git add` + commit (消息: "fix(phase4-d): apply 6 hygiene fixes from debate 010 pre-PR audit")
4. 开 PR
5. Week 4 Day 1 优先做"scheduler integration test + 合并 registry" (依赖关系: 合并 registry 必须先做, 否则 integration test 要覆盖两份)

DONE_010
