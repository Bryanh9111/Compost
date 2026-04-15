# R001 Sonnet 4.6 - Week 3 Code Audit (Debate 009)

审计模型: Sonnet 4.6 (KISS / 跨文件 drift 视角)
审计范围: Phase 4 Week 3 四个 commit (P0-2 / P0-6)
日期: 2026-04-15

---

## 1. Top 5 问题 (按严重度)

### P1 - CRITICAL: BreakerRegistry 是死代码 - 生产 LLM 路径无断路器保护

**`packages/compost-daemon/src/mcp-server.ts:201`**

```ts
// 实际代码
const llm = new OllamaLLMService();
const result = await ask(db, input.question, llm, { ... });
```

`BreakerRegistry` 定义在 `src/llm/breaker-registry.ts` 但在整个代码库中没有任何生产调用点引用它 (grep 确认只有自身文件)。`wiki.ts` 的 `synthesizeWiki` 直接接收 `LLMService` 参数, 由调用方决定是否包装断路器。daemon 调用时传入裸 `OllamaLLMService`, 完全绕过 P0-6 合约。

**为何 plan-audit 漏**: debate 007/008 审查了断路器的 *内部逻辑正确性*, 未检查 *registry 是否实际被注入生产路径*。合约说 "every LLM invocation MUST be wrapped", 但没有编译期强制 (接口相同, 裸 service 能无声通过)。

**修复 diff**:
```diff
// packages/compost-daemon/src/mcp-server.ts
+import { BreakerRegistry } from "../../compost-core/src/llm/breaker-registry";
...
-const llm = new OllamaLLMService();
+const rawLlm = new OllamaLLMService();
+const registry = new BreakerRegistry(rawLlm);
+const llm = registry.get("ask.answer");  // ask path
```
`wiki.synthesizeWiki` 需要单独传 `registry.get("wiki.synthesis")` - 目前 daemon 调用 wiki 的路径也须对齐。

---

### P2 - HIGH: `listDecisions` 置信层反向映射用 magic number, 扩展必断

**`packages/compost-core/src/cognitive/audit.ts:211-216`**

```ts
confidenceTier:
  r.confidence_floor === 0.9
    ? "kernel"
    : r.confidence_floor === 0.85
      ? "instance"
      : "exploration",
```

写入时用 `CONFIDENCE_FLOORS[tier]` (单一来源), 读取时用硬编码数字反推 tier. 若 `CONFIDENCE_FLOORS` 某一天修改 (如 `instance` 从 0.85 -> 0.87), 写入正确但读取静默错误 - 所有历史 `instance` 记录变成 `exploration`。未来 `profile_switch` 使用 `kernel(0.9)` 但若常量变了则读取也崩。

**为何 plan-audit 漏**: debate 审查聚焦 evidenceRefs payload shape 与 kind 匹配校验, 未审查读路径的 tier 反推逻辑与写路径常量的耦合。

**修复 diff**:
```diff
// audit.ts - 新增反向 map, 替换 magic number
+const TIER_BY_FLOOR = new Map<number, ConfidenceTier>(
+  Object.entries(CONFIDENCE_FLOORS).map(([k, v]) => [v, k as ConfidenceTier])
+);
...
-confidenceTier:
-  r.confidence_floor === 0.9 ? "kernel" : r.confidence_floor === 0.85 ? "instance" : "exploration",
+confidenceTier: TIER_BY_FLOOR.get(r.confidence_floor) ?? "exploration",
```

---

### P3 - HIGH: wiki 回退逻辑用两套 `safePath` 重复计算, 共享状态条件竞争

**`packages/compost-core/src/cognitive/wiki.ts:101` 和 `wiki.ts:120`**

```ts
// 回退分支 (LLM 失败)
const safePath = topic.toLowerCase().replace(...).replace(...);  // line 101
const pagePath = `${safePath}.md`;
const existing = db.query("SELECT path FROM wiki_pages WHERE path = ?").get(pagePath)
// ...标记 stale

// 成功分支 (LLM 成功) - 函数继续
const safePath = topic.toLowerCase().replace(...).replace(...);  // line 120 - 重复计算
```

