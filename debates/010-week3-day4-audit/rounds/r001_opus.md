# Debate 010 R1 — Opus (architecture + integration)

## 1. Top 5 缺陷 (by severity)

### D1 (HIGH) `startReflectScheduler` 无法 reach wiki hook 的单元覆盖
`packages/compost-daemon/src/scheduler.ts:81-130` 的新 `opts: { llm, dataDir }`
分支只有 `main.ts:82` 一个 production caller, **没有任何测试触达这一分支**.
Day 4 `cross-p0-integration.test.ts` 三个 scenario 全部绕过 scheduler, 直接
调 `reflect()` + `synthesizeWiki()`. 意味着 "reflect 后自动 synth wiki" 这条
Fix 2 主路径从未被执行证明. 修: 在 `packages/compost-daemon/test/` 下加一个
scheduler.test.ts, inject 1ms interval + stub reflect + MockLLM registry,
assert `synthesizeWiki` 被调用至少一次并且 wiki_rebuild audit row 写入.

### D2 (HIGH) `mcp-server.ts:52` 的 `llmRegistry` 在 closure 中但无 lifecycle 钩子
`packages/compost-daemon/src/mcp-server.ts:52-57` 将 `llmRegistry` 定义在
`startMcpServer` 的 closure 里, 经由 `compost.ask` handler 访问. 问题是 —
`server.close()` 在 `main.ts:109` 的 cleanup 路径中调用, 但**没有主动把
llmRegistry 置 null 或释放**. OllamaLLMService 持有 fetch-style HTTP client
不是大问题, 但 daemon reload (socket cmd `reload`, `main.ts:167-175`)
只 `upsertPolicies`, **未重建 registry**. 如果用户换了 Ollama URL 或模型,
ReLOAD 后 mcp 仍指向老实例. 修: reload path 也销毁 llmRegistry, 或者
直接把 registry 构造提到 startDaemon 级别并经由参数注入.

### D3 (MEDIUM) Day 4 Scenario B 绕过了真实的 BreakerRegistry dispatch
`packages/compost-core/test/cross-p0-integration.test.ts:155-170` 直接构造
`new CircuitBreakerLLM(inner, "wiki.synthesis", ...)` 而非通过 registry,
理由是要自定义 `minFailures:1`. 但这意味着 "registry.get('wiki.synthesis')
返回的 breaker 行为 == 手搓的 CircuitBreakerLLM" 这一等价性**完全没测**.
如果 BreakerRegistry 未来给不同 site 传不同 opts, test 不会炸. 修: 加一个
断言 `failingAskRegistry.get("ask.answer") instanceof CircuitBreakerLLM` +
`breaker.siteKey === "ask.answer"` (需要暴露 siteKey getter 或 .name).

### D4 (MEDIUM) `wiki.ts` audit 失败 console.warn 无结构化上下文
`packages/compost-core/src/cognitive/wiki.ts:193-200` Fix 3 用
`console.warn` 吞 audit 错误. 对比 `reflect.ts:289-295` 的
`report.errors.push` (结构化). daemon 启动后 stdout 归 pino JSON log, 但
`console.warn` 走 stderr 裸文本 — 运维 grep 不到. 修: 改为在 synthesizeWiki
return value 加 `errors: Array<{topic, message}>` 字段, scheduler hook
把它 pino.log 出来; 或者 inject 一个 log 回调.

### D5 (LOW) union signature 的 `llmOrRegistry` 命名 + 重复分派
`query/ask.ts:73-82` 和 `cognitive/wiki.ts:213-218` 各有一个
`instanceof BreakerRegistry` 分派 + `.get(site)` 调用. 今天只有两处, 未来
profile_switch / excretion wiki 回写等新 call site 会继续复制. 修 (非
blocker): 在 `llm/breaker-registry.ts` 加辅助函数 `resolveLLM(x, site):
LLMService` 封装 instanceof 判断, 两处 import 同一个助手.

## 2. Tech debt 清单

### T1 两个 BreakerRegistry 实例 (mcp-server vs main)
位置: `main.ts:82` + `mcp-server.ts:52`.
保持成本: 两处分别触发 circuit open, 观测 site (wiki.synthesis vs ask.*)
恰好不重叠, 所以**今天无功能影响**. 但 debug 时 "为什么同一 Ollama 挂掉
一个 registry 跳 open 另一个不跳" 会困扰 oncall.
修成本: ~30min — 将 main.ts 的 `llmRegistry` 作为 `startMcpServer(db,
{ llmRegistry })` 参数, mcp-server.ts 删除 lazy init.
推迟 OK 至: Week 4 P0-1 triage 加入共享 ask 路径时必须修.

