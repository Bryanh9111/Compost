# R1 — 🐙 Opus (架构主持 / Readiness Gate)

身份: 架构守门员. 关注当前状态是否经得起 P0 实施考验, 以及代码现状里是否藏着会让 P0 估算翻车的"既有事实".

---

## 1. Go/No-Go 投票

**Conditional Go**.

理由: schema 准备很充分 (0010+0011 双 migration), TS stubs + RED tests 给 P0 留了清晰落点. 但**实施前我必须先指出 4 个被忽略的"既有代码事实"**, 否则 P0 估算会失真. 解决这 4 项可以在 1 天内完成, 不阻塞 Week 1 启动.

### 必须先做 (≤ 1 天, 启动前 prerequisite)

1. **裁决 `decision_audit` (P0-2) vs 已存在的 `ranking_audit_log`**
   schema 0004 已有 `ranking_audit_log` 表 (`packages/compost-core/src/schema/0004_probabilistic_ranking.sql:24`). 它捕获 ranking 决策. P0-2 的 `decision_audit` 是 contradiction/wiki/excretion/profile_switch. 这两个表语义重叠模糊 — 现在不裁决, 实施时会出现"哪个查询走哪个表"的混乱. **仲裁**: ranking_audit_log 留给 ranking-only (查询排序), decision_audit 服务 4 个 cognitive write 路径. 在 ARCHITECTURE.md 加一句 "two audit logs, different concerns".

2. **承认 LLM abstraction 已存在, 改写 P0-6 范围**
   `packages/compost-core/src/llm/types.ts` 已有 `LLMService` interface, `llm/ollama.ts` 已是 concrete impl. P0-6 的"IExtractorClient" 是**重复造轮子**. 真实 P0-6 = (a) wrap 已有 LLMService 加 timeout + circuit breaker, (b) wiki rebuild / ingest / ask 三处调用点统一走 wrapper, (c) talking_profile 加 `provider` 列允许将来切换. 实际工作量从 M 缩到 S.

3. **承认 reflect.ts 已实现 contradiction resolution, 改写 P0-4 范围**
   `cognitive/reflect.ts:134-188` 已实现 contradiction detection + 设置 `superseded_by` + `conflict_group`. 但**没写 audit, 没写 archive_reason**. P0-4 的真实工作 = 在 reflect.ts:118 (`UPDATE archived_at`) 和 :169 (`supStmt.run`) 各加一行写 archive_reason. 极轻量改动 (S → XS), 但需要先理解现有逻辑别打破.

4. **测一下 daemon scheduler 是否能塞下 P0-7 backup cron**
   `packages/compost-daemon/src/scheduler.ts` 已经跑 reflect (周期) + ingest worker + outbox drain. P0-7 加 24h backup cron. SQLite VACUUM INTO 在大 db 上会**锁数据库** (SQLite 单写者). 如果与 reflect 同时跑, 都会被阻塞. 实施前必须验证: backup 与 reflect 是否会冲突 lease? 给 backup 分配独立时间窗 (比如 03:00 UTC, 远离 reflect 6h 周期).

---

## 2. Top 3 实施风险 (按 概率 × 影响)

### 风险 1: P0-6 实际是 L 不是 M (高概率, 中影响)
- **触发**: 实施时发现 `wiki.ts:86 llm.generate()` + `ingest.ts` LLM-extract path + `query/ask.ts` synthesis 三处都需要 wrap circuit breaker, 还要重新设计 fallback (BM25 拼接? 拒绝服务? 缓存上次结果?). 加上 Self-Consumption guard (识别 wiki/ source 不再 ingest), 是 L 工程.
- **损失**: 1 周延迟. 4 周变 5 周.
- **预防**: 启动 P0-6 前先做 LLM call site inventory (15 分钟 grep), 确认实际是 3 个 wrap 而非 8 个. 写一份 0.5 页 fallback 设计 (3 种降级模式) 后再码.

### 风险 2: P0-3 v_graph_health 在大 fact 集上慢 (中概率, 中影响)
- **触发**: fact_links 实施完, 用户 dogfood 累积 10K+ facts + 50K+ links. `v_graph_health` 的 orphan 计算用 LEFT JOIN + WHERE created_at < 24h, 在大表上是全表扫. 触发 `compost triage` (P0-1 每次调用)就 200ms+.
- **损失**: triage CLI 体感慢, 用户开始绕过它. P0-1 价值打折.
- **预防**: P0-3 实施时给 fact_links 加 covering index `(from_fact_id, to_fact_id)`, 给 facts 加 `(archived_at, created_at)` partial index. 写 benchmark fixture 验证 < 50ms @ 10K facts.

### 风险 3: hook-shim 性能预算被 P1 PII redact 撑爆 (低概率, 高影响)
- **触发**: P0-5 correction detect 我设计是 daemon post-drain (不在 hook), 性能不受影响. 但 P1 PII redact **必须**在 hook 层 (写入前拦截), 否则信用卡号已经入 outbox. hook-shim 当前 ≤ 20ms cold. 加 7 个 regex match (CC + SSH + API key + .env line + password + AWS key + JWT) 在每次 hook 调用 → 3-5ms 增加, 接近 25ms 上限.
- **损失**: 用户感知到 Claude tool 变慢, 关掉 hook → Compost 变盲.
- **预防**: PII redact (P1) 必须有性能 benchmark gate, 必须 < 5ms 增量. 否则不允许进 hook-shim, 改在 daemon drain 阶段 (但失去拦截价值, 退而求其次只能 redact 已存的).