回退逻辑在 `catch` 块内独立计算 `safePath/pagePath` + 查 `existing`, 而成功路径之后又重算一次。除了冗余之外, 两处 `existing` 查询之间没有事务包裹 - 若并发写入在两次查询之间 INSERT wiki_pages, 成功路径会走 UPDATE 而非 INSERT, 但回退路径会漏掉新增行。

**为何 plan-audit 漏**: 回退路径是 Week 3 新增, plan-audit 侧重 stale_at 语义正确性, 未检查 catch 块与成功路径的代码重复 + 双重查询无原子性。

**修复 diff**:
```diff
 async function synthesizePage(...) {
   ...
+  const safePath = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
+  const pagePath = `${safePath}.md`;
+  const existing = db.query("SELECT path FROM wiki_pages WHERE path = ?").get(pagePath) as { path: string } | null;
+
   try {
     markdown = await llm.generate(prompt, ...);
   } catch (err) {
-    const safePath = topic.toLowerCase()...;
-    const pagePath = `${safePath}.md`;
-    const existing = db.query(...).get(pagePath);
     if (existing) {
       db.run("UPDATE wiki_pages SET stale_at = datetime('now') WHERE path = ?", [pagePath]);
     }
     ...
     return { created: false, updated: false };
   }
-  const safePath = topic.toLowerCase()...;
-  const pagePath = `${safePath}.md`;
   const fullPath = join(wikiDir, pagePath);
   ...
-  const existing = db.query(...).get(pagePath);
```

---

### P4 - MEDIUM: `probeInFlight` 在 probe 成功后被 `finally` 清零, 并发等待者拿到正确结果但竞态窗口存在

**`packages/compost-core/src/llm/circuit-breaker.ts:111-117`**

```ts
if (this.probeInFlight) return this.probeInFlight;
this.probeInFlight = this.runProbe(prompt, opts);
try {
  return await this.probeInFlight;
} finally {
  this.probeInFlight = null;  // 在 probe 完成、状态切回 closed 之前, 等待者仍引用旧 Promise
}
```

等待者通过 `return this.probeInFlight` 持有同一 Promise 引用, probe 完成后 `finally` 把 `probeInFlight` 设 null, 但等待者的 Promise 引用仍有效 - 这是正确的。然而: 若 probe 成功且状态切回 `closed`, 新的调用者在 `finally` 执行完毕前进入 `generate()`, 会走 `if (this.probeInFlight)` 并拿到 `null` -> 直接走 `closed` 路径, 这是预期行为。但若 probe 失败 (re-open), `runProbe` 抛出异常, `finally` 先把 `probeInFlight = null`, 再 rethrow - 等待者会各自收到同一个 rejection, 符合 Promise 语义。**实际问题**: `runProbe` 的 catch 块写 `this.openedAt = this.now()` 但此时 `this.now()` 是注入的时钟, 若没有注入则用 `Date.now()` - 在测试中 clock 是固定值, probe 失败后重新计时用同一 ts 而非递增后的 ts, 导致 `maybeTransition` 立即把 `open -> half-open` 再次触发 (若 openMs=0 则死循环)。生产中无影响, 但测试 `half-open probe failure -> open, timer restarts` 依赖 `clock.now()` 没有推进, 断言可能在某些时序下不稳定。

**为何 plan-audit 漏**: 测试覆盖了正常序列, 但未检查 probe 失败后 `openedAt` 重置时 `now()` 的值与 probe 开始时相同 (clock 没有推进)。

**修复**: `runProbe` catch 块改为 `this.openedAt = this.now()` 调用之前先推进一个 epsilon, 或更简洁地在 probe 开始时记录 `const probeStartedAt = this.now()` 并在失败时用此值:
```diff
 private async runProbe(prompt, opts) {
+  const probeStartAt = this.now();
   try { ... }
   catch (err) {
     this.state = "open";
-    this.openedAt = this.now();
+    this.openedAt = probeStartAt;
     throw err;
   }
 }
```

---

