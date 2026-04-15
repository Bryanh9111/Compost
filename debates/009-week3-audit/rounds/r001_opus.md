# R1 — 🐙 Opus (Week 3 Code Audit)

Read: audit.ts (full) · reflect.ts step 3 (168-270) · wiki.ts (85-160) · circuit-breaker.ts · breaker-registry.ts · mock.ts · outbox.ts drainOne + quarantine · ask.ts (100-185) · 4 new test files. 都基于实际 commit, 不凭印象.

---

## 1. Top 5 问题 (严重度降序)

### Issue 1 (HIGH): 审计失败会回滚 contradiction resolve
- **文件/位置**: `reflect.ts:236-257` — `recordDecision` 调用**在 `resolveTx` 事务内部**.
- **问题**: `recordDecision` 任何 throw (floor 违约 / JSON.stringify 爆 / DB lock) 冒泡到 `db.transaction` callback, SQLite ROLLBACK 整个事务. Contradiction resolve + fact_links edge + archive_reason 全丢. audit 是**观察信号**, 不该有能力吹掉业务结果.
- **为何 plan-audit 漏**: debate 007 讨论了 "recordDecision 语义和事务契约", 但没具体说审计 vs 业务的耦合度.
- **修复**: `reflect.ts:244` 包 try/catch:
  ```ts
  try {
    recordDecision(db, { ... });
  } catch (err) {
    report.errors.push({ step: "auditContradiction", message: err instanceof Error ? err.message : String(err) });
  }
  ```
  同样改 `wiki.ts` 成功路径的 audit 调用 (line ~162).

### Issue 2 (HIGH): ask.ts fallback 丢失 wiki context
- **文件/位置**: `query/ask.ts:147-173`.
- **问题**: 当 `queryResult.hits.length === 0 && wikiContexts.length > 0` (检索无直接 fact hit 但 wiki 页匹配了 subject) 时, 代码走 LLM 分支. 若 LLM throw, fallback 只格式化 `queryResult.hits.slice(0, 10)` — **空数组**, 返回 "no relevant facts found" banner, **wiki context 内容丢失**.
- **为何 plan-audit 漏**: debate 007 LLM 调用点表只描述"wiki.ts:86 wiki synthesis" 和 "ask.ts:152 final synthesis" 的 fallback, 没特别想 "hits 空 + wiki 非空" 这种组合.
- **修复**: fallback 构造时如果 hits 空但 wikiContexts 非空, 改为返回 wiki content 的摘要:
  ```ts
  const fallbackBody = queryResult.hits.length > 0
    ? queryResult.hits.slice(0, 10).map(...).join("\n")
    : wikiContexts.join("\n\n").slice(0, 2000);
  ```

### Issue 3 (HIGH): wiki fallback 无 cooldown → breaker open 时每 6h reflect 重复失败
- **文件/位置**: `wiki.ts:89-114`.
- **问题**: 当 LLM 失败, 我们 set stale_at 并 return. **last_synthesis_at 不更新**. 下次 `findTopicsNeedingSynthesis(db)` (`wiki.ts:22-40`) 仍会把这个 topic 挑出来 (因为 facts 更新时间 > last_synthesis_at). 每 6h reflect 都尝试, 每次再 fail 再加 record 到 breaker history — **breaker history 永远在 open 边缘**.
- **为何 plan-audit 漏**: plan 只讨论了"标记 stale", 没讨论 fallback 对"下次尝试频率"的影响.
- **修复**: wiki.ts fallback 里也更新 last_synthesis_at (保留 stale_at 指示失败):
  ```ts
  db.run("UPDATE wiki_pages SET last_synthesis_at = datetime('now'), stale_at = datetime('now') WHERE path = ?", [pagePath]);
  ```
  下次 findTopics 将基于新时间戳决定是否重试. Breaker decide 真正重试时机.

### Issue 4 (MEDIUM): listDecisions sub-second ISO 截断时被动拓宽 filter
- **文件/位置**: `audit.ts:179-183`.
- **问题**: `sinceIso.replace("T", " ").slice(0, 19)` — `"2026-04-15T12:00:00.500Z"` → `"2026-04-15 12:00:00"`. 调用者期望"12:00:00.500 之后" 但 SQL 过滤 "12:00:00 之后", 包含同秒内更早的行. 假正例 (false positive) 扩大窗口.
- **修复**: 保留毫秒:
  ```ts
  const sinceSqlite = since ? since.replace("T", " ").slice(0, 23).replace(/Z$/, "") : null;
  ```
  (SQLite `datetime(..., 'subsec')` 返回 `YYYY-MM-DD HH:MM:SS.SSS`. 让 sinceSqlite 与之比较)
- 同时让 `decided_at` 默认用 `strftime('%Y-%m-%d %H:%M:%f', 'now')` (migration 0014 改) 或接受 second-precision + ORDER BY id DESC tie-break (当前已 tie-break).
- **温和修复**: 保持当前截 19 char, 在 JSDoc 说明"sinceIso 精度为秒, 用于粗筛而非精确 since". 成本 0.