---

## 3. P0 顺序最后裁决

**synthesis Week 1-4 计划基本对**, 但有 2 处调整:

```
Week 1:
  P0-0 fact_links migration 已 land (commit 8f3100a). 实际 Week 1 是写
       fact_links **API + recursive CTE TS 实现** (packages/compost-core/src/cognitive/fact-links.ts
       新建). 同时:
  P0-7 backup script (轻量, S, 半人天)
  P0-4 (XS, 借力已有 reflect.ts 现有改) — **新增, 提前到 Week 1**

Week 2:
  P0-3 graph-health TS 实现 (依赖 P0-0 API 已 land)
  P0-2 decision_audit 写入点 (依赖 P0-4 archive_reason enum 已用)
  P0-5 correction_events 捕获 (独立, 与上面并行)

Week 3:
  P0-6 LLM circuit breaker (借力已有 LLMService interface)
  P0-1 triage 整合 (依赖前面所有信号源)

Week 4:
  集成测试 + benchmark fixture (P1 启动)
  Bug fix + 用户 dogfood
```

**关键变化**: P0-4 (archive_reason 写入) 提前到 Week 1, 因为它在 reflect.ts 现有代码加 2 行就完成. 别浪费这种轻量项的时间槽.

---

## 4. 测试覆盖盲点

### 盲点 A: 没有 LLM mock 基础设施
- **缺什么**: `llm/types.ts` 有接口但没有 `MockLLMService` 实现. P0-6 circuit breaker 测试需要模拟 timeout / 5xx / 慢响应 / hang.
- **应在哪个 P0 加**: P0-6 启动时必须先写 `packages/compost-core/src/llm/mock.ts` (返回 fixture, 可控延迟 / 错误注入). 否则 circuit breaker 测试只能跑真 Ollama, 不可靠.

### 盲点 B: 没有跨模块集成测试
- **缺什么**: 当前所有测试是单模块 + 空 db fixture. P0-1 triage 真正生成信号需要: P0-2 audit 有数据 + P0-4 archive_reason 有 stale 标记 + P0-3 graph_health 有 orphan. 这条链没有 e2e 测试.
- **应在哪个 P0 加**: P0-1 (triage) 收尾必须包含 `triage-integration.test.ts`: seed db with 100 facts including stale + contradicted + orphan, 跑完 reflect, 跑 triage, 验证 5 个信号源都触发.

### 盲点 C: 没有 daemon 级 chaos 测试
- **缺什么**: P0-7 backup cron 与 reflect cron 同时跑会怎样? daemon 重启后 backup state 是否 restore? 当前 0 测试覆盖.
- **应在哪个 P0 加**: P0-7 必须包含 "backup during reflect" 测试 + "daemon kill mid-backup" 测试. 不要用 mock, 用真 SQLite 文件 + bun:test 的 child_process.

---

## 5. 撤退条件 (≥ 2)

### 撤退条件 1: P0-0 实施 > 5 工作日
fact_links 估算 M (3-5 天). 如果 Week 1 结束 fact_links 仍未通过测试 (recursive CTE 实现卡 / FK CASCADE 与现有 facts 表冲突 / API 设计反复改), **暂停**. 评估: 是不是 fact-graph 不该走 SQLite 应该走专门的 graph 库 (LanceDB graph extension / sqlite-vec)?

### 撤退条件 2: P0-3 benchmark > 200ms @ 10K facts
graph_health 在测试基线 10K facts + 50K links 时, 单次 currentSnapshot 调用超 200ms. **暂停**. 评估: orphan 检测应该改为 incremental update (fact 写入时维护 link count) 而不是查询时扫.

### 撤退条件 3: LLM call site inventory 发现 > 5 处
启动 P0-6 前 grep `llm.generate|llm.chat|ollama` 找到 > 5 处独立调用. **暂停**. 评估: P0-6 不是加 wrapper, 是要重构整个 LLM 调用层. L → XL, 排到 Phase 5.

### 撤退条件 4: 任意 P0 PR 引入 > 3 处现有测试 fail
implementation 期间, 如果任何 P0 PR 让 monorepo test 从当前 156 pass 跌到 < 150 pass, **不 merge**. 必须先修绿. 防止"先 commit 后修" 累积技术债.

---

## 6. 独特视角 (Opus, ≤ 150 字)

**架构忠告**: 当前所有"P0 实施估算" 假设了 8 个独立工作流. 实际上 P0-1 (triage) 是 **5 个其他 P0 的下游消费者** — 它的真正实施只能在 P0-2/P0-3/P0-4/P0-5 + LLM signal (P0-6) 都 land 之后才有意义. 把 P0-1 留到 Week 4 不只是工程顺序, 而是**它的设计验证只能在那时**. 不要在 Week 1 就开 P0-1 的 PR — 那只是炫技.

**一句话**: **先收割 4 个已存在但被忽略的事实** (ranking_audit_log 重叠 / LLMService 已抽象 / reflect.ts 已做 contradiction / scheduler 需 backup time-window), 再开 P0. 这一天的"考古" 抵 1 周返工.