### P5 - MEDIUM: `isWikiSelfConsumption` COMPOST_DATA_DIR 路径子目录绕过

**`packages/compost-core/src/ledger/outbox.ts:318-322`**

```ts
const overrideDir = process.env["COMPOST_DATA_DIR"];
if (overrideDir) {
  const prefix = overrideDir.endsWith("/") ? overrideDir : `${overrideDir}/`;
  if (path.startsWith(`${prefix}wiki/`) && /\.md$/.test(path)) return true;
}
```

若 `COMPOST_DATA_DIR=/tmp/compost-test` 且攻击者控制的 source_uri 为 `file:///tmp/compost-test-evil/wiki/fake.md`, 则 `path.startsWith("/tmp/compost-test/wiki/")` 不匹配 (有尾斜杠保护, 此处正确)。**实际漏洞**: 若 `COMPOST_DATA_DIR` 本身包含 `/wiki/` 子路径如 `/data/project-wiki/compost`, 前缀变为 `/data/project-wiki/compost/wiki/` - 正常匹配不受影响。但 `overrideDir` 未做规范化 (symlink / `.` / `..`), 若 `COMPOST_DATA_DIR=/tmp/../tmp/compost-test` 则 `prefix=/tmp/../tmp/compost-test/wiki/` 而 `path` 是经 OS 解析的绝对路径, 两者比较必然失败 -> **自消费检测完全失效**。

**为何 plan-audit 漏**: debate 007 Lock 5 讨论了检测位置 (drainOne vs adapter 层), 未审查 COMPOST_DATA_DIR 路径未规范化导致检测失效的情况。

**修复 diff**:
```diff
+import { realpathSync } from "fs";
+
 export function isWikiSelfConsumption(sourceUri: string): boolean {
   ...
   const overrideDir = process.env["COMPOST_DATA_DIR"];
   if (overrideDir) {
-    const prefix = overrideDir.endsWith("/") ? overrideDir : `${overrideDir}/`;
+    let normalized: string;
+    try { normalized = realpathSync(overrideDir); } catch { normalized = overrideDir; }
+    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
     if (path.startsWith(`${prefix}wiki/`) && /\.md$/.test(path)) return true;
   }
```

---

## 2. 边界/并发漏洞

### B1: `resolveTx` 内 `recordDecision` 写入 - 审计行在事务失败时回滚但 loser 更新可能已提交

**`packages/compost-core/src/cognitive/reflect.ts:232-288`**

`resolveTx = db.transaction(...)` 包裹了 `supStmt.run` + `winStmt.run` + `recordDecision`。bun:sqlite 的 `db.transaction` 确保整体原子, 这里是正确的。**边界问题**: `recordDecision` 内部执行了额外的 `SELECT decided_at` (audit.ts:151-153), 这个 SELECT 在同一事务内, 但若 SQLite WAL 模式下某个 reader 在事务中间读取, 会看到 decision_audit 行已插入但 facts 还未更新 (幻读)。WAL 隔离级别是 snapshot, 事务外部 reader 看到一致快照 - 实际无问题。**真正边界**: `resolveTx` 抛出异常时 `report.contradictionsResolved` 已在循环内递增 (`losersResolved += cluster.losers.size` 在事务外), 若事务因 FK 违反而回滚, report 数值比实际提交数高。

### B2: `drainOne` 自消费检测后 `quarantineImmediately` 不在事务内, 可能重复 drain

**`packages/compost-core/src/ledger/outbox.ts:102-109`**

```ts
if (isWikiSelfConsumption(pending.source_uri)) {
  quarantineImmediately(db, pending.seq, "self-consumption: ...");
  return null;
}
```

`quarantineImmediately` 是独立 `db.run`, 不在事务内。若两个并发 `drainOne` 调用同时读到同一 pending 行 (SQLite 并发读写在 WAL 模式下可能发生), 两者都通过 `isWikiSelfConsumption` 检测, 第一个 `quarantineImmediately` 成功, 第二个再次 UPDATE 同一行 (`drain_attempts = drain_attempts + 1` 变成 2 而非 1)。此时 `drained_at` 仍 NULL, row 计数器失真但不影响功能正确性。根本修复是在 `drainOne` 开头用 `UPDATE ... WHERE drained_at IS NULL AND drain_quarantined_at IS NULL RETURNING seq` 的乐观锁方式 claim 行。

