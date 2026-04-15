# R1 — 🐙 Opus (Week 3 Plan Audit / Architecture)

Verification: grep schema for `talking_profile` returns nothing — the actual "profile" table is `ranking_profile` (0004) + the tp-xxx transform policies. ARCHITECTURE.md's `decision_audit.kind = 'profile_switch'` therefore has no current caller and no migration path to become one in Week 3. `source.kind` CHECK enum is closed-set (`local-file / local-dir / web / claude-code / host-adapter / sensory`) — no `wiki-rebuild` value exists. These two facts change plan accuracy.

---

## 1. P0-2 scope 完整度

### Gap 1 (HIGH): reflect step 2 batch audit strategy未定
- **问题**: `reflect.ts` step 2 一次 tombstone 可能 1-1000 个 stale facts. "每条一行 audit" 在 1000 行上: (a) audit 表膨胀 (Gemini debate 001 已担心过); (b) 同事务 1000 INSERT; (c) `evidence_refs_json` 每行单 fact 冗余.
- **建议**: **一行聚合**. 格式:
  ```ts
  recordDecision(db, {
    kind: "fact_excretion",
    targetId: `reflect:${new Date().toISOString()}`,
    confidenceTier: "exploration",   // stale = heuristic decay
    confidenceActual: 0.75,          // floor itself
    rationale: `decay formula tombstoned ${N} facts`,
    evidenceRefs: toTombstone.slice(0, 20),  // first 20 ids, count in rationale
    decidedBy: "reflect",
  });
  ```
  只在 `toTombstone.length > 0` 时写 1 行. 减少 1000× writes.

### Gap 2 (HIGH): confidence_floor 按 archive_reason 映射未锁
- **问题**: ARCHITECTURE.md frozen enum 6 个 archive_reason 但没映射到 kernel/instance/exploration. 实施时每个 recordDecision 调用都要挑 tier, 无依据. Plan 说 "confidence ladder 锁定" 但没表.
- **建议**: 加到 ARCHITECTURE.md:
  | archive_reason / decision kind | confidence tier | 理由 |
  |---|---|---|
  | stale (batch fact_excretion) | exploration | heuristic decay |
  | contradicted (contradiction_arbitration) | instance | explicit winner |
  | duplicate (fact_excretion) | instance | semantic similarity 测 |
  | low_access (fact_excretion) | exploration | heuristic |
  | manual (fact_excretion) | kernel | user-driven |
  | wiki_rebuild | instance | multi-fact synthesis |
  | profile_switch | kernel | config change |

### Gap 3 (MEDIUM): evidence_refs_json schema 未规范
- **问题**: TEXT 字段无结构. 下游 `compost audit list` 怎么解析? 每个 kind 不同 schema 导致 parse 地狱.
- **建议**: 锁 3 种形状 in JSDoc:
  - `fact_excretion`: `{ fact_ids: string[], count: number, reason: 'stale'|'duplicate'|'low_access'|'manual' }`
  - `contradiction_arbitration`: `{ winner_id: string, loser_ids: string[], subject: string, predicate: string }`
  - `wiki_rebuild`: `{ page_path: string, input_fact_ids: string[], input_count: number }`
  - `profile_switch` (Week 3 不做): `{ from_profile_id, to_profile_id, changed_fields }`
  add to `audit.ts` TypeScript types.

### Gap 4 (DECISION): profile_switch Week 3 做不做?
- **决议**: **不做**. 当前无调用者 (no `compost profile switch` CLI, 手动改 DB). 保留 kind 在 schema 0010 CHECK, audit.ts 接受但 Week 3 不有 callsite. Week 5+ 加 CLI 时再填写入点.

### Gap 5 (MEDIUM): listDecisions filters
- **建议签名**: `listDecisions(db, filter?: { kind?: AuditKind; sinceIso?: string; targetId?: string; decidedBy?: AuditActor; limit?: number }): AuditRecord[]`. 4 个 filter + limit 够, 不做 pagination.

---

## 2. P0-6 scope 完整度