### T2 `EvidenceRefs` union 中 `profile_switch` 无 producer
位置: `cognitive/audit.ts:35-73`.
保持成本: schema CHECK 允许 kind='profile_switch', 但无代码写入. 直接
手工 `INSERT` 能产生 "silently accepted 脏数据". 低概率.
修成本: ~15min — 要么从 union 移除 + schema CHECK 收紧, 要么加 TODO 注释
说明预留给 Week 5+.
推迟 OK 至: Week 5 profile 切换器实装前.

### T3 Self-Consumption regex 仅 Unix path
位置: `ledger/outbox.ts isWikiSelfConsumption`.
保持成本: 目前 macOS-only 开发, prod 也是 Unix. Windows 0 用户.
修成本: ~45min — 加 `file:///[A-Z]:/...` 分支 + test.
推迟 OK 至: 首次 Windows portability 需求出现时 (Phase 5).

### T4 `cross-p0-integration.test.ts` 只有 3 场景
位置: `packages/compost-core/test/cross-p0-integration.test.ts`.
保持成本: 未覆盖的组合: reflect 时 circuit 正 open / 连续两次 reflect 期间
wiki breaker 从 open 恢复 / backup 与 reflect 时间窗 overlap 导致 VACUUM
抢锁. 回归风险中等.
修成本: ~2h — 再加 3-5 scenario + 真实 scheduler mini-loop.
推迟 OK 至: Week 4 前 (作为 Week 4 规划的 done-definition 之一).

## 3. 契约偏离

### C1 ARCHITECTURE.md 说 LLM 调用**必须**通过 circuit breaker, 但 `ingest/llm_facts.py` 未通过
`docs/ARCHITECTURE.md:234` 写 "Every LLM invocation MUST be wrapped by P0-6's
circuit breaker". 表格第 5 行坦白 Python 侧 out-of-scope — 但 "MUST" 是
硬约束语言, 与 exception 矛盾. 修: 把 line 234 改为 "Every **TypeScript**
LLM invocation…" 或在 MUST 后紧跟 "TS 侧; Python 侧见下表第 5 行".

### C2 ROADMAP.md 风险 3 (wikiContext drops when hits.length===0) 无代码 comment
`query/ask.ts:154` 附近对 `queryResult.hits.length === 0` 的 short-circuit
没有注释说明 "wiki stale 信号在 hits==0 时丢失". 文档说了是已知风险, 代码
里读 ask.ts 的人不会看 ROADMAP. 修: 在 ask.ts:154 上面加一行注释 ref
ROADMAP known-risks.

### C3 `archive_reason` enum 'superseded' 状态模糊
`docs/ARCHITECTURE.md:184` 说 'superseded' ⏳ reserved (may fold into
`contradicted`). 但 reflect.ts 步骤 3 实际只写 'contradicted' —
'superseded' 字面 on schema 但 0 caller. 与 'profile_switch' 并列待清理.

## 4. Merge-blocker vs nice-to-have

### Blocker (不修不开 PR, 2 项)
- **D1**: scheduler wiki hook 零覆盖率. 加一个 scheduler integration test
  (即使 sleep 极短 + 单次 tick), 否则 Fix 2 等于 "代码写了但没人证明它跑".
- **D2 部分**: 至少把 `mcp-server.ts` reload 路径的 stale registry 风险
  写成代码 comment + ROADMAP 风险表第 9 行. 真修可 Week 4.

### Nice-to-have (Week 4 补即可)
- D3 registry dispatch 等价性测试
- D4 wiki audit errors 结构化日志
- D5 resolveLLM helper
- T1-T4 全部
- C1-C3 文档语言精修

## 5. 总评

Week 3 + Day 4 代码面功能正确、测试 286 通过、八项 P0 全 land, 值得 PR;
但 scheduler Fix 2 的**daemon 主路径零集成覆盖** + mcp reload 下的 stale
registry 是真空. 在加一个 scheduler test 和 reload comment 之前, PR
description 必须诚实标注这两个 gap, 否则回归点会在 Week 4 被 oncall 踩到.

DONE_R1_010