---

## 3. 测试覆盖盲点

### T1: 无测试覆盖 BreakerRegistry 与生产 LLM 路径的端到端连线

`test/circuit-breaker.test.ts` 全面测试了 `CircuitBreakerLLM` 内部逻辑, 但没有任何集成测试验证: (a) `BreakerRegistry.get(site)` 返回的实例确实是 `CircuitBreakerLLM`, (b) `ask()` / `synthesizeWiki()` 在收到 `CircuitOpenError` 时走正确的回退路径。wiki-fallback.test.ts 直接构造 `CircuitBreakerLLM` 绕过 registry, 掩盖了 registry 未接入生产的问题。

### T2: `listDecisions` sinceIso 时区转换无测试

**`packages/compost-core/src/cognitive/audit.ts:181-183`**

```ts
const sinceSqlite = since
  ? since.replace("T", " ").slice(0, 19)
  : null;
```

`audit.test.ts` 没有任何使用 `sinceIso` 过滤的测试用例。转换逻辑对 UTC offset (如 `2026-04-15T12:00:00+08:00`) 的处理是错误的 - `replace("T", " ")` 后字符串变为 `2026-04-15 12:00:00+08:00`, `slice(0,19)` 得到 `2026-04-15 12:00:00`, 但 SQLite 存储的是 `datetime('now')` (UTC), 两者时区不同导致过滤错位。

### T3: `isWikiSelfConsumption` COMPOST_DATA_DIR 无路径规范化测试

`self-consumption.test.ts` 只测试了三个正常场景 (home path / non-md / non-file), 未覆盖 symlink / 相对路径 / 尾部斜杠变体下的 override 检测。

---

## 4. Day 4 前必修 (阻断 cross-P0 集成的硬伤)

1. **P1 (outbox.ts:201 + mcp-server.ts:201)**: 生产 `ask` + `wiki.synthesis` 路径注入 `BreakerRegistry` - 不修复则 P0-6 断路器是名义合规, 所有 LLM 失败直接 throw 到 daemon 顶层。

2. **P3 (wiki.ts:101/120)**: 提取 `safePath/pagePath/existing` 到函数顶部, 消除重复查询 - 不修复则 stale_at 逻辑在高并发写入下有静默错误风险, 且 wiki_rebuild audit 行写入前已知 `existing` 状态不准。

3. **B2 (outbox.ts:102-109)**: `quarantineImmediately` 需要乐观锁保护 - 不修复则 drainOne 在多进程 daemon 场景下 (Phase 4 Batch D 已加 daemon scheduler) 可能双重处理自消费行。

---

## 5. 允许推迟

1. **P4 (circuit-breaker.ts:145)**: `runProbe` 失败时 `openedAt` 使用 probe 开始时间 vs `this.now()` 的细微差异 - 生产无影响, 仅影响 clock-inject 测试的边缘 case 稳定性。可在 Week 4 测试加固阶段处理。

2. **P2 (audit.ts:211-216)**: `CONFIDENCE_FLOORS` 反向 map 用 magic number - 目前常量冻结 (debate 007 Lock 3), 修改须走新 migration, 短期内不会出现不一致。可在 P0-2 下一次 iteration 修复, 不影响 Week 3 -> Week 4 cross-P0 集成。

3. **T2 (audit.ts sinceIso)**: 非 UTC ISO 输入的时区偏移解析错误 - CLI 当前不强制 ISO 格式, 用户输入偏差场景罕见。可 Week 4 补测试用例。

---

## 6. 一句话总评

Week 3 核心逻辑 (audit 写入/断路器状态机/stale wiki) 单元测试扎实, 但 `BreakerRegistry` 未接入任何生产调用点是一个跨文件 drift 硬伤: P0-6 合约在纸面合规、代码运行时失效。

---

DONE_R1_SONNET_009
