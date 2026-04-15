# Debate 007 — Synthesis: Week 3 Plan Audit

> 🐙 Opus 主持终裁 · 2026-04-15
> Participants: 🔴 Codex / 🟡 Gemini / 🟠 Sonnet / 🐙 Opus
> Rounds: R1 only (focused, strong convergence)

---

## 🟡 最终裁决: **Conditional Go for Week 3**

**4/4 一致 Conditional Go**. Plan 对了 70%, 但 6 处 plan-lock 必须先做. **Opus R1 有一处错误被 Codex 抓到** — synthesis 修正.

**核心纠正**: `reflect.ts step 2 (stale tombstone)` **不写 audit**. ARCHITECTURE.md frozen enum 表明确: `stale` 的 Audit kind = `(none)`. 我 (Opus) R1 Gap 1 建议"批量 1 行 audit" 违反了已锁合约. Codex 抓到这点 — 采纳 Codex.

**P0-2 实际 scope 因此缩小**: Week 3 只有 **2 个 audit 写入点** (reflect step 3 contradiction, wiki.ts rebuild), 不是 3-4 个.

---

## 🟢 R1 正面发现

### Codex 抓到 Opus 错误 (重要)
- Opus R1 Gap 1 建议 `reflect step 2 stale` 写 batch audit
- Codex 引 `ARCHITECTURE.md` frozen enum: `stale` → `Audit kind = (none)`
- 合约已明说 stale 是 bulk 操作, 不需要 audit trail (report.semanticFactsTombstoned 计数就够)
- **采纳 Codex**. Week 3 plan 删掉 reflect step 2 audit wiring.

---

## 🔴 Pre-Week-3 Plan-Lock (6 项, ≤ 1 小时)

### Lock 1 (HIGH, 4/4): `evidence_refs_json` schema per kind
```ts
// audit.ts 加类型
export type EvidenceRefs =
  | { kind: "contradiction_arbitration"; winner_id: string; loser_ids: string[]; subject: string; predicate: string }
  | { kind: "wiki_rebuild"; page_path: string; input_observe_ids: string[]; input_fact_count: number }
  | { kind: "fact_excretion"; fact_ids: string[]; reason: 'duplicate'|'low_access'|'manual'; count: number }
  | { kind: "profile_switch"; from_profile_id: string; to_profile_id: string };
```
`recordDecision` 用 `JSON.stringify(evidenceRefs)` 写入 `evidence_refs_json` TEXT. 消费端可强 cast.

### Lock 2 (HIGH, Codex 纠错): 删除 reflect step 2 audit wiring
- Plan 原说"reflect step 2 + step 3 都写 audit" — **错**.
- ARCHITECTURE.md frozen enum: `stale` 的 Audit kind 是 `(none)`. 只有 `contradicted` 的 kind 是 `contradiction_arbitration`.
- Week 3 只在 **reflect step 3 contradiction resolve** 写 audit (per cluster 1 行). Step 2 tombstone 继续只写 archive_reason='stale', 不碰 decision_audit.

### Lock 3 (HIGH, 4/4): confidence_floor 按 kind 映射
加 ARCHITECTURE.md:
| decision_audit.kind | confidence tier | floor |
|---|---|---|
| contradiction_arbitration | instance | 0.85 |
| wiki_rebuild | instance | 0.85 |
| fact_excretion (duplicate/low_access) | exploration | 0.75 |
| fact_excretion (manual) | kernel | 0.90 |
| profile_switch | kernel | 0.90 |

### Lock 4 (HIGH, Codex+Gemini+Opus): CircuitBreaker 用 rolling window + per-site key
- **阈值**: **过去 60s 内 failure rate > 50% 且至少 3 failures** → open. 不用 consecutive.
- **open duration**: 30s
- **half-open**: **单 probe 锁** (Codex 指出并发竞态) — 同时只一个请求放行
- **Site keys**: `ask.expand`, `ask.answer`, `wiki.synthesis`, `mcp.ask.factory`. 一个 breaker registry 按 key 共享. **不全局, 也不每调用独立**.
- 数值 freeze 在 `llm/circuit-breaker.ts` 常量 + 测试引用.

