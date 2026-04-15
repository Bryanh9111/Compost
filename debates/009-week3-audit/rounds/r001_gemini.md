# Compost Phase 4 Week 3 Code Audit R1 — 🔴 Gemini 🟡

## 1. Top 5 问题 (按严重度)

### 1.1 自循环检测失效 (Self-Consumption Bypass)
**file:line**: `packages/compost-core/src/ledger/outbox.ts:257-270`
**为何 plan-audit 漏**: Plan 仅规定了拦截逻辑，未审视路径匹配的鲁棒性。
**漏洞**: `isWikiSelfConsumption` 依赖 `process.env["COMPOST_DATA_DIR"]`。若用户通过 CLI 参数 `--data-dir` 启动但未导出环境变量（常见于生产环境或脚本），检测将降级到硬编码的 `~/.compost` 正则。此外，该正则 `/\/\.compost\/wiki\/[^/]+\.md$/` 过于宽泛，可能误杀用户个人目录下包含 `.compost` 路径的文件。
**修复**:
```diff
-  if (/\/\.compost\/wiki\/[^/]+\.md$/.test(path)) return true;
+  // 必须由调用方显式传入经校验的 dataDir 路径
+  export function isWikiSelfConsumption(sourceUri: string, dataDir: string): boolean {
+    const wikiPrefix = `file://${join(dataDir, "wiki")}/`;
+    return sourceUri.startsWith(wikiPrefix) && sourceUri.endsWith(".md");
```

### 1.2 审计记录非原子性 (Audit Write Race)
**file:line**: `packages/compost-core/src/cognitive/audit.ts:114-118`
**为何 plan-audit 漏**: Plan-audit 关注 schema，不关注底层 DB 操作的原子性。
**漏洞**: `recordDecision` 先执行 `INSERT` 再 `SELECT` 获取 `decided_at`。在非事务环境下，`lastInsertRowid` 在高并发场景（如 daemon reflect 与 CLI 同时写入）可能被覆盖，导致返回错误的记录 ID 或时间戳。
**修复**:
```diff
-  const result = db.run("INSERT INTO ...", [...]);
-  const id = Number(result.lastInsertRowid);
-  const row = db.query("SELECT decided_at FROM ... WHERE id = ?").get(id);
+  const row = db.query("INSERT INTO decision_audit (...) VALUES (...) RETURNING id, decided_at").get(...) as { id: number, decided_at: string };
```

### 1.3 迁移并发冲突 (Migration Concurrency Risk)
**file:line**: `packages/compost-core/src/schema/migrator.ts:50`
**为何 plan-audit 漏**: Plan 假设 migration 是单点触发，忽略了 CLI 工具的多实例并发可能。
**漏洞**: `applyMigrations` 在读取已执行列表 (`alreadyApplied`) 时未加锁。两个 CLI 进程同时运行 `audit list` 时，可能同时识别到 0013 为 pending，并尝试并行应用，导致 `BEGIN IMMEDIATE` 冲突或重复执行非事务性 SQL。
**修复**:
```diff
-  ensureTrackingTable(db);
-  const alreadyApplied = ...
+  db.exec("BEGIN IMMEDIATE"); // 在发现 migration 之前先获取写锁
```

### 1.4 Wiki 检索质量瓶颈 (Retrieval Quality Ceiling)
**file:line**: `packages/compost-core/src/query/ask.ts:111`
**为何 plan-audit 漏**: Plan 锁定了流程，但忽略了 hardcoded 限制对结果质量的影响。
**漏洞**: `subjects.slice(0, 5)` 强制丢弃了第 5 个之后的 Wiki 页面上下文。在多事实查询中，这会导致 LLM 丢失关键背景信息。
**修复**:
```diff
-    for (const subject of subjects.slice(0, 5)) {
+    // 动态根据 context 预算调整，而非硬编码 5
+    for (const subject of subjects.slice(0, opts.maxWikiPages ?? 15)) {
```

### 1.5 审计 Kind-Evidence 校验逻辑倒置
**file:line**: `packages/compost-core/src/cognitive/audit.ts:102-112`
**为何 plan-audit 漏**: 属于纯代码实现顺序问题。
**漏洞**: 代码先检查 `confidenceActual`。若调用方传入了错误的 `kind` 且自信度较低，会先抛出 floor 错误，掩盖了更严重的 schema 匹配错误，给排查带来误导。
**修复**:
```diff
+  if (entry.evidenceRefs && entry.evidenceRefs.kind !== entry.kind) { ... } // 提到最前面
   const floor = CONFIDENCE_FLOORS[entry.confidenceTier];
```

## 2. 边界/并发漏洞

### 2.1 CircuitBreaker `getState` 状态不一致
`packages/compost-core/src/llm/circuit-breaker.ts:121`
在 `half-open` 状态下，若多个请求并发进入，它们会竞争 `probeInFlight`。虽然逻辑上做了同步等待，但 `getState()` 调用 `maybeTransition()` 时并没有感知正在进行的 probe。这可能导致监控系统在 probe 进行中报告 `half-open`，但实际上系统行为更接近 `locked`。应在 `getState` 中判断 `probeInFlight`。

### 2.2 Reflect Loser 重复归档
`packages/compost-core/src/cognitive/reflect.ts:256`
在处理 `contradiction` 时，代码更新 loser 事实的 `superseded_by`。虽然有 `superseded_by IS NULL` 保护，但并未处理 `archive_reason` 可能已被其他逻辑（如 `stale`）修改的情况。这会导致审计链条出现 `replaced_by_fact_id` 为空但状态为 `contradicted` 的异常记录。

## 3. 测试覆盖盲点

### 3.1 审计回滚测试
**缺失**: 当 `recordDecision` 失败（如 confidence 过低）时，应验证外层事务是否正确回滚。
**建议位置**: `packages/compost-core/test/audit.test.ts`

### 3.2 Stale Banner 渲染验证
**缺失**: 目前 `wiki-fallback.test.ts` 只验证了 DB 中的 `stale_at`，未验证 `ask.ts` 是否真的能正确读取该字段并在 `wikiContext` 中渲染 `[stale wiki]` 警告。
**建议位置**: `packages/compost-core/test/wiki-fallback.test.ts` (添加集成测试)

## 4. Day 4 前必修

1.  **修复 `isWikiSelfConsumption`**: 将检测逻辑改为基于解析后的 `dataDir` 绝对路径匹配，消除对环境变量和宽泛正则的依赖。
2.  **原子化 `recordDecision`**: 使用 `RETURNING` 子句或明确的事务包裹，确保 ID 和时间戳获取的安全性。
3.  **放宽 `ask.ts` Wiki 限制**: 将 5 改为 15 或基于 token 预算动态控制，防止有效信息被截断。

## 5. 允许推迟

1.  **Migration 锁优化**: 在单机单用户场景下，CLI 并发概率较低，可暂缓至 Phase 5 之前修复。
2.  **CircuitBreaker 状态报告优化**: `getState` 的微小不一致不影响核心功能，仅影响可观测性。

## 6. 一句话总评
Week 3 实现质量较高，但 **Self-Consumption 拦截器因环境依赖而存在致命绕过风险**，且审计系统在高并发写入下存在非原子性隐患。

DONE_R1_009
