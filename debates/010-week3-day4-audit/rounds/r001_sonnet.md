# R1 — Sonnet (KISS / 跨文件 drift)

Debate 010. 范围: Week 1-3 + Day 4 已 committed + 未 committed 总审.
约束: 不重复 003-009 已裁决项, file:line 锚点, 批代码不批人.

---

## 1. Top 缺陷

### D1 (HIGH): `scheduler.ts` 重复 import `existsSync`
- 锚点: `packages/compost-daemon/src/scheduler.ts:11` 和 `:456` 两次 `import { existsSync } from "fs"`.
- 后果: Bun/TS 容忍但 `tsc --strict`/esbuild 在部分配置下会 warn. 更重要的是**信号**: 009 Fix 2 批加代码时是 append 到文件末尾, 没检查头部 import, 说明 review 没过 linter. 同文件 `:449-457` block 也是"分层 import" 风格, 违反 KISS.
- 009 为何漏: 009 synthesis 只审行为正确性, 没 grep 重复 symbol.
- 修复: 删 `:456` 行, 头部已有.

### D2 (HIGH): `BreakerRegistry` 声明的 `mcp.ask.factory` 站点无任何 caller
- 锚点: `packages/compost-core/src/llm/breaker-registry.ts:24` 定义 `LLMCallSite` 包含 `"mcp.ask.factory"`; grep 整个 `packages/` 无第二处引用.
- 后果: LOCK 4 (debate 007) 写了 4 个 site, 实际只 wire 3 个 (`ask.expand` / `ask.answer` / `wiki.synthesis`). 未来新人看 enum 会困惑 "哪里调用". type 谎言.
- 009 为何漏: 009 忙于验证"registry 被 wire 上没", 没验 "registry 暴露的 site 全被用"的反向约束.
- 修复: 从 type union 删 `"mcp.ask.factory"`, 或在 `mcp-server.ts:212` 改成 `llmRegistry.get("mcp.ask.factory")` 包住 ask() 调用 (当前是直接把整个 registry 传进 ask, site 由 ask 内部分派, 所以 `mcp.ask.factory` 永远不会被命中).

### D3 (MEDIUM): Scenario C 测试未验证"单 registry 跨 wiki + ask"
- 锚点: `packages/compost-core/test/cross-p0-integration.test.ts:246, :259` — Scenario C 先建 `registry` 跑 `synthesizeWiki`, 再**另建** `answerRegistry` 跑 `ask`.
- 后果: 这正是 `main.ts:82` 真实 daemon 做的事 (一个 registry, 既给 reflect scheduler 的 wiki 又可能未来给 ask). 但测试没覆盖. 如果 `wiki.synthesis` 断路器 trip 把 shared state 污染到 `ask.*` 的 bug 出现, Day 4 测试不会抓到.
- 009 为何漏: Fix 1+2 裁决只要求"wire 上", 没要求"跨站点 registry 集成测试".
- 修复: Scenario C 后半部分改用同一 `registry` 驱动 ask, 断言 ask/wiki 的 breaker state 独立 (`registry.get("wiki.synthesis").getState() !== registry.get("ask.answer").getState()` 可独立变化).

### D4 (MEDIUM): `mcp-server.ts` 的 per-server registry 与 daemon-wide registry 互不知情
- 锚点: `main.ts:82` `new BreakerRegistry(new OllamaLLMService())` vs `mcp-server.ts:212` `llmRegistry = new BreakerRegistry(new OllamaLLMService())`.
- 后果: daemon 真运行时有**两份** `OllamaLLMService` + 两个 registry. Ollama 的 keep-alive 连接池翻倍, 一个 registry trip 不影响另一个 — 同一 Ollama 端点挂掉, MCP 侧已经熔断但 scheduler 侧还在打. ROADMAP:134 自报为 "known risk accepted", 但没代码注释说明这个取舍; 下个 reader 会以为是 bug.
- 009 为何漏: 009 Fix 1 要求 "wire registry 到 production", 没说"只能一份". 实施者为了避免 `mcp-server.ts` 依赖 `main.ts` 的 export 拆了.
- 修复最小: `main.ts` export `llmRegistry`, `mcp-server.ts` 的 `startMcpServer(db, registry)` 签名加第二参, 由 `main.ts:104` 传入 (当前是 `startMcpServer(db)`, 没 registry 参数). 估算 20 min.

### D5 (LOW): 文档 LLM call sites 表行号全部过时
- 锚点: `docs/ARCHITECTURE.md:241` 说 `wiki.ts:86` — 实际 `llm.generate` 在 `:92`. `:242` `ask.ts:35` 实际 `:36`. `:243` `ask.ts:152` 实际 `:177`. `:244` `mcp-server.ts:52` 实际 `:212`. `ROADMAP.md:134` `mcp-server.ts:57` 实际 `:53`. `ROADMAP.md:135` `wiki.ts:213` + `ask.ts:73` 都指向 docstring 行而非 `instanceof` 分派行.
- 后果: 下次审计 grep 依赖这些锚点全部失效. 每次 reflect scheduler 改参数都要同步更新 6 处, 概率 0.
- 009 为何漏: 009 自己是**生成**这个表格的 debate, 写 `.ts:<当时行号>` 没回检.
- 修复: 改成"函数名"而非行号 (`wiki.ts synthesizePage llm.generate`, `ask.ts expandQuery llm.generate`, etc.). 一次性迁徙.

---

## 2. Tech debt (≥ 3)