### Lock 5 (HIGH, Codex+Gemini): Self-Consumption 在 `outbox.drainOne` 拦截, 不只 ingest.ts
- **为什么**: drainOne 是所有 adapters 入 L2 的统一闸门. 只在 `ingest.ts` / `web-ingest.ts` 拦截会漏 hook / 未来 adapter.
- 规则: `observe_outbox.source_uri` 匹配 `file://<compost_data_dir>/wiki/*.md` 时 quarantine + skip.
- **简化 ARCHITECTURE.md** (Opus Gap 4): 删除 `source.kind == 'wiki-rebuild'` 那句 — enum 没这个值, 避免 migration 歧义. 只保留 URI regex 规则.

### Lock 6 (MEDIUM, Codex unique): 加 `wiki_pages.stale_at` migration 0013
- **问题**: Circuit breaker 打开时 wiki.ts fallback 返回旧磁盘页. `ask.ts:123-128` 继续读旧页, 用户误以为是新鲜答案.
- **修复**: migration 0013 加 `ALTER TABLE wiki_pages ADD COLUMN stale_at TEXT`. wiki.ts fallback 时设 stale_at = now. ask.ts 读时若 stale_at IS NOT NULL 加 `[stale wiki: {date}]` 前缀.

---

## 📊 Gap 矩阵 (4/4 voices)

| 问题 | Opus | Sonnet | Codex | Gemini |
|---|---|---|---|---|
| evidence_refs_json schema | Gap 3 | Gap | Gap | Gap 1 |
| profile_switch Week 3 不做 | Gap 4 decision | Gap | Gap | (implied) |
| reflect step 2 stale ≠ audit | ❌ R1 错 | — | **Gap (catches Opus)** | — |
| rolling window breaker | Gap 1 | — | Gap | Gap (flapping 场景) |
| per-site breaker key | Gap 2 | — | **Gap (4 keys 列表)** | Gap 2 |
| Self-Consumption at outbox | Gap 4 simplified | Gap | **Gap (outbox.drainOne)** | Gap 2 B |
| mcp-server.ts:201 refactor | — | **Gap (unique)** | **Gap (validateLLMConfig helper)** | — |
| wiki_pages.stale_at migration | — | — | **Gap (unique)** | — |
| MockLLMService 5 modes | Gap 5 | Gap | — | — |
| death loop on restart | Risk 2 | — | — | **Gap (persist state? 决议: 不做)** |

**4/4 touches**: evidence schema, profile_switch defer, Self-Consumption at outbox, rolling window
**Unique catches**: Codex reflect step 2 correction + wiki.stale_at + validateLLMConfig. Sonnet mcp-server refactor hidden work. Gemini death loop analysis.

---

## 📋 最终 Week 3 P0 范围

### P0-2 (缩小后): decision_audit wiring
- `audit.ts` 真实 SQL (recordDecision + listDecisions with 4 filters)
- `reflect.ts` step 3 调 recordDecision (per cluster) — step 2 **不调**
- `wiki.ts` rebuild 成功调 recordDecision
- `compost-cli/src/commands/audit.ts` 新建 (复用 openDb 模式)
- `evidence_refs_json` 3 种 shape (profile_switch 不实现)

### P0-6 (已锁参数): CircuitBreaker + Self-Consumption
- `llm/circuit-breaker.ts` 新建 (rolling 60s window, 50%+3 threshold, 30s open, single-probe half-open)
- `llm/breaker-registry.ts` 新建 (4 keys)
- `llm/mock.ts` 新建 (5 modes)
- wrap 5 call sites (wiki.ts / ask.ts × 2 / mcp-server.ts / Python out-of-scope)
- `mcp-server.ts:201` 抽 `createLLMServiceFromEnv()` helper
- `outbox.ts drainOne` 加 Self-Consumption guard + quarantine
- migration 0013 加 `wiki_pages.stale_at` + wiki.ts fallback 设置它
- `ask.ts:123-128` 读 wiki 加 stale 提示

