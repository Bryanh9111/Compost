# Debate 009 — Synthesis: Week 3 Code Audit

> 🐙 Opus · 2026-04-15 · R1 only (focused, single round, strong convergence)
> Participants: 🔴 Codex / 🟡 Gemini / 🟠 Sonnet / 🐙 Opus

---

## 🟥 最严重发现: **P0-6 整个断路器在 daemon 路径上是死代码**

**3/4 voices 独立抓到** (Sonnet + Codex 明确, Gemini 间接). Opus R1 漏.

- `compost-daemon/src/mcp-server.ts:200-201` — `const llm = new OllamaLLMService(); await ask(db, ..., llm, ...)` 直接裸传.
- `cognitive/wiki.ts:86` — 接收 `llm` 参数调 `llm.generate()`, 没走 registry.
- `query/ask.ts:35 + 152` — 直接 `llm.generate()`, 没 wrap.
- `BreakerRegistry` (`llm/breaker-registry.ts`) **0 个生产调用点**, grep 只匹配自身文件.

**结果**: 即使 MockLLMService 18 个 test 都跑通了, 实际 daemon + CLI 执行路径上**断路器不生效** — 失败直接抛到 wiki.ts 的 catch (stale_at OK) 和 ask.ts 的 catch (BM25 fallback OK), 但 circuit 状态机/rolling window/half-open probe **永远不执行**.

**为什么 Week 3 plan-audit (debate 007/008) 漏**: plan-audit 只锁了 call-site 清单和 fallback 契约, 默认实施者会在 constructor/factory 把 wrapper 接上. 没有显式审 "实际 new 了 wrapped 版本吗".

**Day 4 必修 #1**: 接线 BreakerRegistry.
```ts
// mcp-server.ts:200
const { BreakerRegistry } = await import(".../llm/breaker-registry");
const { OllamaLLMService } = await import(".../llm/ollama");
const inner = new OllamaLLMService();
const registry = new BreakerRegistry(inner);
// pass registry through to ask() — requires ask.ts signature change
```
- `ask.ts` 接收 `registry: BreakerRegistry` 而非 `llm: LLMService`, 内部调 `registry.get("ask.answer").generate(...)` 和 `registry.get("ask.expand")`.
- `wiki.ts synthesizePage(db, topic, llm, ...)` 签名改为 `(db, topic, wikiLLM, ...)` where `wikiLLM = registry.get("wiki.synthesis")`.
- `synthesizeWiki` 签名同改.

估算: 2 小时 (包含测试).

---

## 🔴 Day 4 前必修 (4 项, ≤ 4 小时)

### Fix 1 (CRITICAL, 4/4): Wire BreakerRegistry (见上)

### Fix 2 (HIGH, Codex unique): scheduler 不调 synthesizeWiki
- **位置**: `packages/compost-daemon/src/scheduler.ts:81-90` (startReflectScheduler)
- **问题**: `reflect(db)` 完后**没调** `synthesizeWiki(db, llm, dataDir)`. daemon 每 6h 跑 reflect, wiki_rebuild audit 和 stale_at 逻辑永远不触发 — Week 3 的所有 wiki audit/fallback 工作**在 daemon 路径死掉**.
- **为何漏**: Week 1+2 实施时已有 startReflectScheduler, Week 3 加 wiki audit 没检查 "谁调用 wiki", 假设 daemon 会 (但实际不会).
- **修复**: startReflectScheduler 里, reflect() 成功后 `await synthesizeWiki(db, registry.get("wiki.synthesis"), dataDir)` (包 try/catch, 不让 wiki 错误拖垮 reflect 周期).

### Fix 3 (HIGH, Opus unique): 审计失败回滚 contradiction resolve
- **位置**: `reflect.ts:244-256` — `recordDecision` 调用在 `db.transaction` 内, throw 会回滚 contradiction arbitration + fact_links edges.
- **修复**: 包 try/catch:
  ```ts
  try {
    recordDecision(db, {...});
  } catch (err) {
    report.errors.push({ step: "auditContradiction", message: String(err) });
  }
  ```
  同样改 wiki.ts 的成功路径 audit 调用.

### Fix 4 (HIGH, Codex unique): half-open probe 返回 string 跨 prompt 污染
- **位置**: `circuit-breaker.ts:63-74` + `runProbe:87-96`
- **问题**: 并发 3 callers A/B/C 在 half-open, A 的 prompt "Paris?" 建了 probe, B 的 prompt "Berlin?" 通过 `probeInFlight` 拿到了 **A 的 answer** (关于 Paris). B 和 C 收到错误内容.
- **为何漏**: 我 R1 Edge 1 分析了 `probeInFlight` 状态机正确, 但没注意到返回值语义是按 prompt 的. Codex 抓到.
- **修复 options**:
  - A (保守): B/C 等 probe **完成** (success or fail), 然后重新跑自己的 prompt. 牺牲 half-open 的"单探针" 语义, 但返回正确.
  - B (简单): B/C 直接 throw `CircuitOpenError` (不 piggyback 到 probe). Probe 只归 A.
