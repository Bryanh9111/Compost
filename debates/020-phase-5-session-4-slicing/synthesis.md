# Final Synthesis — Debate 020

**Question**: Compost Phase 5 Session 4 应选 A/B/C/D/E 中哪个切片?

**Participants**: 🟡 Gemini (voted), 🔴 Codex (timed out, no verdict), 🟠 Sonnet (voted), 🐙 Claude Opus (voted).

**Verdict**: **Option B — Write-path vertical (~350 LoC)**. Unanimous among 3 respondents.

## Summary of perspectives

### 🟡 Gemini — Strategic framing

B 是 "主权契约" 的入口: 定义 Compost 如何输出 fact 到外部存储比如何消费外部事件更基础. Migration 0015 是 chunk 追踪的物理载体. `pending-writes.db` 与 writer 一起构成 "原子化可靠写入". 500-600 LoC 对跨系统集成是质量上限, 太激进. Splitter 不是通用工具, 是 Engram 2000-char 契约的专用适配层, 不该拎出.

### 🟠 Sonnet — Implementation-rooted, 2am-debug lens

UUIDv5 确定性只有在 writer 消费 splitter 输出时才测得到 — 分开 session 导致常量漂移无测试覆盖. `pending-writes.db` 是无 migration 系统的 SQLite, queue serialization 必须和 writer call signature 同 session 冻结. 两个最硬 2am 风险: (a) invalidate 成功 + re-remember 失败产生 Engram 空窗; (b) `expires_at` 按入队时间算导致 TTL 悄然缩短. 选 C 第一个 bug 会是 stream-puller 未过滤 `origin=compost` 造成 feedback loop.

### 🐙 Claude Opus — Contract drift + option D 陷阱

`remember(origin='compost')` 是 Engram `_map_insight_sources` 的唯一触发点 — 不落 writer, `compost_insight_sources` 反查表没有 fixture 锁 drift. Option D 表面 350 LoC, 实际需要新 Migration + origin_hash 路径改造 (Migration 0014 刚落地), 实际量级更接近 500. Migration 0015 搭便车成本 <30 分钟, 做了省一次 context switch. 两个补充风险: (a) `source_trace` JSON schema 未用 zod/ajv 校验会 silent failure; (b) `expires_at` drift 的极端情况 — flush 时已超 grace window, remember 成功但立即 GC, writer 看到 success response 但数据 0 秒后就没.

### 🔴 Codex — DID NOT RESPOND

Codex CLI 23 分钟后未产出 token, 被 kill. Gap: 缺一个独立训练族的 ground-truth implementation 视角. 三方对 B 一致 + Codex 典型最关心代码结构 (B 本身就是 "代码结构优先"), 缺席影响有限.

## Areas of agreement (全部三方一致)

1. **Pick B** — write-path vertical.
2. **Migration 0015 本 session 必做** — 成本低, 与 adapter 无耦合, 解 Phase 7 阻塞.
3. **Splitter 不单独拎 (E 过度)** — UUIDv5 namespace 漂移只有 writer 消费时才暴露.
4. **500-600 LoC (C) 太激进** — 每层浅的风险 > LoC 上限.
5. **pending-writes.db 与 writer 同 session** — queue schema 必须绑 writer call signature.
6. **先 write 后 read** — Compost 作为 Substrate, 主权写入点比消费入口优先.

## Areas of disagreement

无硬分歧. 三方细化建议互补, 不冲突.

## Risk consensus (合并去重)