### Issue 5 (MEDIUM): 浮点相等重建 tier
- **文件/位置**: `audit.ts:211-216`.
- **问题**: `r.confidence_floor === 0.9` — SQLite REAL 存储为 IEEE754 double. 虽然 0.9 / 0.85 / 0.75 写入后 round-trip `===` 稳定, 但**未来有人换 floor 值** (比如加 0.95 tier) 就可能出现浮点误差. 代码没防御.
- **修复**: 映射表反查或容差:
  ```ts
  const TIER_BY_FLOOR: Array<[number, ConfidenceTier]> = [
    [0.9, "kernel"], [0.85, "instance"], [0.75, "exploration"]
  ];
  const tier = TIER_BY_FLOOR.find(([f]) => Math.abs(f - r.confidence_floor) < 1e-9)?.[1] ?? "exploration";
  ```

---

## 2. 边界/并发漏洞

### Edge 1: Half-open probe 的 `probeInFlight` 只在成功/失败后清空
- **文件**: `circuit-breaker.ts:87-96` (runProbe) + 64-74 (generate half-open path).
- 并发 3 callers: A 设 probeInFlight, B/C await 同一 promise. A 完成 (成功 or fail) → B/C 解锁. `finally` 里 `probeInFlight = null`. 但 A 的 `runProbe` 内部已改 state 为 "closed" 或 "open" — 这会让 B/C 在 finally 之前尝试重新进入路径吗?
- 逻辑顺序: `generate()` 进来 → `if (state === "half-open")` → `if (probeInFlight) return it`. 此时 probeInFlight 是 A 的 promise. B/C 在 `await this.probeInFlight` 阻塞直到 A resolve. 没 race.
- **结论**: 正确, 但 `finally` 块在 B/C 路径里也跑 — B 的 finally 会把 `probeInFlight` 设回 null (已被 A 的 finally 设 null). 无害.
- **文档 gap**: JSDoc 没解释为何 finally 安全 (A, B, C 都跑 finally 但幂等).

### Edge 2: isWikiSelfConsumption 依赖运行时 env
- **文件**: `outbox.ts` 的 `isWikiSelfConsumption`.
- `process.env.COMPOST_DATA_DIR` 读在函数内. 如果 daemon 启动后 env 变了 (不太可能但可能), 检查 changes. 非确定性.
- **建议**: daemon 启动时冷冻 — 接受 dataDir 参数:
  ```ts
  export function isWikiSelfConsumption(uri: string, dataDir?: string): boolean
  ```
  drainOne 调用时传入 daemon scheduler 初始化时已读的 dataDir. Week 3 不动也行 — 写 JSDoc 记录依赖.

---

## 3. 测试覆盖盲点

### Blindspot A: breaker-registry.ts **零测试**
- 新文件 `llm/breaker-registry.ts` 实现 4-key registry. 代码长度 ~30 行, 但**没有测试**. Key 隔离 (A 的 breaker open 不影响 B), 重复 get 同一 key 返回同一实例 — 都没验证.
- **应加**: `test/breaker-registry.test.ts`:
  - `get("ask.expand")` 两次返回同一 breaker
  - `ask.expand` breaker 故意打开, `wiki.synthesis` breaker 仍 closed
  - 不同 inner 的 registry 各自独立

### Blindspot B: 跨 P0 集成零覆盖
- reflect 跑一次 → `fact_links` 新增边 → `decision_audit` 新增行 → 下次 `takeSnapshot` (graph-health) 看到新图 → 所有环节**没 e2e 测试**.
- 具体: seed 5 facts 含一个冲突 → 调 reflect → 断言 `fact_links` count = 1 (contradicts), `decision_audit` kind='contradiction_arbitration' count = 1, `graph_health_snapshot` takeSnapshot 后 orphan_facts 减 2.
- **应加**: `test/cross-p0-integration.test.ts`. Day 4 任务本就有, 但应**列具体断言清单**防 scope 漂.

---

## 4. Day 4 前必修 (≤ 3)

1. **Issue 1 (audit 错误隔离)**: 审计 throw 不能回滚 reflect/wiki 业务. 包 try/catch, 写 report.errors. 10 分钟.
2. **Issue 2 (ask.ts fallback 保留 wiki context)**: 空 hits + 非空 wiki 时 fallback 返回 wiki 摘要. 10 分钟.
3. **Issue 3 (wiki fallback cooldown)**: UPDATE 时更新 `last_synthesis_at`. 5 分钟.

总 ≈ 30 分钟. 都是 1-3 行改动.

---

## 5. 允许推迟

- **Issue 4 sub-second ISO**: 秒级精度被动拓宽, 真实用户几乎感知不到 (listDecisions 是 ops 工具). JSDoc 标注即可.
- **Issue 5 float equality**: 当前 3 个 floor 值 IEEE754 round-trip 稳定, 加新 tier 时再防御.
- **Edge 1 JSDoc**: 安全但难读, 可 Day 4 cleanup 或 后续 retro.
- **Edge 2 env 冷冻**: Daemon 启动 env 变化极少, Week 4 P0-1 triage 实施时一起做.
- **Blindspot A (registry test)**: Day 4 整合集成测试时一并加.

---

## 6. 一句话总评

**审计路径的 try/catch 缺失和 wiki 重试 flooding 是 Day 4 集成测试一跑就会暴露的两个 bug**. 30 分钟修完再开集成, 否则 Day 4 会浪费在查"为什么 reflect 突然报错而不是写 audit".