- **选 B** (更简单, 失败行为一致): 改 `generate()` half-open 分支:
  ```ts
  if (this.state === "half-open") {
    if (this.probeInFlight) throw new CircuitOpenError(this.siteKey);
    this.probeInFlight = this.runProbe(prompt, opts);
    // ...
  }
  ```
  B/C 不会 piggyback, 立即得 CircuitOpenError, 各自走 fallback.
- **更新测试**: circuit-breaker.test "half-open concurrent callers share the single probe" 测试语义要改 — peak=1 不变, 但 B/C 不再收到 probe result.

---

## 🟡 允许推迟 (≥ 5)

| 项 | 发现者 | 推迟理由 |
|---|---|---|
| `reflect.ts SQL` 缺 ORDER BY 导致 winner 非确定 | Codex #1 | 生产 99% 情况下 SQL 输出顺序稳定; 加 ORDER BY 是健壮但不紧急 |
| `audit.ts` INSERT+SELECT 改 RETURNING | Gemini 1.2 | bun:sqlite 单进程 `lastInsertRowid` 正确, 多进程 daemon 才有 race |
| `isWikiSelfConsumption` 依赖 env | Gemini 1.1 | 单用户单 daemon 场景, env 不会运行时变 |
| Migration concurrency lock | Gemini 1.3 | CLI 并发场景罕见 |
| ask.ts 硬编码 `slice(0, 5)` wiki pages | Gemini 1.4 | 改为 15 无风险, 但 Week 4 P0-1 triage 再一起调 |
| wiki fallback 无 cooldown (每 6h 重试 flood) | Opus Issue 3 | breaker 会吸收 (打开就不调), 但 history 会被 reflect ticker 撑住 open |
| ask.ts 空 hits + 非空 wiki fallback 丢失 context | Opus Issue 2 | LLM 失败时用户看 BM25 空列表仍能理解"没答案", 不致命 |
| CircuitBreaker `getState` 报告 half-open 时 probe 在飞 | Gemini 2.1 | 监控诊断误差, 不影响行为 |
| `wiki_page_observe` 重建只增不删 (Codex 5.2) | Codex | 每页最多 50 observes, 低增长率 |

---

## 📊 4-voice 矩阵

| 问题 | Opus | Sonnet | Codex | Gemini |
|---|---|---|---|---|
| BreakerRegistry 死代码 | — | **P1** | **#3** | implicit | **3/4 — 最大漏** |
| scheduler 不调 synthesizeWiki | — | — | **#4** | — | 1/4 unique but critical |
| half-open shared probe 返回错 prompt response | — | — | **#2** | 隐含 2.1 | Codex unique, 必修 |
| audit 失败回滚 reflect | **Issue 1** | — | — | — | Opus unique |
| reflect winner 非确定 (无 ORDER BY) | — | — | **#1** | — | Codex unique |
| audit INSERT+SELECT 原子性 | — | — | — | **1.2** | Gemini unique, 延后 |
| wiki 重试 flood | **Issue 3** | — | — | — | Opus unique |
| ask.ts wiki 切片 5 太少 | — | — | — | **1.4** | Gemini unique, 延后 |
| Self-Consumption env deps | — | — | — | **1.1** | Gemini unique, 延后 |
| ask.ts fallback 丢 wiki context | **Issue 2** | — | — | — | Opus unique, 延后 |

---

## 🚨 元教训

1. **Plan-audit + code-audit 都看 call-site 清单, 两轮都没抓到"call-site 列出的 wrapper 是否实际实例化"**. Lock 了 4 个 key, 写了 registry, 每个 test 都新 `BreakerRegistry(inner)`, 但**生产代码 `new OllamaLLMService()` 裸传**. 未来: grep "new OllamaLLMService" + "BreakerRegistry" 对照.

2. **Scheduler 调用图应该是 plan audit 必查项**. Week 3 改了 wiki.ts audit + stale_at, 但 daemon 从不触发 wiki.ts. Plan-audit 默认"别人会调", 实际**没人调**. 下次 plan-lock 加: "新加的代码路径 在 daemon scheduler 里由谁调用?"

3. **Codex 专精 SQL 输出顺序 / 并发语义**. 4 个 R1 中 Codex 独家抓 #1 (winner ORDER BY), #2 (probe response cross-contamination), #4 (scheduler 不调 wiki), #5 (drainOne race). Sonnet + Opus + Gemini 都漏这类底层细节.

4. **Opus 专精"架构一致性"但漏"接线完成度"**. audit 错误回滚 / wiki cooldown 是语义级; 但 BreakerRegistry 死代码这种**"实施签到"**类的 bug 我漏了.

---

## 🟢 Go/No-Go for Day 4

**Conditional Go**. 修 Fix 1-4 (≤ 4 小时) 然后 Day 4 集成测试.

如果不修 Fix 1 直接做 Day 4 集成测试, 测试会 "通过" 但**验证的根本不是 Day 4 的目标** — breaker 从没启动, wiki_rebuild audit 从不写, 集成测试是假绿.

**顺序**:
1. Fix 1: 接线 BreakerRegistry (2h)
2. Fix 3: audit try/catch 隔离 (15 min)
3. Fix 2: scheduler 调 synthesizeWiki (30 min)
4. Fix 4: half-open 改 throw (30 min + 测试更新)
5. 全套 `bun test` — 期望 283 → 280+ (probe test 要更新)
6. Day 4 集成测试开工
