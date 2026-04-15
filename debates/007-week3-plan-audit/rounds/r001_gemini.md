# Compost Week 3 Plan Audit R1 - Gemini (LLM Failure Modes / Safety)

## 1. P0-2 Scope Gap (决策审计与真实 SQL 落地)

### Gap 1: `AuditEntry.evidenceRefs` 的结构化存储缺失
- **现状**: `audit.ts` 定义 `evidenceRefs?: string[]`，但在 SQLite 中直接存储数组会导致查询性能低下且无法利用 `JSONB` 优化。
- **建议**: 
  - 修改 `recordDecision` 内部逻辑，显式使用 `JSON.stringify` 序列化。
  - SQL Schema 必须包含 `evidence_refs_json` 字段。
  - **位置**: `packages/compost-core/src/cognitive/audit.ts` -> `recordDecision` 函数实现。

### Gap 2: `reflect.ts` 冲突裁决 (Contradiction Arbitration) 审计空洞
- **现状**: `reflect.ts` Step 3 处理冲突并标记 `superseded_by`，但完全没有调用 `recordDecision`。这意味着高价值的“真相判定”过程对 `compost audit list` 是不可见的。
- **建议**:
  - 在 `resolveTx` 内部，为每个 `cluster` 生成一条 `kind='contradiction_arbitration'` 的审计记录。
  - `evidenceRefs` 填入被覆盖的 `loser_id` 列表。
  - **代码位置**: `packages/compost-core/src/cognitive/reflect.ts` line 200 前后。

### Gap 3: `wiki_rebuild` 的事实追溯缺失
- **现状**: `wiki.ts` 的 `synthesizePage` 成功生成 Markdown 后更新了 `wiki_pages` 表，但没有记录审计。
- **建议**:
  - 必须记录 `kind='wiki_rebuild'`。
  - `evidenceRefs` 必须包含本次合成所消耗的所有 `observe_id`（已在 line 149 获取）。
  - **代码位置**: `packages/compost-core/src/cognitive/wiki.ts` line 140 后。

---

## 2. P0-6 Scope Gap (熔断器与自消费防护)

### Gap 1: 熔断器状态持久化与重启死循环
- **数值建议**: 
  - `threshold`: 5 consecutive errors.
  - `openDuration`: 30,000ms.
  - `halfOpenProbe`: 1 call.
- **风险**: 若 `CircuitBreakerLLM` 仅在内存中维护状态，Daemon 重启会重置熔断器。若 LLM 持续超时导致进程 OOM/Crash，重启后会立即再次尝试调用，形成 **Death Loop**。
- **建议**: 熔断器状态应可选持久化到 SQLite 的 `internal_state` 表，或在内存中设置 `backoff_factor`，重启后的第一次尝试失败应立即触发熔断。

### Gap 2: 自消费 (Self-Consumption) 的多层拦截点
- **现状**: `ingest.ts` 接受任意 `source_uri`。
- **建议**:
  - **代码点 A (Ingest)**: `ingest.ts` `ingestFile` 函数开始处，增加正则检查：若 `source_uri` 匹配 `file:///wiki/**` 或来源于 `wiki-rebuild` 任务，直接返回 `ok: false, error: 'Self-consumption guarded'`.
  - **代码点 B (Outbox)**: `outbox.ts` `drainOne` 处增加拦截，防止已入队的 Wiki 内容被下发到 L2 提取。
  - **位置**: `packages/compost-core/src/pipeline/ingest.ts` line 70.

---

## 3. 未预见失败模式 (Unexpected Failure Modes)

### 场景 A: 熔断器抖动 (Breaker Flapping)
- **描述**: LLM 并非彻底宕机，而是响应极慢（如 Ollama 在低配机器上负载过高）。5 次超时触发熔断 -> 30s 后 Half-Open 成功 1 次（此时刚好负载稍降）-> 立即 Closed -> 接着又是 5 次超时。
- **影响**: 系统处于半死不活的状态，用户体验极差，且审计日志会被频繁的 Open/Closed 状态切换填满。
- **预防**: 引入 `failure_rate` 窗口（例如过去 10 分钟内失败率 > 50% 即熔断），而非仅仅依赖连续失败计数。

### 场景 B: 审计膨胀与死循环 (Audit Bloat Loop)
- **描述**: 若 LLM 生成了有害或格式错误的 Wiki 页面，触发了 `reflect` 的某种修复逻辑，修复逻辑又生成了新的审计记录，而审计记录本身如果被误加入 Ingest 路径（由于配置错误）。
- **影响**: 存储爆炸。
- **预防**: `compost-core` 必须强制隔离 `data/wiki/` 和 `data/audit/` 目录，禁止 Ingest 扫描任何内部管理目录。

---

## 4. 估算裁决

- **P0-2 (Audit Wiring)**: **Medium**. 涉及多处 SQL 写入与 Transaction 包装，逻辑不复杂但需保证原子性。
- **P0-6 (Resilience)**: **Medium**. 熔断器装饰器易写，但 5 个调用点的 Fallback 策略（如 `ask.ts` 返回缓存还是报错）需要逐一确认。
- **Week 3 周期**: 预计 **4.5 天** (2d 审计落地 + 1.5d 熔断器 + 1d 测试与自消费验证)。

---

## 5. Week 3 Go / Conditional Go / No-Go

**Decision: Conditional Go**

1.  **[前置]** `AuditEntry` 必须支持 `JSONB` 或序列化存储，且 `recordDecision` 必须在 `reflect` 冲突处理中落地。
2.  **[前置]** 自消费拦截必须在 `ingest.ts` 层面对 `file:///wiki/` 实现硬编码拒绝。
3.  **[前置]** `CircuitBreakerLLM` 必须支持全局状态共享（Singleton 或注入），防止多个调用点独立计数导致熔断滞后。

---

## 6. 一句话告诫

不要让 LLM 的幻觉污染 Wiki 之后，再让 Ingest 把这些幻觉当成“事实”重新喂给 LLM；这是系统性的熵增自毁。

DONE_R1_007