| # | 位置 | Cost 保持 | Benefit 修复 | 推迟底线 |
|---|---|---|---|---|
| T1 | `ask.ts:72` + `wiki.ts:216` union signature `LLMService \| BreakerRegistry` + `instanceof` 分派 | 加第 3 种 wrapper (retry / rate-limit) 时要改 2 处; param 名 `llmOrRegistry` 自曝是 hack | 提一个 `ILLMProvider.forSite(site)` 接口, caller 提前 `.get(site)`. 类型清爽, 调用点不用 instanceof | Week 4 新增任何 LLM wrapper 时一起做; 在此前可忍 |
| T2 | `audit.ts:211-216` float equality reconstruct tier (`=== 0.9 / === 0.85`) | 未来 migration 引入计算 floor 时静默落到 `exploration` | 改成 `floor >= 0.9 ? kernel : floor >= 0.85 ? instance : exploration` (5 行) | 当前 migration 是字面值 `DEFAULT 0.85`, 不会漂; 新 migration 引入计算值时必改 |
| T3 | `mcp-server.ts` + `main.ts` 双 registry (D4) | 两份 Ollama 连接池, ops 观察窗口分裂 | 共享 registry, 一处 trip 全站知道 | 一旦 MCP ask 和 daemon wiki 共用某 site 必改 |
| T4 | `breaker-registry.ts:24` 声明 `mcp.ask.factory` 但无 caller | 类型谎言, enum drift | 删或加 caller | 等 "MCP 工厂" 真需要时加, 否则随时删 |
| T5 | `scheduler.ts` 头部 import 已经 ~15 行 + 中段 `:449-457` 又一批 | 结构松散, P0-7 P0-3 P0-5 三批代码各自 append 到文件尾 | 合并所有 import 到顶部, 按块分段 | Week 4 新增 scheduler 时顺手整 |

---

## 3. 契约偏离 (≥ 2)

### C1 `ARCHITECTURE.md:244` vs `mcp-server.ts:212`
- Doc: "per-server singleton registry (debate 009 Fix 1). Holds circuit state across requests".
- Code: 对, **但** `main.ts:82` 也有一个, 两者独立. Doc 没写"另有一份 daemon-wide". ROADMAP:134 补了 "two instances" 的 risk entry, 但 ARCHITECTURE 没. 读 ARCHITECTURE 的人会误以为就这一份.
- 修复: ARCHITECTURE.md 第 244 行补一句 "daemon boot also builds a separate registry at `main.ts:82` for `startReflectScheduler`; they do not share state (see ROADMAP known-risks §134)."

### C2 `ROADMAP.md:102` vs `reflect.ts`
- Doc: "P0-4: `facts.archive_reason` enum (6 values frozen) + `replaced_by_fact_id` writes from `reflect.ts` step 3".
- Code: `reflect.ts:122` **step 2** (decay path) 写 `archive_reason = 'stale'`; `reflect.ts:240` step 3 写 `'contradicted'` + `replaced_by_fact_id`. 文档只点名 step 3, 漏了 step 2 的 `'stale'` 写入. Reader 会以为 stale path 没 archive_reason.
- 修复: ROADMAP.md:102 改 "writes from `reflect.ts` step 2 ('stale') + step 3 ('contradicted' + replaced_by_fact_id)".

### C3 `ARCHITECTURE.md:186` "superseded" enum 标 `⏳ reserved`
- Code: `reflect.ts` 任何路径都不写 `archive_reason = 'superseded'`, confirmed by grep. 文档 "reserved" 措辞准确, 但**存在下一轮审计 confusion 风险**: `'superseded'` 值在 schema CHECK 里允许, 外部 caller (CLI import/restore) 可能写入. 没 producer 就没 consumer 来消化这个状态.
- 修复: 要么在 migration 0010 CHECK 里砍掉 `'superseded'`, 要么加一行文档 "reserved by schema, no caller wires it; safe to ignore until Week 5+". 目前 "may fold into contradicted" 措辞太含糊.

---

## 4. Merge-blocker vs nice-to-have

### Merge-blocker (PR 前必修)
1. **D1 重复 import** — 2 min 删 `scheduler.ts:456`, 防止 tsc strict mode 将来爆炸.
2. **D5 文档行号** — 30 min 把 ARCHITECTURE.md "LLM call sites" 表和 ROADMAP "known risks" 表的 `<file>:<line>` 全换函数名锚点. 否则 PR review 看不对.
3. **C2 ROADMAP.md:102** — 1 min 补 "step 2 stale + step 3 contradicted", 否则"P0-4 完整吗"的自我声明是错的.

### Nice-to-have (Week 4 补即可)
- D2 删 `mcp.ask.factory` enum 值 (5 min, 但 type 谎言无 runtime 影响).
- D3 Scenario C 改用同 registry (15 min, 当前测试对共享状态不暴露 bug — 因为代码里本来就不共享).
- D4 单 registry 合并 (20 min, 但当前两 registry 分域使用, risk 是 "operational metric noise" 不是正确性).
- T1 union signature 重构 (等第 3 种 wrapper 到来).
- T2 float equality (等新 migration).
- C1 ARCHITECTURE.md 补"两份 registry" — 可以和 D4 合并一起删.
- C3 `superseded` 清理 — Week 5+ profile-switch 一起处理.

---

## 5. 一句话总评

代码功能过关、契约基本对齐, 但文件内行号 drift 泛滥 + 双 registry + enum 谎言暴露 "Week 1-3 三次加层没人整理" 的痕迹, Merge 前花 30 分钟清 3 件小事即可开 PR.

DONE_R1_010