### Gap 1 (HIGH): CircuitBreaker 实际阈值 — 用 rolling window 不是 consecutive
- **问题**: "5 consecutive failures" 在 ingest worker (1000/day) 跟 wiki rebuild (1/6h) 行为不同. Consecutive 模型会把"偶发超时 → 恢复 → 再超时"当正常, 但实际可能 LLM 持续慢.
- **建议真实数值**:
  - **Rolling window**: 过去 60s 内 failure rate > 50% + 至少 3 failures → open
  - **open duration**: 30s
  - **half-open probe**: 1 call, 若成功 close, 失败立即 re-open
  - **success on open**: 忽略 (shouldn't happen — fallback 应已被触发)
- 实现: `CircuitBreakerLLM` 持一个 `Array<{ t: number; ok: boolean }>` 环形 buffer.

### Gap 2 (HIGH): per-breaker-instance vs global — 锁决定
- **问题**: 全局 singleton 在测试里无法 isolate (每个 test 改状态污染下个). Per-call-site breaker 复杂度翻倍.
- **建议**: **Per-LLMService-instance**. CircuitBreakerLLM 在 constructor 里 new 自己的状态. 所有 Ollama 调用共用一个 state (1 个实例, 包 OllamaLLMService), 因为失败源是同一个进程. Tests 每次 `new MockLLMService()` 拿 clean state. 简单且正确.

### Gap 3 (HIGH): ask.ts 已有 try/catch — breaker 加在哪?
- **问题**: `ask.ts:35 expandQuery` 已有 try/catch 回退 `[original]`. `ask.ts:152` synthesis 没有 try/catch, 出错整个 ask fail. 如果加 CircuitBreakerLLM decorator, 两个调用点共享 breaker state, expansion 失败会让 synthesis 也被 open 拦. 但 synthesis 的 fallback 是 BM25 拼接 — 那其实是好事 (Ollama 死 → 整个 LLM 路径跳 fallback).
- **建议**:
  - 移除 `ask.ts:35` 现有的 try/catch (breaker 替代)
  - `ask.ts:152` 加 try/catch 调用 breaker-aware fallback (BM25 top-N + banner)
  - 共享 breaker state 是**正确行为**不是 bug — Ollama 挂了, expansion + synthesis 都该走 fallback

### Gap 4 (MEDIUM): Self-Consumption guard 简化
- **问题**: ARCHITECTURE.md 提到 `source.kind == 'wiki-rebuild'` 但 `source.kind` CHECK enum 不含此值. 要么 migration 加 enum 要么 drop 规则. Wiki.ts **写 markdown 到磁盘**, 不 create observations — 所以"upstream source.kind" 路径不存在.
- **建议**: **简化为 URI-only 检查**. 在 `pipeline/web-ingest.ts ingestUrl` + `pipeline/ingest.ts` 入口 check:
  ```ts
  function refuseWikiReingest(uri: string): boolean {
    // Reject file:// URIs whose path contains /wiki/ (matches compost's wiki export dir)
    if (uri.startsWith("file://") && /\/wiki\/[^/]+\.md$/.test(uri)) {
      throw new Error(`refuse-to-reingest: ${uri} appears to be a generated wiki page`);
    }
  }
  ```
  不 migration, 不碰 source.kind enum. 更新 ARCHITECTURE.md 把 `source.kind == 'wiki-rebuild'` 那句删掉.

### Gap 5 (MEDIUM): MockLLMService 场景
- **建议导出**:
  ```ts
  class MockLLMService implements LLMService {
    constructor(private opts: {
      mode: 'happy' | 'timeout' | 'error' | 'garbage' | 'hang',
      delay?: number;
      response?: string;
      errorMessage?: string;
    }) {}
  }
  ```
  5 modes 够测 circuit breaker 状态转移.

### Gap 6: talking_profile.provider 列不加
- **决议**: `talking_profile` 不存在 (实际是 tp-xxx 字符串 id in observations.transform_policy). 加 provider 列需要先建 profile table, 这是 Phase 5 规模. Week 3 不做.

---

## 3. 未预见失败模式

### Risk 1: reflect step 2 + P0-2 audit → 1000 rows / reflect (已防, Gap 1)
- 建议 batch audit 已解决.

### Risk 2: Circuit breaker state reset vs daemon 重启
- **场景**: daemon crash + restart, breaker 回到 closed. 但 Ollama 还挂着 → 每次调用又 fail 一次直到再 open.
- **影响**: 重启后第一波请求全 fail. 短暂延迟, 非致命.
- **预防**: 接受. Week 3 不持久化 breaker state. Week 5+ 如果 observe 到"重启 storm", 再加 health_signals.stuck_llm kind 记录.

### Risk 3: Test 之间 breaker state 污染
- **场景**: test A 让 MockLLMService 抛 5 次 → breaker open. test B 用同个 LLMService 实例 → 已 open.
- **预防**: 每 `beforeEach` `new MockLLMService(...)` + `new CircuitBreakerLLM(mock)`. 测试里永远不复用实例. 现有 backup.test 模式已经是这样.

### Risk 4: Self-Consumption 误杀用户合法 wiki ingest
- **场景**: 用户自己有个 personal wiki in `~/notes/wiki/foo.md`, 想 ingest 学习. Self-Consumption guard 拒绝.
- **预防**: regex 改为只匹配 Compost 自己的 wiki dir (`compost_data_dir + /wiki/*.md`), 不是任何 `/wiki/`. 细化正则.

---

## 4. 估算裁决

| 项 | Plan 原估 | 真实 | 理由 |
|---|---|---|---|
| P0-2 | (S 隐含) | **S-M** (0.5-1 天) | audit.ts impl 轻; reflect+wiki wiring 2-3 处; CLI 小; listDecisions SQL 直接. **但**加 evidence_refs schema + confidence map 需要半天 design |
| P0-6 | (M 隐含) | **M-L** (2-3 天) | 5 call sites wrap + fallback per site + MockLLMService + Self-Consumption regex + rolling window breaker + 测试状态转移 + 移除 ask.ts 现有 try/catch |
| **Week 3 总** | 未给 | **3-4 天** | 同 Week 2, 别再乐观估 |

---

## 5. Week 3 Go / Conditional Go / No-Go

**Conditional Go** (3 前置, ≤ 30 分钟 doc/plan-lock, 不动代码):

1. **ARCHITECTURE.md 加 confidence_floor 映射表** (Gap 2). 避免实施时每 audit 调用都要现场决策.
2. **ARCHITECTURE.md 把 Self-Consumption 从 "source.kind == 'wiki-rebuild'" 改成 "URI regex only"** (Gap 4). 删除 source.kind mythology, 避免实施时发现 enum 没那个值才返工.
3. **`audit.ts` 的 `evidence_refs_json` 3 种 shape 锁 in JSDoc** (Gap 3). 防 listDecisions 消费时 parse 歧义.

---

## 6. 一句话告诫

Week 3 最大的坑不是写不出来, 是**1000 stale facts × 1000 audit rows** 和 **ARCHITECTURE 已锁定但合约中引用了不存在的 source.kind**. 实施前半小时 plan-lock 把合约对齐, 否则 Week 3 会变 5 天.