### 估算
| 项 | 4-voice | **synthesis** |
|---|---|---|
| P0-2 | S/M | **S-M (1 天)** — 减 step 2 后 |
| P0-6 | M/L | **L (3 天)** — registry + migration + Mock + 5 sites + tests |
| **Week 3 总** | 4.5-5.5 天 | **4 天** (lock 后可 focus) |

---

## 📅 实施顺序

```
Day 0 (Pre-Week-3, ≤ 1 小时):
  - ARCHITECTURE.md 加 confidence_floor 映射表
  - ARCHITECTURE.md 删 "source.kind == 'wiki-rebuild'", 改 URI regex-only
  - audit.ts JSDoc 锁 evidence_refs_json 3 shapes
  - circuit-breaker.ts 常量 freeze 记在 plan-lock JSDoc

Day 1: P0-2
  - audit.ts 真实 recordDecision + listDecisions SQL + 测试
  - reflect.ts step 3 加 recordDecision (per cluster)
  - wiki.ts rebuild 成功路径加 recordDecision
  - compost-cli/src/commands/audit.ts + main.ts 注册
  - 4-5 tests: 写入 / list filter / shape validation / 4 kinds

Day 2-3: P0-6
  - migration 0013_wiki_stale.sql
  - llm/mock.ts (5 modes)
  - llm/circuit-breaker.ts (rolling window) + breaker-registry.ts
  - wrap wiki.ts / ask.ts × 2 / mcp-server.ts (+ createLLMServiceFromEnv helper)
  - outbox.ts drainOne Self-Consumption guard
  - ask.ts wiki-read stale prefix
  - 8-10 tests: breaker state machine / per-site key / Self-Consumption quarantine / 5 Mock modes / stale wiki read

Day 4: Cross-P0 集成测试
  - Mock LLM throws → breaker opens → wiki.synthesis fallback → stale_at set → ask reads with `[stale wiki]` prefix → decision_audit gets wiki_rebuild row on next success
  - ingest wiki/**.md → outbox quarantine → no further processing
```

---

## 🚨 元教训 (debate 007 独特贡献)

1. **Plan audit 抓到自己错** — Opus R1 Gap 1 违反已锁合约 (stale ≠ audit). Codex 用 "ARCHITECTURE.md 已锁" 反驳成立. Plan-lock 之后也要自我检查, 不许靠"感觉"改合约.

2. **"schema 锁定" 不够, 还要 "enum 真实性" 锁** — ARCHITECTURE.md 说 `source.kind == 'wiki-rebuild'` 但 CHECK enum 没这个值. 合约引用不存在的值 = 软性合约欺骗. 审 plan 必须 grep schema 验证.

3. **"estimated M" 在 daemon-facing refactor 通常是 L** — mcp-server.ts:201 `new OllamaLLMService()` 硬编码. Plan 说"wrap with breaker" 听起来简单, 实际要 extract factory. Sonnet + Codex 独立指出.

4. **"breaker 每调用独立 vs 全局" 不是二选一, 是 key-scoped** — 4 个 key (ask.expand / ask.answer / wiki.synthesis / mcp.ask.factory) 比单/全都更正确. Codex 最先提出, 其他人赞同.

---

## 🟢 Go Checklist

- [ ] 6 项 Pre-Week-3 Plan-Lock (≤ 1 小时 doc + JSDoc, 不动业务代码)
- [ ] 认可 Week 3 **4 天** 预算
- [ ] `profile_switch` Week 3 不做 (保留 stub, Week 5+ 再接)
- [ ] `reflect step 2 stale` NO audit write (删除 plan 里这条)

完成后 **Full Go**.