| # | 风险 | 来自 | Mitigation |
|---|---|---|---|
| R1 | Invalidate 成功 + re-remember 失败 → Engram 空窗 | Sonnet | `pending-writes.db` 实现 two-phase log, invalidate 与 write 分离提交 |
| R2 | `expires_at` drift (入队 vs flush 时间) | Sonnet + Opus | writer flush 前检查 `expires_at - now > grace_window`, 否则丢弃 + log |
| R3 | `source_trace` JSON schema 未冻结 silent failure | Opus | writer.ts 第一个导出函数 `validateSourceTrace` (zod/ajv), 非可选 |
| R4 | UUIDv5 namespace 常量跨模块漂移 | Sonnet + Opus | 共享 `constants.ts`, splitter + writer 同 import |
| R5 | 写路径无 read 反向验证 (盲写) | Gemini | Session 5 stream-puller 上线即对账; B 期不解 |
| R6 | Engram `_map_insight_sources` 用 `INSERT OR IGNORE` + 内容相似度 dedupe (merge_threshold=0.75). 同一 logical insight 的相邻 chunk 若内容相似度超阈值, Engram silent 合并 → `total_chunks` 语义崩 | Post-debate audit (Engram ARCHITECTURE.md §7.3 + commit 4886f36) | splitter 按 paragraph → sentence 切分天然避免相似; 加 smoke test: 相邻 chunk 相似度 < 0.75, 超阈值触发 hard-cut fallback |

## Recommended path forward (Session 4 execution plan)

**Scope (~350 LoC)**:

1. **Migration 0015** (`packages/compost-core/src/schema/0015_user_model_schema.sql`, ~80 LoC)
   - `user_patterns` + `user_pattern_observations` + `user_pattern_events` 三表
   - 按 `docs/phase-5-user-model-design.md` 既有设计
   - 一个 migrator pickup test (~20 LoC)

2. **`packages/compost-engram-adapter/constants.ts`** (~20 LoC)
   - `COMPOST_INSIGHT_UUID_NAMESPACE` (UUIDv5 namespace const)
   - `DEFAULT_EXPIRES_AT_DAYS = 90`
   - `MAX_CONTENT_CHARS = 2000`
   - `PENDING_DB_PATH = ~/.compost/pending-engram-writes.db`

3. **`splitter.ts`** (~100 LoC)
   - UUIDv5 determinism: `uuidv5(NAMESPACE, project + '|' + sorted_fact_ids.join(','))`
   - Paragraph → sentence → hard-cut fallback
   - 边界 case 测试 (6-8 tests)

4. **`pending-writes.ts`** (~80 LoC)
   - SQLite schema: `pending_writes(id PK, payload JSON, kind ENUM('remember','invalidate'), enqueued_at, attempts, last_error)`
   - Two-phase for invalidate+rewrite (R1 mitigation)
   - TTL drift guard (R2 mitigation) on flush

5. **`writer.ts`** (~70 LoC)
   - `validateSourceTrace()` zod schema (R3 mitigation)
   - `writeInsight(facts, content)` → split + enqueue + attempt flush
   - `invalidateFacts(fact_ids)` → enqueue + attempt flush
   - MCP call via `mcp__engram__remember` + `mcp__engram__invalidate_compost_fact`

**Tests (~40 LoC)**:
- 1-2 happy path integration test per module (Sonnet standard)
- Splitter 边界 case (6-8, per Option E 本该做但吸收到 B 里)
- zod schema reject test
- 相邻 chunk 相似度 smoke test (R6 mitigation): Jaccard token overlap < 0.75 per chunk pair

**Deferred to Session 5**:
- stream-puller.ts + ingest adapter (D 的 scope)
- Reconciliation tool (`compost doctor --reconcile-engram`)
- Phase 7 pattern detection (Migration 0015 的消费端)

## Next steps (concrete)

1. **User 确认 B** → 我开 session 4 execution (按上面 5 个模块顺序)
2. **或** 用户 /octo:plan 再多一层 planning
3. **或** 用户直接进 superpowers:executing-plans + TDD 纪律层开撸

**Predicted LoC**: 290-340 (migration + adapter + tests).
**Predicted time**: 1-2 working blocks (类比 a861db4 Phase 4 P1 S3 强度).
**Remaining Phase 5 backlog after Session 4**: stream-puller + reconcile + doctor hooks + Phase 7 pattern detection.

---

**Debate folder**: `debates/020-phase-5-session-4-slicing/`
**Cost**: Gemini + Sonnet + Opus tokens (Codex kill = 0 output). Tracked separately via octopus analytics if enabled.
